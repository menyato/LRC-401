/**
 * =============================================================================
 *  Shift assignments — "who is on which vehicle, on which day"
 * =============================================================================
 *  Small module, but load-bearing: an assignment is what authorises a normal
 *  EMT to file the equipment report for a vehicle. Without one, filing is
 *  refused (see canSubmitForAssignment in access.service.js).
 * =============================================================================
 */

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/db.js';
import { ApiError } from '../../utils/ApiError.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { validate } from '../../middleware/validate.js';
import { requirePermission, requireAnyPermission } from '../../middleware/auth.js';
import { writeLimiter } from '../../middleware/rateLimiters.js';
import { paginate, toPrismaPagination, paginationQuery } from '../../utils/pagination.js';
import { buildAssignmentScope } from '../../services/access.service.js';
import { recordAudit, AUDIT_ACTIONS } from '../../services/audit.service.js';
import { dateOnly } from '../inventory/inventory.validators.js';
import { cuidParam } from '../users/users.validators.js';

const router = Router();

const READ_PERMISSIONS = ['assignment:read.team', 'assignment:read.all'];

const listQuery = paginationQuery.extend({
  teamId: z.string().cuid().optional(),
  vehicleId: z.string().cuid().optional(),
  dateFrom: dateOnly.optional(),
  dateTo: dateOnly.optional(),
});

const assignmentBody = z
  .object({
    teamId: z.string().cuid(),
    vehicleId: z.string().cuid(),
    shiftDate: dateOnly,
    firstPersonId: z.string().cuid().nullish(),
    secondPersonId: z.string().cuid().nullish(),
    notes: z.string().trim().max(500).nullish(),
  })
  // Rostering the same person twice on one vehicle is always a mistake, and it
  // would make the crew list read as if two people were present.
  .refine(
    (data) =>
      !data.firstPersonId || !data.secondPersonId || data.firstPersonId !== data.secondPersonId,
    { path: ['secondPersonId'], message: 'Choose a different person for the second slot' },
  );

const include = {
  team: { select: { id: true, nameEn: true, nameAr: true, dayOfWeek: true } },
  vehicle: { select: { id: true, code: true, nameEn: true, kind: true } },
  firstPerson: { select: { id: true, fullName: true, phone: true } },
  secondPerson: { select: { id: true, fullName: true, phone: true } },
};

// -----------------------------------------------------------------------------
//  GET /api/assignments — scoped list
// -----------------------------------------------------------------------------
router.get(
  '/',
  requireAnyPermission(READ_PERMISSIONS),
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const query = req.validated.query;
    const pagination = toPrismaPagination(query);

    const where = {
      // Scope first so an explicit teamId filter can only NARROW what the user
      // is already entitled to see, never widen it.
      ...buildAssignmentScope(req.user),
      ...(query.teamId ? { teamId: query.teamId } : {}),
      ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            shiftDate: {
              ...(query.dateFrom ? { gte: query.dateFrom } : {}),
              ...(query.dateTo ? { lte: query.dateTo } : {}),
            },
          }
        : {}),
    };

    res.json(
      await paginate(
        prisma.assignment,
        {
          where,
          include,
          orderBy: [{ shiftDate: 'desc' }, { vehicle: { code: 'asc' } }],
          skip: pagination.skip,
          take: pagination.take,
        },
        { page: query.page, limit: query.limit },
      ),
    );
  }),
);

// -----------------------------------------------------------------------------
//  GET /api/assignments/mine — "what am I on, and when?"
//  The EMT's home screen. Needs no special permission: it is only ever their
//  own roster.
// -----------------------------------------------------------------------------
router.get(
  '/mine',
  validate({ query: z.object({ dateFrom: dateOnly.optional(), dateTo: dateOnly.optional() }) }),
  asyncHandler(async (req, res) => {
    const { dateFrom, dateTo } = req.validated.query;

    const assignments = await prisma.assignment.findMany({
      where: {
        OR: [{ firstPersonId: req.user.id }, { secondPersonId: req.user.id }],
        ...(dateFrom || dateTo
          ? {
              shiftDate: {
                ...(dateFrom ? { gte: dateFrom } : {}),
                ...(dateTo ? { lte: dateTo } : {}),
              },
            }
          : {}),
      },
      include,
      orderBy: { shiftDate: 'desc' },
      // A roster screen, not an archive — capped rather than paginated.
      take: 60,
    });

    res.json({ data: assignments });
  }),
);

// -----------------------------------------------------------------------------
//  POST /api/assignments
// -----------------------------------------------------------------------------
router.post(
  '/',
  requirePermission('assignment:manage'),
  writeLimiter,
  validate({ body: assignmentBody }),
  asyncHandler(async (req, res) => {
    const body = req.validated.body;

    // A team admin may only roster their OWN teams. Without this check the
    // permission would be station-wide, which is not what "team admin" means.
    assertCanManageTeam(req.user, body.teamId);

    const assignment = await prisma.assignment.create({ data: body, include });

    await recordAudit({
      actorId: req.user.id,
      action: AUDIT_ACTIONS.ASSIGNMENT_CREATED,
      entityType: 'Assignment',
      entityId: assignment.id,
      after: body,
      req,
    });

    res.status(201).json({ data: assignment });
  }),
);

// -----------------------------------------------------------------------------
//  PATCH /api/assignments/:id
// -----------------------------------------------------------------------------
router.patch(
  '/:id',
  requirePermission('assignment:manage'),
  writeLimiter,
  validate({ params: cuidParam, body: assignmentBody.innerType().partial() }),
  asyncHandler(async (req, res) => {
    const { id } = req.validated.params;

    const before = await prisma.assignment.findUnique({ where: { id } });
    if (!before) throw ApiError.notFound('Assignment not found');

    // Check the team the record is CURRENTLY in, and the one it is moving to —
    // otherwise an admin could move a shift out of a team they do not lead.
    assertCanManageTeam(req.user, before.teamId);
    if (req.validated.body.teamId) assertCanManageTeam(req.user, req.validated.body.teamId);

    const assignment = await prisma.assignment.update({
      where: { id },
      data: req.validated.body,
      include,
    });

    await recordAudit({
      actorId: req.user.id,
      action: AUDIT_ACTIONS.ASSIGNMENT_UPDATED,
      entityType: 'Assignment',
      entityId: id,
      before,
      after: assignment,
      req,
    });

    res.json({ data: assignment });
  }),
);

// -----------------------------------------------------------------------------
//  DELETE /api/assignments/:id
// -----------------------------------------------------------------------------
router.delete(
  '/:id',
  requirePermission('assignment:manage'),
  writeLimiter,
  validate({ params: cuidParam }),
  asyncHandler(async (req, res) => {
    const { id } = req.validated.params;

    const assignment = await prisma.assignment.findUnique({
      where: { id },
      include: { _count: { select: { submissions: true } } },
    });

    if (!assignment) throw ApiError.notFound('Assignment not found');

    assertCanManageTeam(req.user, assignment.teamId);

    // A report was already filed against this shift. Deleting the assignment
    // would detach that report from its crew, so we refuse.
    if (assignment._count.submissions > 0) {
      throw ApiError.conflict(
        'A report has already been filed for this shift, so it cannot be deleted.',
        { code: 'ASSIGNMENT_HAS_REPORTS' },
      );
    }

    await prisma.assignment.delete({ where: { id } });

    await recordAudit({
      actorId: req.user.id,
      action: AUDIT_ACTIONS.ASSIGNMENT_DELETED,
      entityType: 'Assignment',
      entityId: id,
      before: assignment,
      req,
    });

    res.status(204).send();
  }),
);

/**
 * A team admin may only manage their own teams; anyone with station-wide read
 * (`assignment:read.all`) or the super admin may manage any.
 */
function assertCanManageTeam(user, teamId) {
  if (user.isSuperAdmin) return;
  if (user.permissions.includes('assignment:read.all')) return;
  if (user.adminTeamIds.includes(teamId)) return;

  throw ApiError.forbidden('You can only manage shifts for teams you lead', {
    code: 'NOT_TEAM_ADMIN',
  });
}

export default router;
