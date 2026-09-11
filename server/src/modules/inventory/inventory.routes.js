/**
 * =============================================================================
 *  Inventory routes
 * =============================================================================
 *  One router serves BOTH stores. The clothing screens and the equipment
 *  screens call the same endpoints with a different `categoryKey`, which is why
 *  there is no duplicated "clothing" API.
 *
 *  Route order matters: literal paths ('/categories', '/movements') are
 *  registered before '/items/:id' so they cannot be captured as an id.
 * =============================================================================
 */

import { Router } from 'express';
import { z } from 'zod';
import * as service from './inventory.service.js';
import * as schema from './inventory.validators.js';
import { prisma } from '../../config/db.js';
import { validate } from '../../middleware/validate.js';
import { requirePermission } from '../../middleware/auth.js';
import { writeLimiter } from '../../middleware/rateLimiters.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/ApiError.js';
import { hasPermission } from '../../services/access.service.js';
import { queryBoolean } from '../../utils/crudRouter.js';
import { cuidParam } from '../users/users.validators.js';
import { recordAudit, AUDIT_ACTIONS } from '../../services/audit.service.js';

const router = Router();

// =============================================================================
//  CATEGORIES & DYNAMIC FIELDS
//  "The super admin can change the fields and the tracked section."
// =============================================================================

router.get(
  '/categories',
  requirePermission('inventory.item:read'),
  validate({ query: z.object({ includeInactive: queryBoolean }) }),
  asyncHandler(async (req, res) => {
    res.json({ data: await service.listCategories(req.validated.query) });
  }),
);

router.post(
  '/categories',
  requirePermission('inventory.category:manage'),
  writeLimiter,
  validate({ body: schema.createCategorySchema }),
  asyncHandler(async (req, res) => {
    const category = await prisma.itemCategory.create({ data: req.validated.body });

    await recordAudit({
      actorId: req.user.id,
      action: AUDIT_ACTIONS.CATEGORY_UPDATED,
      entityType: 'ItemCategory',
      entityId: category.id,
      after: category,
      req,
    });

    res.status(201).json({ data: category });
  }),
);

router.patch(
  '/categories/:id',
  requirePermission('inventory.category:manage'),
  writeLimiter,
  validate({ params: cuidParam, body: schema.updateCategorySchema }),
  asyncHandler(async (req, res) => {
    const category = await prisma.itemCategory.update({
      where: { id: req.validated.params.id },
      data: req.validated.body,
    });

    await recordAudit({
      actorId: req.user.id,
      action: AUDIT_ACTIONS.CATEGORY_UPDATED,
      entityType: 'ItemCategory',
      entityId: category.id,
      after: category,
      req,
    });

    res.json({ data: category });
  }),
);

/** Add or edit one dynamic field on a category. Keyed upsert — see the service. */
router.put(
  '/categories/:id/fields',
  requirePermission('inventory.category:manage'),
  writeLimiter,
  validate({ params: cuidParam, body: schema.attributeDefSchema }),
  asyncHandler(async (req, res) => {
    const definition = await service.upsertAttributeDef(
      req.validated.params.id,
      req.validated.body,
      req.user,
      { req },
    );

    res.json({ data: definition });
  }),
);

router.delete(
  '/fields/:id',
  requirePermission('inventory.category:manage'),
  writeLimiter,
  validate({ params: cuidParam }),
  asyncHandler(async (req, res) => {
    await service.deleteAttributeDef(req.validated.params.id, req.user, { req });
    res.status(204).send();
  }),
);

// =============================================================================
//  REPORTS  (before '/items/:id' so they are not read as item ids)
// =============================================================================

router.get(
  '/summary',
  requirePermission('inventory.item:read'),
  validate({ query: z.object({ categoryId: z.string().cuid().optional() }) }),
  asyncHandler(async (req, res) => {
    res.json({ data: await service.getStockSummary(req.validated.query.categoryId) });
  }),
);

router.get(
  '/expiring',
  requirePermission('inventory.item:read'),
  validate({ query: schema.expiringQuery }),
  asyncHandler(async (req, res) => {
    res.json(await service.listExpiring(req.validated.query));
  }),
);

// =============================================================================
//  STOCK MOVEMENTS — the in/out log
// =============================================================================

router.get(
  '/movements',
  requirePermission('inventory.movement:read'),
  validate({ query: schema.listMovementsQuery }),
  asyncHandler(async (req, res) => {
    res.json(await service.listMovements(req.validated.query));
  }),
);

router.post(
  '/movements',
  requirePermission('inventory.movement:create'),
  writeLimiter,
  validate({ body: schema.createMovementSchema }),
  asyncHandler(async (req, res) => {
    // ADJUST is a separate permission: correcting a balance rewrites what the
    // store believes it holds, which is a bigger deal than recording a receipt.
    if (req.validated.body.direction === 'ADJUST') {
      requireAdjustPermission(req);
    }

    const result = await service.createMovement(req.validated.body, req.user, { req });
    res.status(201).json({ data: result });
  }),
);

/** Several lines, one transaction — issuing a uniform, restocking a vehicle. */
router.post(
  '/movements/bulk',
  requirePermission('inventory.movement:create'),
  writeLimiter,
  validate({ body: schema.createBulkMovementSchema }),
  asyncHandler(async (req, res) => {
    if (req.validated.body.direction === 'ADJUST') {
      requireAdjustPermission(req);
    }

    const results = await service.createBulkMovements(req.validated.body, req.user, { req });
    res.status(201).json({ data: results, meta: { created: results.length } });
  }),
);

// =============================================================================
//  ITEMS
// =============================================================================

router.get(
  '/items',
  requirePermission('inventory.item:read'),
  validate({ query: schema.listItemsQuery }),
  asyncHandler(async (req, res) => {
    res.json(await service.listItems(req.validated.query));
  }),
);

router.post(
  '/items',
  requirePermission('inventory.item:create'),
  writeLimiter,
  validate({ body: schema.createItemSchema }),
  asyncHandler(async (req, res) => {
    const item = await service.createItem(req.validated.body, req.user, { req });
    res.status(201).json({ data: item });
  }),
);

router.get(
  '/items/:id',
  requirePermission('inventory.item:read'),
  validate({ params: cuidParam }),
  asyncHandler(async (req, res) => {
    res.json({ data: await service.getItem(req.validated.params.id) });
  }),
);

router.patch(
  '/items/:id',
  requirePermission('inventory.item:update'),
  writeLimiter,
  validate({ params: cuidParam, body: schema.updateItemSchema }),
  asyncHandler(async (req, res) => {
    const item = await service.updateItem(
      req.validated.params.id,
      req.validated.body,
      req.user,
      { req },
    );
    res.json({ data: item });
  }),
);

router.delete(
  '/items/:id',
  requirePermission('inventory.item:delete'),
  writeLimiter,
  validate({ params: cuidParam }),
  asyncHandler(async (req, res) => {
    await service.deactivateItem(req.validated.params.id, req.user, { req });
    res.status(204).send();
  }),
);

/**
 * A second permission check performed INSIDE the handler.
 *
 * Route-level middleware runs before the body is inspected, and whether this
 * request needs `inventory.movement:adjust` depends on `body.direction`. So the
 * base permission (`movement:create`) is enforced on the route, and this extra
 * requirement is enforced here once we can see what is actually being asked.
 */
function requireAdjustPermission(req) {
  if (!hasPermission(req.user, 'inventory.movement:adjust')) {
    throw ApiError.forbidden('You do not have permission to adjust stock levels', {
      code: 'MISSING_PERMISSION',
      details: { required: 'inventory.movement:adjust' },
    });
  }
}

export default router;
