/**
 * =============================================================================
 *  Equipment report routes
 * =============================================================================
 *  Note the guards: reads use `requireAnyPermission` with all three read
 *  scopes, because the SCOPE (not the permission) decides which rows come back.
 *  A user with only `submission:read.own` reaches the same endpoint and simply
 *  receives their own reports — one route, three audiences, no duplication.
 * =============================================================================
 */

import { Router } from 'express';
import * as service from './submissions.service.js';
import * as schema from './submissions.validators.js';
import { validate } from '../../middleware/validate.js';
import { requirePermission, requireAnyPermission } from '../../middleware/auth.js';
import { writeLimiter } from '../../middleware/rateLimiters.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { cuidParam } from '../users/users.validators.js';

const router = Router();

/** Any of these three grants access to the read endpoints; scope narrows rows. */
const READ_PERMISSIONS = ['submission:read.own', 'submission:read.team', 'submission:read.all'];

// -----------------------------------------------------------------------------
//  GET /api/submissions/board?teamId=&date=YYYY-MM-DD
//  The team admin's day view — declared before '/:id' so "board" is not read
//  as a submission id.
// -----------------------------------------------------------------------------
router.get(
  '/board',
  requireAnyPermission(READ_PERMISSIONS),
  validate({ query: schema.boardQuery }),
  asyncHandler(async (req, res) => {
    res.json({ data: await service.getDayBoard(req.validated.query, req.user) });
  }),
);

// -----------------------------------------------------------------------------
//  GET /api/submissions — paginated, scoped list
// -----------------------------------------------------------------------------
router.get(
  '/',
  requireAnyPermission(READ_PERMISSIONS),
  validate({ query: schema.listSubmissionsQuery }),
  asyncHandler(async (req, res) => {
    res.json(await service.listSubmissions(req.validated.query, req.user));
  }),
);

// -----------------------------------------------------------------------------
//  POST /api/submissions — save a draft or submit
//  One endpoint for both: `status` in the body decides, and the service applies
//  the extra required-field checks only when submitting.
// -----------------------------------------------------------------------------
router.post(
  '/',
  requirePermission('submission:create'),
  writeLimiter,
  validate({ body: schema.saveSubmissionSchema }),
  asyncHandler(async (req, res) => {
    const submission = await service.saveSubmission(req.validated.body, req.user, { req });
    res.status(201).json({ data: submission });
  }),
);

// -----------------------------------------------------------------------------
//  GET /api/submissions/:id — full report + the template it was filled against
// -----------------------------------------------------------------------------
router.get(
  '/:id',
  requireAnyPermission(READ_PERMISSIONS),
  validate({ params: cuidParam }),
  asyncHandler(async (req, res) => {
    res.json({ data: await service.getSubmission(req.validated.params.id, req.user) });
  }),
);

// -----------------------------------------------------------------------------
//  POST /api/submissions/:id/review
// -----------------------------------------------------------------------------
router.post(
  '/:id/review',
  requirePermission('submission:review'),
  writeLimiter,
  validate({ params: cuidParam, body: schema.reviewSubmissionSchema }),
  asyncHandler(async (req, res) => {
    const submission = await service.reviewSubmission(
      req.validated.params.id,
      req.validated.body,
      req.user,
      { req },
    );
    res.json({ data: submission });
  }),
);

export default router;
