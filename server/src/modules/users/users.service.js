/**
 * =============================================================================
 *  Users service
 * =============================================================================
 *  Account lifecycle: invite -> accept -> manage access -> suspend.
 *
 *  THE SAFETY RULES ENFORCED HERE (each exists because breaking it is
 *  unrecoverable without direct database access):
 *
 *    1. The LAST super admin cannot be demoted, suspended or deleted.
 *       Otherwise the station locks itself out of its own system permanently.
 *    2. Only a super admin can create or promote another super admin.
 *       Otherwise `user:manage_access` becomes a silent path to full control.
 *    3. Nobody can change their OWN privileges.
 *       Removes the "grant myself everything" shortcut and makes every
 *       escalation traceable to a second person.
 *    4. Users are never hard-deleted, only suspended.
 *       Audit logs, stock movements and submissions must keep pointing at a
 *       real person — history that says "deleted user issued 40 tourniquets"
 *       is not history.
 * =============================================================================
 */

import { prisma } from '../../config/db.js';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';
import { generateToken, hashToken } from '../../utils/crypto.js';
import { hashPassword } from '../../utils/password.js';
import { paginate, searchFilter, toPrismaPagination } from '../../utils/pagination.js';
import { computeEffectivePermissions } from '../../services/access.service.js';
import { revokeAllUserTokens } from '../../services/token.service.js';
import { sendInvitationEmail } from '../../services/email.service.js';
import { recordAudit, AUDIT_ACTIONS } from '../../services/audit.service.js';
import { logger } from '../../utils/logger.js';

/**
 * Columns safe to return from list/detail endpoints.
 * An explicit allow-list, never `select: undefined` (which returns everything,
 * including passwordHash and twoFactorSecret).
 */
const userListFields = {
  id: true,
  email: true,
  fullName: true,
  phone: true,
  status: true,
  isSuperAdmin: true,
  locale: true,
  twoFactorEnabled: true,
  lastLoginAt: true,
  createdAt: true,
  role: { select: { id: true, key: true, nameEn: true, nameAr: true } },
};

// =============================================================================
//  READ
// =============================================================================

/** Paginated, filterable, searchable user list. */
export async function listUsers(query) {
  const { page, limit, search, status, roleId, teamId, isSuperAdmin } = query;
  const pagination = toPrismaPagination(query);

  const where = {
    ...(status ? { status } : {}),
    ...(roleId ? { roleId } : {}),
    ...(isSuperAdmin !== undefined ? { isSuperAdmin } : {}),
    // `some` produces an EXISTS subquery — no join duplication, no need for
    // DISTINCT, and it stays correct alongside the other filters.
    ...(teamId ? { memberships: { some: { teamId } } } : {}),
    ...searchFilter(search, ['fullName', 'email', 'phone']),
  };

  return paginate(
    prisma.user,
    { where, select: userListFields, orderBy: pagination.orderBy, skip: pagination.skip, take: pagination.take },
    { page, limit },
  );
}

/** Full detail for one user, including resolved effective permissions. */
export async function getUser(id) {
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      ...userListFields,
      extraPermissions: true,
      deniedPermissions: true,
      mustChangePassword: true,
      role: { select: { id: true, key: true, nameEn: true, nameAr: true, permissions: true } },
      memberships: {
        select: {
          teamRole: true,
          team: { select: { id: true, key: true, nameEn: true, nameAr: true, dayOfWeek: true } },
        },
      },
    },
  });

  if (!user) throw ApiError.notFound('User not found');

  return {
    ...user,
    // Computed, not stored: showing the admin exactly what this person can do
    // after role + grants − denies is the whole point of the access screen.
    effectivePermissions: computeEffectivePermissions(user),
  };
}

// =============================================================================
//  INVITE
// =============================================================================

/**
 * Invites someone by email.
 *
 * We create an Invitation row, NOT a User. The account is created only when the
 * person accepts and chooses their own password, which means:
 *   • we never store a password the admin knows;
 *   • an unaccepted invitation leaves no half-configured account behind;
 *   • the user list is not polluted with people who never joined.
 */
export async function inviteUser(input, actor, context = {}) {
  // Rule 2: only a super admin can mint another super admin.
  if (input.isSuperAdmin && !actor.isSuperAdmin) {
    throw ApiError.forbidden('Only the super admin can create another super admin', {
      code: 'SUPER_ADMIN_ONLY',
    });
  }

  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true, status: true },
  });

  // An ACTIVE account already exists — the admin probably wants "resend reset",
  // so say that rather than a bare "duplicate".
  if (existing && existing.status !== 'INVITED') {
    throw ApiError.conflict('An account with this email already exists', {
      code: 'EMAIL_IN_USE',
      details: { email: 'Already registered' },
    });
  }

  if (input.roleId) {
    const role = await prisma.role.findUnique({ where: { id: input.roleId }, select: { id: true } });
    if (!role) throw ApiError.badRequest('The selected role does not exist');
  }

  // Raw token is emailed; only its hash is stored (see utils/crypto.js).
  const token = generateToken();

  const invitation = await prisma.$transaction(async (tx) => {
    // Supersede any outstanding invitation for this address, so an older link
    // cannot be used to join with stale (possibly wider) permissions.
    await tx.invitation.updateMany({
      where: { email: input.email, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return tx.invitation.create({
      data: {
        email: input.email,
        fullName: input.fullName,
        tokenHash: hashToken(token),
        roleId: input.roleId ?? null,
        extraPermissions: input.extraPermissions,
        teamIds: input.teamIds,
        isSuperAdmin: input.isSuperAdmin,
        expiresAt: new Date(Date.now() + env.INVITE_TTL_HOURS * 3600_000),
        invitedById: actor.id,
      },
      include: { role: { select: { nameEn: true } } },
    });
  });

  // Sent AFTER the transaction commits: emailing a link for a row that was
  // rolled back would produce an invitation that can never be accepted.
  try {
    await sendInvitationEmail({
      to: invitation.email,
      fullName: invitation.fullName,
      roleName: invitation.role?.nameEn ?? 'Member',
      inviterName: actor.fullName,
      token,
    });
  } catch (error) {
    // The link exists only in the email that just failed, so this invitation
    // can never be accepted. Revoke it rather than leave a "pending" row the
    // admin would wait on, and say plainly what went wrong — a bare 500 made
    // an SMTP misconfiguration look like a crash.
    logger.error({ err: error, invitationId: invitation.id }, 'Invitation email failed');
    await prisma.invitation.update({
      where: { id: invitation.id },
      data: { revokedAt: new Date() },
    });
    throw new ApiError(
      502,
      'The invitation email could not be sent, so no invitation was created. ' +
        'Check the email settings (SMTP) and try again.',
      { code: 'EMAIL_NOT_SENT' },
    );
  }

  await recordAudit({
    actorId: actor.id,
    action: AUDIT_ACTIONS.USER_INVITED,
    entityType: 'Invitation',
    entityId: invitation.id,
    after: {
      email: invitation.email,
      roleId: invitation.roleId,
      teamIds: invitation.teamIds,
      isSuperAdmin: invitation.isSuperAdmin,
    },
    req: context.req,
  });

  return {
    id: invitation.id,
    email: invitation.email,
    fullName: invitation.fullName,
    expiresAt: invitation.expiresAt,
    // Only in development, so you can click the link without an email account.
    ...(env.isDevelopment ? { devInviteToken: token } : {}),
  };
}

/** Pending invitations, for the "waiting to accept" list. */
export async function listPendingInvitations(query) {
  const pagination = toPrismaPagination(query);

  const where = {
    acceptedAt: null,
    revokedAt: null,
    ...searchFilter(query.search, ['email', 'fullName']),
  };

  return paginate(
    prisma.invitation,
    {
      where,
      select: {
        id: true,
        email: true,
        fullName: true,
        expiresAt: true,
        createdAt: true,
        role: { select: { nameEn: true, nameAr: true } },
        invitedBy: { select: { fullName: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: pagination.skip,
      take: pagination.take,
    },
    { page: query.page, limit: query.limit },
  );
}

/** Cancels a pending invitation — the emailed link stops working immediately. */
export async function revokeInvitation(id, actor, context = {}) {
  const invitation = await prisma.invitation.findUnique({ where: { id } });

  if (!invitation) throw ApiError.notFound('Invitation not found');
  if (invitation.acceptedAt) {
    throw ApiError.conflict('This invitation has already been accepted. Suspend the account instead.');
  }

  await prisma.invitation.update({ where: { id }, data: { revokedAt: new Date() } });

  await recordAudit({
    actorId: actor.id,
    action: AUDIT_ACTIONS.USER_INVITE_REVOKED,
    entityType: 'Invitation',
    entityId: id,
    before: { email: invitation.email },
    req: context.req,
  });
}

// =============================================================================
//  UPDATE
// =============================================================================

/** Profile fields only. Privilege changes go through updateAccess. */
export async function updateUser(id, data, actor, context = {}) {
  const before = await prisma.user.findUnique({
    where: { id },
    select: { fullName: true, phone: true, locale: true },
  });

  if (!before) throw ApiError.notFound('User not found');

  const updated = await prisma.user.update({ where: { id }, data, select: userListFields });

  await recordAudit({
    actorId: actor.id,
    action: AUDIT_ACTIONS.USER_UPDATED,
    entityType: 'User',
    entityId: id,
    before,
    after: data,
    req: context.req,
  });

  return updated;
}

/**
 * Changes role / grants / denies / super-admin status.
 * The most dangerous endpoint in the system, hence the guards.
 */
export async function updateAccess(id, data, actor, context = {}) {
  // Rule 3: no self-modification of privileges.
  if (id === actor.id) {
    throw ApiError.forbidden(
      'You cannot change your own role or permissions. Ask another admin.',
      { code: 'SELF_ESCALATION_BLOCKED' },
    );
  }

  const target = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      isSuperAdmin: true,
      roleId: true,
      extraPermissions: true,
      deniedPermissions: true,
    },
  });

  if (!target) throw ApiError.notFound('User not found');

  // Rule 2: granting or removing super admin is a super-admin-only action.
  if (data.isSuperAdmin !== undefined && data.isSuperAdmin !== target.isSuperAdmin) {
    if (!actor.isSuperAdmin) {
      throw ApiError.forbidden('Only the super admin can change super admin status', {
        code: 'SUPER_ADMIN_ONLY',
      });
    }

    // Rule 1: never remove the last one.
    if (target.isSuperAdmin && data.isSuperAdmin === false) {
      await assertNotLastSuperAdmin(target.id);
    }
  }

  if (data.roleId) {
    const role = await prisma.role.findUnique({ where: { id: data.roleId }, select: { id: true } });
    if (!role) throw ApiError.badRequest('The selected role does not exist');
  }

  const updated = await prisma.user.update({
    where: { id },
    data: {
      roleId: data.roleId === undefined ? undefined : data.roleId,
      extraPermissions: data.extraPermissions,
      deniedPermissions: data.deniedPermissions,
      isSuperAdmin: data.isSuperAdmin,
    },
    select: { ...userListFields, extraPermissions: true, deniedPermissions: true },
  });

  // Access changed — existing sessions must not keep the old rights. (The auth
  // middleware re-reads permissions per request, so this is belt-and-braces;
  // it also forces a visible re-login, which is a useful signal to the user.)
  await revokeAllUserTokens(id);

  await recordAudit({
    actorId: actor.id,
    action: AUDIT_ACTIONS.USER_ACCESS_CHANGED,
    entityType: 'User',
    entityId: id,
    before: {
      roleId: target.roleId,
      extraPermissions: target.extraPermissions,
      deniedPermissions: target.deniedPermissions,
      isSuperAdmin: target.isSuperAdmin,
    },
    after: data,
    req: context.req,
  });

  return updated;
}

/** Replaces a user's team memberships wholesale. */
export async function updateTeams(id, { teams }, actor, context = {}) {
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  if (!user) throw ApiError.notFound('User not found');

  await prisma.$transaction([
    // Replace rather than diff: simpler, and the UI always sends the full set.
    prisma.teamMembership.deleteMany({ where: { userId: id } }),
    prisma.teamMembership.createMany({
      data: teams.map((team) => ({ userId: id, teamId: team.teamId, teamRole: team.teamRole })),
      skipDuplicates: true,
    }),
  ]);

  await recordAudit({
    actorId: actor.id,
    action: AUDIT_ACTIONS.TEAM_MEMBER_CHANGED,
    entityType: 'User',
    entityId: id,
    after: { teams },
    req: context.req,
  });

  return getUser(id);
}

/** Suspend or reactivate. Rule 4: this replaces deletion entirely. */
export async function setStatus(id, { status, reason }, actor, context = {}) {
  if (id === actor.id) {
    throw ApiError.forbidden('You cannot suspend your own account');
  }

  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, status: true, isSuperAdmin: true },
  });

  if (!target) throw ApiError.notFound('User not found');

  if (status === 'SUSPENDED' && target.isSuperAdmin) {
    if (!actor.isSuperAdmin) {
      throw ApiError.forbidden('Only the super admin can suspend another super admin');
    }
    await assertNotLastSuperAdmin(target.id);
  }

  const updated = await prisma.user.update({
    where: { id },
    data: {
      status,
      // Reactivating should clear a lockout, otherwise the person still cannot
      // sign in and nobody understands why.
      ...(status === 'ACTIVE' ? { failedLoginAttempts: 0, lockedUntil: null } : {}),
    },
    select: userListFields,
  });

  // Suspension must take effect NOW, not when the access token expires.
  if (status === 'SUSPENDED') await revokeAllUserTokens(id);

  await recordAudit({
    actorId: actor.id,
    action: status === 'SUSPENDED' ? AUDIT_ACTIONS.USER_SUSPENDED : AUDIT_ACTIONS.USER_REACTIVATED,
    entityType: 'User',
    entityId: id,
    before: { status: target.status },
    after: { status, reason },
    req: context.req,
  });

  return updated;
}

/**
 * Admin-forced password reset.
 *
 * Generates a random temporary password and sets `mustChangePassword`, so the
 * user is required to replace it at next login (enforced server-side by
 * middleware/auth.js — it is not merely a UI prompt).
 */
export async function adminResetPassword(id, actor, context = {}) {
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, fullName: true },
  });

  if (!user) throw ApiError.notFound('User not found');

  // 18 random bytes -> 24 URL-safe characters. Not meant to be memorised.
  const temporaryPassword = generateToken(18);

  await prisma.user.update({
    where: { id },
    data: {
      passwordHash: await hashPassword(temporaryPassword),
      mustChangePassword: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
  });

  await revokeAllUserTokens(id);

  await recordAudit({
    actorId: actor.id,
    action: AUDIT_ACTIONS.PASSWORD_CHANGED,
    entityType: 'User',
    entityId: id,
    after: { by: 'admin_reset' },
    req: context.req,
  });

  logger.info({ userId: id, by: actor.id }, 'Admin reset a user password');

  // Returned so the admin can read it out in person — the most reliable channel
  // at a station where someone may not have email access on shift.
  return { temporaryPassword, email: user.email };
}

/**
 * Rule 1, in one place so every caller gets the same protection.
 * @throws {ApiError} 409 when this is the only remaining active super admin.
 */
async function assertNotLastSuperAdmin(excludeUserId) {
  const remaining = await prisma.user.count({
    where: { isSuperAdmin: true, status: 'ACTIVE', id: { not: excludeUserId } },
  });

  if (remaining === 0) {
    throw ApiError.conflict(
      'This is the only active super admin. Promote another user first, or the station would be locked out.',
      { code: 'LAST_SUPER_ADMIN' },
    );
  }
}
