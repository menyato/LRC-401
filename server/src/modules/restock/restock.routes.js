/**
 * =============================================================================
 *  Restock board routes
 * =============================================================================
 *  Note how the permissions are split. Moving a card and moving STOCK are
 *  deliberately different rights:
 *
 *    restock:read     see the board
 *    restock:create   raise a job from a report's shortages
 *    restock:assign   hand a job to somebody
 *    restock:prepare  gather the items and set them aside (equipment officer)
 *    restock:confirm  confirm they are loaded — this actually transfers stock
 *                     (the crew)
 *
 *  A volunteer can be trusted to drag a card without being trusted to move the
 *  station's stock, and the split makes that expressible.
 * =============================================================================
 */

import { Router } from 'express';
import { z } from 'zod';
import * as service from './restock.service.js';
import { validate } from '../../middleware/validate.js';
import { requirePermission } from '../../middleware/auth.js';
import { writeLimiter } from '../../middleware/rateLimiters.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { cuidParam } from '../users/users.validators.js';

const router = Router();

// -----------------------------------------------------------------------------
//  GET /api/restock/board
// -----------------------------------------------------------------------------
router.get(
  '/board',
  requirePermission('restock:read'),
  validate({
    query: z.object({
      teamId: z.string().cuid().optional(),
      vehicleId: z.string().cuid().optional(),
      days: z.coerce.number().int().min(1).max(180).default(30),
    }),
  }),
  asyncHandler(async (req, res) => {
    res.json({ data: await service.getBoard(req.validated.query, req.user) });
  }),
);

// -----------------------------------------------------------------------------
//  POST /api/restock/from-submission/:id
//  Raises a job from the shortages a reviewer ticked.
// -----------------------------------------------------------------------------
router.post(
  '/from-submission/:id',
  requirePermission('restock:create'),
  writeLimiter,
  validate({
    params: cuidParam,
    body: z.object({
      /**
       * Which shortages to act on. Identified by the field/row keys from the
       * report's stored summary — the server reads the labels and quantities
       * from that summary rather than trusting what the client sends, so a
       * crafted request cannot invent a line for an item nobody was short of.
       */
      selections: z
        .array(
          z.object({
            field: z.string().max(60),
            row: z.string().max(60).nullish(),
            /** Override the suggested quantity — they may top up further. */
            quantityNeeded: z.number().int().min(1).max(1000).optional(),
            /** Needed when the linked item is size-tracked. */
            size: z.string().trim().max(20).nullish(),
          }),
        )
        .min(1, 'Select at least one item to restock')
        .max(200),
      assignedToId: z.string().cuid().nullish(),
      sourceLocationId: z.string().cuid().nullish(),
      note: z.string().trim().max(1000).nullish(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const request = await service.createFromSubmission(
      req.validated.params.id,
      req.validated.body,
      req.user,
      { req },
    );

    res.status(201).json({ data: request });
  }),
);

// -----------------------------------------------------------------------------
//  GET /api/restock/:id
// -----------------------------------------------------------------------------
router.get(
  '/:id',
  requirePermission('restock:read'),
  validate({ params: cuidParam }),
  asyncHandler(async (req, res) => {
    res.json({ data: await service.getRequest(req.validated.params.id, req.user) });
  }),
);

// -----------------------------------------------------------------------------
//  PATCH /api/restock/:id/status — move the card
//
//  Guarded by `restock:read` at the route level only. The stricter rights for
//  PREPARING/READY (`restock:prepare`) and CONFIRMED (`restock:confirm`) are
//  checked inside the service, because which one applies depends on the target
//  status in the body — something route middleware cannot see.
// -----------------------------------------------------------------------------
router.patch(
  '/:id/status',
  requirePermission('restock:read'),
  writeLimiter,
  validate({
    params: cuidParam,
    body: z.object({
      status: z.enum(['OPEN', 'PREPARING', 'READY', 'CONFIRMED', 'CANCELLED']),
      /**
       * What the crew ACTUALLY took, per line. Sent when confirming, so a
       * short collection is recorded honestly rather than the vehicle being
       * credited with items nobody received.
       */
      lineQuantities: z
        .array(
          z.object({
            lineId: z.string().cuid(),
            quantityIssued: z.number().int().min(0).max(10000),
          }),
        )
        .max(200)
        .optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const request = await service.changeStatus(
      req.validated.params.id,
      req.validated.body,
      req.user,
      { req },
    );

    res.json({ data: request });
  }),
);

// -----------------------------------------------------------------------------
//  PATCH /api/restock/:id/assign
// -----------------------------------------------------------------------------
router.patch(
  '/:id/assign',
  requirePermission('restock:assign'),
  writeLimiter,
  validate({
    params: cuidParam,
    body: z.object({ assignedToId: z.string().cuid().nullish() }),
  }),
  asyncHandler(async (req, res) => {
    res.json({
      data: await service.assign(req.validated.params.id, req.validated.body, req.user, { req }),
    });
  }),
);

// -----------------------------------------------------------------------------
//  PATCH /api/restock/:id/lines/:lineId
// -----------------------------------------------------------------------------
router.patch(
  '/:id/lines/:lineId',
  requirePermission('restock:create'),
  writeLimiter,
  validate({
    params: z.object({ id: z.string().cuid(), lineId: z.string().cuid() }),
    body: z.object({
      quantityNeeded: z.number().int().min(1).max(10000).optional(),
      size: z.string().trim().max(20).nullish(),
      itemId: z.string().cuid().nullish(),
      priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(),
      note: z.string().trim().max(500).nullish(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { id, lineId } = req.validated.params;

    res.json({ data: await service.updateLine(id, lineId, req.validated.body, req.user, { req }) });
  }),
);

export default router;
