/**
 * =============================================================================
 *  Per-vehicle rule exceptions
 * =============================================================================
 *  One form, one standard — plus a short list of documented exceptions per
 *  vehicle.
 *
 *  The alternative designs are both worse:
 *
 *    A form per vehicle    six forms to keep in step, guaranteed to drift apart
 *                          the first time somebody edits one and not the others.
 *
 *    No exceptions         vehicles permanently red for equipment they are not
 *                          supposed to carry. People stop reading a dashboard
 *                          that is always red, and then a REAL shortage is
 *                          missed. That is the failure mode worth avoiding.
 *
 *  `note` is effectively required (see the validator): in a year nobody will
 *  remember why 474 was exempted from something, and an undocumented exception
 *  is indistinguishable from a bug.
 * =============================================================================
 */

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/db.js';
import { ApiError } from '../../utils/ApiError.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { validate } from '../../middleware/validate.js';
import { requirePermission } from '../../middleware/auth.js';
import { writeLimiter } from '../../middleware/rateLimiters.js';
import { recordAudit, AUDIT_ACTIONS } from '../../services/audit.service.js';
import { cuidParam } from '../users/users.validators.js';

const router = Router();

const ruleBody = z
  .object({
    /** The question's stable key, from the form. */
    fieldKey: z.string().trim().min(1).max(60),
    /**
     * A GRID row. Empty string (the default) means the question as a whole.
     *
     * NOT nullable: PostgreSQL treats NULL as never equal to NULL, so a unique
     * index over a nullable column would not stop two rules for the same
     * question. A sentinel makes the constraint real. See the schema comment.
     */
    rowKey: z.string().trim().max(60).default(''),

    /** This vehicle does not carry the item at all. */
    isExcluded: z.boolean().default(false),

    expected: z.number().int().min(0).max(1000).nullish(),
    warnBelow: z.number().int().min(0).max(1000).nullish(),
    criticalBelow: z.number().int().min(0).max(1000).nullish(),
    priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).nullish(),

    /**
     * Why the exception exists.
     *
     * Deliberately required rather than optional. An exception with no reason
     * is indistinguishable from a mistake once the person who made it has left,
     * and the cost of typing eight words now is far lower than the cost of
     * nobody daring to remove it later.
     */
    note: z.string().trim().min(3, 'Please say why this vehicle is different').max(500),
  })
  // A rule that neither excludes nor changes anything is a no-op that would sit
  // in the list looking meaningful.
  .refine(
    (data) =>
      data.isExcluded ||
      data.expected !== null ||
      data.warnBelow !== null ||
      data.criticalBelow !== null ||
      data.priority !== null,
    { message: 'Either exclude the item or change one of its numbers' },
  );

// -----------------------------------------------------------------------------
//  GET /api/vehicles/:id/rules
// -----------------------------------------------------------------------------
router.get(
  '/:id/rules',
  requirePermission('vehicle:read'),
  validate({ params: cuidParam }),
  asyncHandler(async (req, res) => {
    const rules = await prisma.vehicleRuleOverride.findMany({
      where: { vehicleId: req.validated.params.id },
      orderBy: [{ fieldKey: 'asc' }, { rowKey: 'asc' }],
      include: { createdBy: { select: { id: true, fullName: true } } },
    });

    res.json({ data: rules });
  }),
);

// -----------------------------------------------------------------------------
//  PUT /api/vehicles/:id/rules — add or update one exception
//
//  PUT with an upsert keyed on (vehicle, field, row): editing an exception
//  updates it in place rather than stacking a second, conflicting rule for the
//  same question.
// -----------------------------------------------------------------------------
router.put(
  '/:id/rules',
  requirePermission('vehicle.rules:manage'),
  writeLimiter,
  validate({ params: cuidParam, body: ruleBody }),
  asyncHandler(async (req, res) => {
    const { id: vehicleId } = req.validated.params;
    const body = req.validated.body;

    const vehicle = await prisma.vehicle.findUnique({
      where: { id: vehicleId },
      select: { id: true, code: true },
    });

    if (!vehicle) throw ApiError.notFound('Vehicle not found');

    const rule = await prisma.vehicleRuleOverride.upsert({
      where: {
        vehicleId_fieldKey_rowKey: {
          vehicleId,
          fieldKey: body.fieldKey,
          rowKey: body.rowKey ?? '',
        },
      },
      create: {
        vehicleId,
        fieldKey: body.fieldKey,
        rowKey: body.rowKey ?? '',
        isExcluded: body.isExcluded,
        expected: body.expected ?? null,
        warnBelow: body.warnBelow ?? null,
        criticalBelow: body.criticalBelow ?? null,
        priority: body.priority ?? null,
        note: body.note,
        createdById: req.user.id,
      },
      update: {
        isExcluded: body.isExcluded,
        expected: body.expected ?? null,
        warnBelow: body.warnBelow ?? null,
        criticalBelow: body.criticalBelow ?? null,
        priority: body.priority ?? null,
        note: body.note,
      },
    });

    await recordAudit({
      actorId: req.user.id,
      action: AUDIT_ACTIONS.VEHICLE_RULE_CHANGED,
      entityType: 'VehicleRuleOverride',
      entityId: rule.id,
      after: { vehicle: vehicle.code, ...body },
      req,
    });

    res.json({ data: rule });
  }),
);

// -----------------------------------------------------------------------------
//  DELETE /api/vehicles/:id/rules/:ruleId — the vehicle returns to the standard
// -----------------------------------------------------------------------------
router.delete(
  '/:id/rules/:ruleId',
  requirePermission('vehicle.rules:manage'),
  writeLimiter,
  validate({ params: z.object({ id: z.string().cuid(), ruleId: z.string().cuid() }) }),
  asyncHandler(async (req, res) => {
    const { id: vehicleId, ruleId } = req.validated.params;

    const rule = await prisma.vehicleRuleOverride.findFirst({
      where: { id: ruleId, vehicleId },
    });

    if (!rule) throw ApiError.notFound('Rule not found for this vehicle');

    await prisma.vehicleRuleOverride.delete({ where: { id: ruleId } });

    await recordAudit({
      actorId: req.user.id,
      action: AUDIT_ACTIONS.VEHICLE_RULE_CHANGED,
      entityType: 'VehicleRuleOverride',
      entityId: ruleId,
      before: rule,
      after: { removed: true },
      req,
    });

    res.status(204).send();
  }),
);

export default router;
