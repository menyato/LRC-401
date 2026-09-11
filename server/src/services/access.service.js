/**
 * =============================================================================
 *  Access service — the single authority on "who may do what, to which rows".
 * =============================================================================
 *  Two separate questions get answered here, and keeping them separate is the
 *  key idea of the whole authorisation design:
 *
 *    1. PERMISSION — "may you read equipment reports at all?"
 *       Answered by a string check.  ->  hasPermission()
 *
 *    2. SCOPE      — "whose equipment reports?"
 *       Answered by a mandatory SQL WHERE clause.  ->  buildSubmissionScope()
 *
 *  A permission check alone is not enough for this project. Your brief says a
 *  team admin sees "this date only" — that is not a different permission, it is
 *  the same permission over a narrower slice of rows. Enforcing that in the
 *  query (rather than filtering after loading, or hiding UI) is what makes it
 *  real: an out-of-scope row is simply never selected, so it cannot leak
 *  through a forgotten check or a crafted request.
 * =============================================================================
 */

import { prisma } from '../config/db.js';

/**
 * The shape every authenticated request carries on `req.user`.
 * Loaded once per request by the auth middleware.
 *
 * This typedef is the CONTRACT for `req.user`. Type-checking (`npm run
 * typecheck`) enforces it: it was previously missing five of the fields
 * `loadActor` actually returns, so anything reading `req.user.locale` or
 * `req.user.role` was working by luck rather than by documented agreement.
 * Keep it in step with `loadActor` below.
 *
 * @typedef {object} ActorUser
 * @property {string}   id
 * @property {string}   email
 * @property {string}   fullName
 * @property {string}   status         INVITED | ACTIVE | SUSPENDED
 * @property {string}   locale         'en' | 'ar' — drives RTL in the UI.
 * @property {boolean}  isSuperAdmin
 * @property {boolean}  mustChangePassword
 * @property {boolean}  twoFactorEnabled
 * @property {Date|null} sessionsRevokedAt  Cut-off for access tokens issued
 *                                          before a password change, suspension
 *                                          or permission change.
 * @property {{id: string, key: string, nameEn: string, nameAr: string,
 *             permissions: string[]}|null} role
 * @property {string[]} permissions   Already-resolved effective permissions.
 * @property {string[]} adminTeamIds  Teams where this user is TEAM_ADMIN.
 * @property {string[]} memberTeamIds Every team the user belongs to.
 */

/**
 * Computes effective permissions:
 *
 *      role.permissions  ∪  user.extraPermissions  −  user.deniedPermissions
 *
 * DENY WINS. That ordering is deliberate: an admin who removes one dangerous
 * ability from a person must be able to trust that adding a broad role later
 * does not silently hand it back.
 *
 * @param {{ isSuperAdmin: boolean,
 *           role?: { permissions: string[] } | null,
 *           extraPermissions: string[],
 *           deniedPermissions: string[] }} user
 * @returns {string[]}
 */
export function computeEffectivePermissions(user) {
  // The super admin's permission list is not consulted anywhere — every check
  // short-circuits on isSuperAdmin. We return a marker for display purposes.
  if (user.isSuperAdmin) return ['*'];

  const granted = new Set([...(user.role?.permissions ?? []), ...(user.extraPermissions ?? [])]);

  for (const denied of user.deniedPermissions ?? []) {
    granted.delete(denied);
  }

  return [...granted];
}

/**
 * @param {ActorUser} user
 * @param {string} permission
 * @returns {boolean}
 */
export function hasPermission(user, permission) {
  if (!user) return false;
  // One rule, checked first, everywhere: the super admin can always act. This
  // is what guarantees the station can never lock itself out of its own system.
  if (user.isSuperAdmin) return true;
  return user.permissions.includes(permission);
}

/** True when the user holds AT LEAST ONE of the listed permissions. */
export const hasAnyPermission = (user, permissions) =>
  permissions.some((permission) => hasPermission(user, permission));

/** True when the user holds EVERY listed permission. */
export const hasAllPermissions = (user, permissions) =>
  permissions.every((permission) => hasPermission(user, permission));

/**
 * Loads the full actor record for a verified user id.
 *
 * Called once per authenticated request. The `select` is explicit and narrow —
 * never `include: { role: true }` with a bare user fetch — so that
 * `passwordHash` and `twoFactorSecret` can never end up attached to `req.user`
 * and from there into a log line or a JSON response.
 *
 * @param {string} userId
 * @returns {Promise<ActorUser|null>}
 */
export async function loadActor(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      fullName: true,
      status: true,
      locale: true,
      isSuperAdmin: true,
      mustChangePassword: true,
      twoFactorEnabled: true,
      sessionsRevokedAt: true,
      extraPermissions: true,
      deniedPermissions: true,
      role: { select: { id: true, key: true, nameEn: true, nameAr: true, permissions: true } },
      memberships: { select: { teamId: true, teamRole: true } },
    },
  });

  if (!user) return null;

  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    status: user.status,
    locale: user.locale,
    isSuperAdmin: user.isSuperAdmin,
    mustChangePassword: user.mustChangePassword,
    twoFactorEnabled: user.twoFactorEnabled,
    sessionsRevokedAt: user.sessionsRevokedAt,
    role: user.role,
    permissions: computeEffectivePermissions(user),
    adminTeamIds: user.memberships
      .filter((membership) => membership.teamRole === 'TEAM_ADMIN')
      .map((membership) => membership.teamId),
    memberTeamIds: user.memberships.map((membership) => membership.teamId),
  };
}

// =============================================================================
//  SCOPE BUILDERS
// =============================================================================
//  Each returns a Prisma `where` fragment that MUST be spread into the query.
//  Returning `null` means "no access at all" and the caller replies 403.
// =============================================================================

/**
 * Picks the widest read scope the user holds for equipment reports.
 * @returns {'all'|'team'|'own'|null}
 */
export function resolveSubmissionScope(user) {
  if (user.isSuperAdmin || hasPermission(user, 'submission:read.all')) return 'all';
  if (hasPermission(user, 'submission:read.team')) return 'team';
  if (hasPermission(user, 'submission:read.own')) return 'own';
  return null;
}

/**
 * The row filter for equipment reports.
 *
 * @param {ActorUser} user
 * @returns {object|null} Prisma `where` fragment, or null when unauthorised.
 *
 * @example
 *   const scope = buildSubmissionScope(req.user);
 *   if (!scope) throw ApiError.forbidden();
 *   prisma.formSubmission.findMany({ where: { ...scope, ...userFilters } });
 */
export function buildSubmissionScope(user) {
  switch (resolveSubmissionScope(user)) {
    case 'all':
      // Empty object = no restriction. Spreads cleanly into any `where`.
      return {};

    case 'team':
      // A team admin sees their teams' reports AND their own submissions —
      // otherwise a team admin who is also on the road could not review a
      // report they filed for a team they do not lead.
      return {
        OR: [{ teamId: { in: user.adminTeamIds } }, { submittedById: user.id }],
      };

    case 'own':
      return { submittedById: user.id };

    default:
      return null;
  }
}

/** Same idea for shift assignments. */
export function buildAssignmentScope(user) {
  if (user.isSuperAdmin || hasPermission(user, 'assignment:read.all')) return {};

  if (hasPermission(user, 'assignment:read.team')) {
    return {
      OR: [
        // Teams they lead...
        { teamId: { in: user.adminTeamIds } },
        // ...teams they merely belong to (so an EMT can see their own roster)...
        { teamId: { in: user.memberTeamIds } },
        // ...and anything they are personally rostered on.
        { firstPersonId: user.id },
        { secondPersonId: user.id },
      ],
    };
  }

  return { OR: [{ firstPersonId: user.id }, { secondPersonId: user.id }] };
}

/**
 * Guard used before WRITING a submission: may this person file/edit the report
 * for this vehicle on this date?
 *
 * Rule: you must be rostered on that vehicle for that date, unless you hold
 * team-wide or station-wide report access.
 *
 * This is what stops a volunteer from filing a report for a vehicle they were
 * never on — which would corrupt the station's equipment history.
 *
 * @returns {Promise<boolean>}
 */
export async function canSubmitForAssignment(user, { vehicleId, shiftDate, teamId }) {
  if (user.isSuperAdmin || hasPermission(user, 'submission:read.all')) return true;

  // A team admin may file for any vehicle of a team they lead.
  if (hasPermission(user, 'submission:read.team') && user.adminTeamIds.includes(teamId)) {
    return true;
  }

  const assignment = await prisma.assignment.findFirst({
    where: {
      vehicleId,
      shiftDate,
      OR: [{ firstPersonId: user.id }, { secondPersonId: user.id }],
    },
    select: { id: true },
  });

  return Boolean(assignment);
}
