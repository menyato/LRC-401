/**
 * =============================================================================
 *  Users routes + controller
 * =============================================================================
 *  For small modules the controller lives beside the routes: splitting a
 *  six-line handler into its own file adds a hop when reading without adding
 *  clarity. Larger modules (auth, inventory, submissions) keep them separate.
 * =============================================================================
 */

import { Router } from 'express';
import * as service from './users.service.js';
import * as schema from './users.validators.js';
import { validate } from '../../middleware/validate.js';
import { requirePermission, requireSuperAdmin } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { inviteLimiter, writeLimiter } from '../../middleware/rateLimiters.js';
import { paginationQuery } from '../../utils/pagination.js';

const router = Router();

// `authenticate` is already applied to the whole /api router in routes.js, so
// every route here has a verified req.user.

// -----------------------------------------------------------------------------
//  GET /api/users — paginated list
// -----------------------------------------------------------------------------
router.get(
  '/',
  requirePermission('user:read'),
  validate({ query: schema.listUsersQuery }),
  asyncHandler(async (req, res) => {
    res.json(await service.listUsers(req.validated.query));
  }),
);

// -----------------------------------------------------------------------------
//  Invitations
//  Declared BEFORE '/:id' — Express matches in order, and '/invitations' would
//  otherwise be captured by the '/:id' pattern as an id of "invitations".
// -----------------------------------------------------------------------------
router.get(
  '/invitations',
  requirePermission('user:invite'),
  validate({ query: paginationQuery }),
  asyncHandler(async (req, res) => {
    res.json(await service.listPendingInvitations(req.validated.query));
  }),
);

router.post(
  '/invitations',
  requirePermission('user:invite'),
  inviteLimiter,
  validate({ body: schema.inviteUserSchema }),
  asyncHandler(async (req, res) => {
    const invitation = await service.inviteUser(req.validated.body, req.user, { req });
    res.status(201).json({ data: invitation });
  }),
);

router.delete(
  '/invitations/:id',
  requirePermission('user:invite'),
  writeLimiter,
  validate({ params: schema.cuidParam }),
  asyncHandler(async (req, res) => {
    await service.revokeInvitation(req.validated.params.id, req.user, { req });
    res.status(204).send();
  }),
);

// -----------------------------------------------------------------------------
//  GET /api/users/:id
// -----------------------------------------------------------------------------
router.get(
  '/:id',
  requirePermission('user:read'),
  validate({ params: schema.cuidParam }),
  asyncHandler(async (req, res) => {
    res.json({ data: await service.getUser(req.validated.params.id) });
  }),
);

// -----------------------------------------------------------------------------
//  PATCH /api/users/:id — profile fields only
// -----------------------------------------------------------------------------
router.patch(
  '/:id',
  requirePermission('user:update'),
  writeLimiter,
  validate({ params: schema.cuidParam, body: schema.updateUserSchema }),
  asyncHandler(async (req, res) => {
    const user = await service.updateUser(req.validated.params.id, req.validated.body, req.user, {
      req,
    });
    res.json({ data: user });
  }),
);

// -----------------------------------------------------------------------------
//  PATCH /api/users/:id/access — role, grants, denies, super admin
//  Separate permission AND a separate audit action from the profile edit above.
// -----------------------------------------------------------------------------
router.patch(
  '/:id/access',
  requirePermission('user:manage_access'),
  writeLimiter,
  validate({ params: schema.cuidParam, body: schema.updateAccessSchema }),
  asyncHandler(async (req, res) => {
    const user = await service.updateAccess(req.validated.params.id, req.validated.body, req.user, {
      req,
    });
    res.json({ data: user });
  }),
);

// -----------------------------------------------------------------------------
//  PUT /api/users/:id/teams — replaces the whole membership set
// -----------------------------------------------------------------------------
router.put(
  '/:id/teams',
  requirePermission('team:manage'),
  writeLimiter,
  validate({ params: schema.cuidParam, body: schema.updateTeamsSchema }),
  asyncHandler(async (req, res) => {
    const user = await service.updateTeams(req.validated.params.id, req.validated.body, req.user, {
      req,
    });
    res.json({ data: user });
  }),
);

// -----------------------------------------------------------------------------
//  PATCH /api/users/:id/status — suspend / reactivate
// -----------------------------------------------------------------------------
router.patch(
  '/:id/status',
  requirePermission('user:suspend'),
  writeLimiter,
  validate({ params: schema.cuidParam, body: schema.setStatusSchema }),
  asyncHandler(async (req, res) => {
    const user = await service.setStatus(req.validated.params.id, req.validated.body, req.user, {
      req,
    });
    res.json({ data: user });
  }),
);

// -----------------------------------------------------------------------------
//  POST /api/users/:id/reset-password
//  Super-admin only: it returns a working temporary password, so it is
//  effectively "take over this account" and must be the narrowest possible gate.
// -----------------------------------------------------------------------------
router.post(
  '/:id/reset-password',
  requireSuperAdmin,
  writeLimiter,
  validate({ params: schema.cuidParam, body: schema.adminResetPasswordSchema }),
  asyncHandler(async (req, res) => {
    const result = await service.adminResetPassword(req.validated.params.id, req.user, { req });
    res.json({
      data: {
        ...result,
        message: 'Give this password to the user. They must change it at first login.',
      },
    });
  }),
);

export default router;
