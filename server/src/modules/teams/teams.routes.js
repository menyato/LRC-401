/**
 * =============================================================================
 *  Teams — the day squads ("Monday Team", "Tuesday Team", …)
 * =============================================================================
 *  A team is the unit that data scope is built on: a TEAM_ADMIN sees their
 *  team's equipment reports and nobody else's.
 *
 *  The standard five endpoints come from the CRUD factory. Only the two things
 *  teams genuinely need beyond that — listing members and changing one member's
 *  standing — are written by hand below.
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
import { createCrudRouter, crudListQuery } from '../../utils/crudRouter.js';
import { recordAudit, AUDIT_ACTIONS } from '../../services/audit.service.js';
import { cuidParam } from '../users/users.validators.js';

const createTeamSchema = z.object({
  key: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9_]+$/, 'Use lowercase letters, numbers and underscores only'),
  nameEn: z.string().trim().min(2).max(80),
  nameAr: z.string().trim().min(2).max(80),
  /**
   * JavaScript convention: 0 = Sunday … 6 = Saturday.
   * Nullable so a non-day-based group (e.g. a training cohort) is still a team.
   */
  dayOfWeek: z.number().int().min(0).max(6).nullish(),
});

const updateTeamSchema = createTeamSchema.partial().omit({ key: true }).extend({
  isActive: z.boolean().optional(),
});

// --- The five standard endpoints ---------------------------------------------
const router = createCrudRouter({
  modelName: 'team',
  entityType: 'Team',
  permissions: { read: 'team:read', manage: 'team:manage' },
  schemas: { create: createTeamSchema, update: updateTeamSchema, listQuery: crudListQuery },
  searchFields: ['nameEn', 'nameAr', 'key'],
  // Day order, not alphabetical — "Monday, Tuesday, …" is how the station
  // thinks about its teams.
  orderBy: { dayOfWeek: 'asc' },
  auditActions: {
    created: AUDIT_ACTIONS.TEAM_CREATED,
    updated: AUDIT_ACTIONS.TEAM_UPDATED,
    deleted: AUDIT_ACTIONS.TEAM_UPDATED,
  },
  include: { _count: { select: { memberships: true, assignments: true } } },
  /**
   * Deactivating a team with members would strip their data scope without
   * anyone noticing — a team admin would simply stop seeing reports.
   */
  beforeDelete: async (team) => {
    const members = await prisma.teamMembership.count({ where: { teamId: team.id } });

    if (members > 0) {
      throw ApiError.conflict(
        `This team still has ${members} member(s). Move them out before deactivating it.`,
        { code: 'TEAM_HAS_MEMBERS' },
      );
    }
  },
});

// -----------------------------------------------------------------------------
//  GET /api/teams/:id/members
// -----------------------------------------------------------------------------
const memberRouter = Router();

memberRouter.get(
  '/:id/members',
  requirePermission('team:read'),
  validate({ params: cuidParam }),
  asyncHandler(async (req, res) => {
    const members = await prisma.teamMembership.findMany({
      where: { teamId: req.validated.params.id },
      select: {
        teamRole: true,
        createdAt: true,
        user: {
          select: { id: true, fullName: true, email: true, phone: true, status: true },
        },
      },
      // Team admins first, then alphabetically — the roster reads the way a
      // person would write it.
      orderBy: [{ teamRole: 'desc' }, { user: { fullName: 'asc' } }],
    });

    res.json({ data: members });
  }),
);

// -----------------------------------------------------------------------------
//  PUT /api/teams/:id/members/:userId — add a member or change their standing
// -----------------------------------------------------------------------------
memberRouter.put(
  '/:id/members/:userId',
  requirePermission('team:manage'),
  writeLimiter,
  validate({
    params: z.object({ id: z.string().cuid(), userId: z.string().cuid() }),
    body: z.object({ teamRole: z.enum(['MEMBER', 'TEAM_ADMIN']) }),
  }),
  asyncHandler(async (req, res) => {
    const { id: teamId, userId } = req.validated.params;
    const { teamRole } = req.validated.body;

    // upsert so "add" and "promote to team admin" are the same call — the UI
    // does not need to know whether the membership already exists.
    const membership = await prisma.teamMembership.upsert({
      where: { userId_teamId: { userId, teamId } },
      create: { userId, teamId, teamRole },
      update: { teamRole },
      include: { user: { select: { id: true, fullName: true, email: true } } },
    });

    await recordAudit({
      actorId: req.user.id,
      action: AUDIT_ACTIONS.TEAM_MEMBER_CHANGED,
      entityType: 'Team',
      entityId: teamId,
      after: { userId, teamRole },
      req,
    });

    res.json({ data: membership });
  }),
);

// -----------------------------------------------------------------------------
//  DELETE /api/teams/:id/members/:userId
// -----------------------------------------------------------------------------
memberRouter.delete(
  '/:id/members/:userId',
  requirePermission('team:manage'),
  writeLimiter,
  validate({ params: z.object({ id: z.string().cuid(), userId: z.string().cuid() }) }),
  asyncHandler(async (req, res) => {
    const { id: teamId, userId } = req.validated.params;

    // deleteMany rather than delete: it does not throw when the row is already
    // gone, so removing someone twice is harmless instead of a 500.
    await prisma.teamMembership.deleteMany({ where: { teamId, userId } });

    await recordAudit({
      actorId: req.user.id,
      action: AUDIT_ACTIONS.TEAM_MEMBER_CHANGED,
      entityType: 'Team',
      entityId: teamId,
      before: { userId, removed: true },
      req,
    });

    res.status(204).send();
  }),
);

// Member routes are registered FIRST so '/:id/members' is matched before the
// factory's '/:id' pattern can swallow it.
export default Router().use(memberRouter).use(router);
