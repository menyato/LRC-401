/**
 * =============================================================================
 *  Activity log (read-only)
 * =============================================================================
 *  There is deliberately NO write, update or delete endpoint here. The audit
 *  trail is append-only, and the only code that appends to it is
 *  services/audit.service.js. If this router offered a DELETE, the log would
 *  stop being evidence of anything.
 * =============================================================================
 */

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/db.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { validate } from '../../middleware/validate.js';
import { requirePermission } from '../../middleware/auth.js';
import { paginate, toPrismaPagination, paginationQuery } from '../../utils/pagination.js';
import { AUDIT_ACTIONS } from '../../services/audit.service.js';
import { dateOnly } from '../inventory/inventory.validators.js';

const router = Router();

const listQuery = paginationQuery.extend({
  actorId: z.string().cuid().optional(),
  action: z.string().max(60).optional(),
  entityType: z.string().max(40).optional(),
  entityId: z.string().max(40).optional(),
  dateFrom: dateOnly.optional(),
  dateTo: dateOnly.optional(),
});

router.get(
  '/',
  requirePermission('audit:read'),
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const query = req.validated.query;
    const pagination = toPrismaPagination(query);

    const where = {
      ...(query.actorId ? { actorId: query.actorId } : {}),
      // `startsWith` so "inventory." matches every inventory action — the
      // filter dropdown offers both whole actions and their prefixes.
      ...(query.action ? { action: { startsWith: query.action } } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            createdAt: {
              ...(query.dateFrom ? { gte: query.dateFrom } : {}),
              // The end date is inclusive of the whole day: `createdAt` is a
              // timestamp, so "lte 2026-09-14T00:00:00Z" would drop everything
              // that happened on the 14th. Add a day instead.
              ...(query.dateTo ? { lt: addOneDay(query.dateTo) } : {}),
            },
          }
        : {}),
    };

    res.json(
      await paginate(
        prisma.auditLog,
        {
          where,
          include: { actor: { select: { id: true, fullName: true, email: true } } },
          orderBy: { createdAt: 'desc' },
          skip: pagination.skip,
          take: pagination.take,
        },
        { page: query.page, limit: query.limit },
      ),
    );
  }),
);

/**
 * The action catalogue, so the filter dropdown is built from the same constants
 * the writers use and can never drift out of date.
 */
router.get(
  '/actions',
  requirePermission('audit:read'),
  asyncHandler(async (_req, res) => {
    res.json({ data: Object.values(AUDIT_ACTIONS).sort() });
  }),
);

function addOneDay(date) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

export default router;
