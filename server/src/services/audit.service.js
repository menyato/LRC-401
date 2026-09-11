/**
 * =============================================================================
 *  Audit service
 * =============================================================================
 *  Records WHO changed WHAT, WHEN and FROM WHERE.
 *
 *  For a Red Cross station this is not bureaucracy — it answers real questions:
 *    "who issued 20 tourniquets last Tuesday?"
 *    "who changed the threshold so the vehicle stopped showing as short?"
 *    "who gave this volunteer access to the clothing store?"
 *
 *  Two rules make the trail trustworthy:
 *    1. APPEND ONLY. Nothing updates or deletes an AuditLog row — there is no
 *       code path that does, and no permission that allows it.
 *    2. AUDITING MUST NEVER BREAK THE ACTION. If writing the log fails, we log
 *       the failure and let the original operation succeed. Losing one audit row
 *       is bad; refusing to let a medic record stock at 3am because the audit
 *       insert timed out is worse.
 * =============================================================================
 */

import { prisma } from '../config/db.js';
import { logger } from '../utils/logger.js';

/**
 * Canonical action names. Using constants rather than free-form strings means
 * the activity-log filter dropdown can be built from this object, and a typo
 * cannot create an action nobody will ever be able to search for.
 */
export const AUDIT_ACTIONS = {
  // Authentication
  LOGIN_SUCCESS: 'auth.login.success',
  LOGIN_FAILED: 'auth.login.failed',
  LOGOUT: 'auth.logout',
  PASSWORD_CHANGED: 'auth.password.changed',
  PASSWORD_RESET_REQUESTED: 'auth.password.reset_requested',
  PASSWORD_RESET_COMPLETED: 'auth.password.reset_completed',
  TWO_FACTOR_ENABLED: 'auth.2fa.enabled',
  TWO_FACTOR_DISABLED: 'auth.2fa.disabled',
  TWO_FACTOR_FAILED: 'auth.2fa.failed',

  // People & access
  USER_INVITED: 'user.invited',
  USER_INVITE_ACCEPTED: 'user.invite.accepted',
  USER_INVITE_REVOKED: 'user.invite.revoked',
  USER_UPDATED: 'user.updated',
  USER_ACCESS_CHANGED: 'user.access.changed',
  USER_SUSPENDED: 'user.suspended',
  USER_REACTIVATED: 'user.reactivated',
  ROLE_CREATED: 'role.created',
  ROLE_UPDATED: 'role.updated',
  ROLE_DELETED: 'role.deleted',

  // Org
  TEAM_CREATED: 'team.created',
  TEAM_UPDATED: 'team.updated',
  TEAM_MEMBER_CHANGED: 'team.member.changed',
  VEHICLE_CREATED: 'vehicle.created',
  VEHICLE_UPDATED: 'vehicle.updated',
  VEHICLE_RULE_CHANGED: 'vehicle.rule.changed',
  ASSIGNMENT_CREATED: 'assignment.created',
  ASSIGNMENT_UPDATED: 'assignment.updated',
  ASSIGNMENT_DELETED: 'assignment.deleted',

  // Inventory
  ITEM_CREATED: 'inventory.item.created',
  ITEM_UPDATED: 'inventory.item.updated',
  ITEM_DEACTIVATED: 'inventory.item.deactivated',
  CATEGORY_UPDATED: 'inventory.category.updated',
  ATTRIBUTE_DEF_CHANGED: 'inventory.attribute.changed',
  STOCK_IN: 'inventory.stock.in',
  STOCK_OUT: 'inventory.stock.out',
  STOCK_TRANSFERRED: 'inventory.stock.transferred',
  STOCK_ADJUSTED: 'inventory.stock.adjusted',

  // Restock workflow
  RESTOCK_CREATED: 'restock.created',
  RESTOCK_ASSIGNED: 'restock.assigned',
  RESTOCK_STATUS_CHANGED: 'restock.status.changed',
  RESTOCK_FULFILLED: 'restock.fulfilled',
  RESTOCK_CONFIRMED: 'restock.confirmed',
  RESTOCK_CANCELLED: 'restock.cancelled',

  // Reports
  TEMPLATE_CREATED: 'form.template.created',
  TEMPLATE_UPDATED: 'form.template.updated',
  TEMPLATE_PUBLISHED: 'form.template.published',
  SUBMISSION_SAVED: 'form.submission.saved',
  SUBMISSION_SUBMITTED: 'form.submission.submitted',
  SUBMISSION_REVIEWED: 'form.submission.reviewed',

  // Station
  SETTING_UPDATED: 'settings.updated',
};

/**
 * Keys stripped from `before`/`after` snapshots before they are stored.
 *
 * The audit log is one of the most-read tables by design, so it must never
 * become the place where a password hash or a 2FA secret ends up in clear.
 */
const SENSITIVE_KEYS = new Set([
  'password',
  'newPassword',
  'currentPassword',
  'passwordHash',
  'twoFactorSecret',
  'backupCodes',
  'tokenHash',
  'token',
]);

/** Recursively removes sensitive keys from a snapshot. */
function sanitize(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sanitize);

  const clean = {};
  for (const [key, val] of Object.entries(value)) {
    clean[key] = SENSITIVE_KEYS.has(key) ? '[Redacted]' : sanitize(val);
  }
  return clean;
}

/**
 * Writes one audit entry.
 *
 * @param {object} params
 * @param {string|null} params.actorId     Null for anonymous (failed login).
 * @param {string}      params.action      A value from AUDIT_ACTIONS.
 * @param {string}     [params.entityType] e.g. 'Item', 'FormSubmission'.
 * @param {string}     [params.entityId]
 * @param {object}     [params.before]     State before the change.
 * @param {object}     [params.after]      State after the change.
 * @param {object}     [params.req]        Express request, for ip/user-agent.
 * @returns {Promise<void>} Always resolves — never rejects.
 */
export async function recordAudit({ actorId, action, entityType, entityId, before, after, req }) {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: actorId ?? null,
        action,
        entityType,
        entityId,
        before: before ? sanitize(before) : undefined,
        after: after ? sanitize(after) : undefined,
        ipAddress: req?.ip,
        userAgent: req?.headers?.['user-agent']?.slice(0, 255),
      },
    });
  } catch (error) {
    // Swallow deliberately — see rule 2 in the header comment.
    logger.error({ err: error, action, entityId }, 'Failed to write audit log entry');
  }
}

/**
 * Convenience wrapper for the common "an authenticated user changed something"
 * case, so controllers stay to one line.
 *
 * @example
 *   await auditFromRequest(req, AUDIT_ACTIONS.ITEM_UPDATED, {
 *     entityType: 'Item', entityId: item.id, before: previous, after: updated,
 *   });
 */
export const auditFromRequest = (req, action, details = {}) =>
  recordAudit({ actorId: req.user?.id ?? null, action, req, ...details });
