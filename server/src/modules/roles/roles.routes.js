/**
 * =============================================================================
 *  Roles — the super admin's permission bundles.
 * =============================================================================
 *  A role is just a named list of permission strings. Because the strings are
 *  validated against the catalogue (config/permissions.js), the super admin can
 *  compose any combination they like without being able to invent a permission
 *  that guards nothing.
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
import { isValidPermission, PERMISSION_GROUPS } from '../../config/permissions.js';
import { recordAudit, AUDIT_ACTIONS } from '../../services/audit.service.js';
import { cuidParam } from '../users/users.validators.js';

const router = Router();

const permissionKey = z
  .string()
  .refine(isValidPermission, (value) => ({ message: `Unknown permission: ${value}` }));

const roleBody = z.object({
  /**
   * Machine key: lowercase letters, digits and underscores only. Used in seeds
   * and in code, so it must stay stable and typo-proof.
   */
  key: z
    .string()
    .trim()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9_]+$/, 'Use lowercase letters, numbers and underscores only'),
  nameEn: z.string().trim().min(2).max(80),
  nameAr: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).nullish(),
  permissions: z.array(permissionKey).max(200).default([]),
});

/** Key is immutable after creation — changing it would orphan seed references. */
const updateRoleBody = roleBody.partial().omit({ key: true });

// -----------------------------------------------------------------------------
//  GET /api/roles — list, with how many users hold each role.
// -----------------------------------------------------------------------------
router.get(
  '/',
  requirePermission('role:read'),
  asyncHandler(async (_req, res) => {
    const roles = await prisma.role.findMany({
      orderBy: { nameEn: 'asc' },
      // The count tells the admin whether deleting a role is safe, in the same
      // request that renders the list — no N+1 of "how many users?" per row.
      include: { _count: { select: { users: true } } },
    });

    res.json({
      data: roles,
      // Shipped alongside so the role editor can render its checkbox groups
      // without a second request, and can never show a stale catalogue.
      meta: { permissionCatalogue: PERMISSION_GROUPS },
    });
  }),
);

// -----------------------------------------------------------------------------
//  POST /api/roles
// -----------------------------------------------------------------------------
router.post(
  '/',
  requirePermission('role:manage'),
  writeLimiter,
  validate({ body: roleBody }),
  asyncHandler(async (req, res) => {
    const role = await prisma.role.create({ data: req.validated.body });

    await recordAudit({
      actorId: req.user.id,
      action: AUDIT_ACTIONS.ROLE_CREATED,
      entityType: 'Role',
      entityId: role.id,
      after: role,
      req,
    });

    res.status(201).json({ data: role });
  }),
);

// -----------------------------------------------------------------------------
//  PATCH /api/roles/:id
// -----------------------------------------------------------------------------
router.patch(
  '/:id',
  requirePermission('role:manage'),
  writeLimiter,
  validate({ params: cuidParam, body: updateRoleBody }),
  asyncHandler(async (req, res) => {
    const { id } = req.validated.params;

    const before = await prisma.role.findUnique({ where: { id } });
    if (!before) throw ApiError.notFound('Role not found');

    // NOTE: system roles ARE editable — the station must be able to tune what a
    // "Team Admin" can do. Only DELETION is blocked (see below), so a workflow
    // can never be left with no role that supports it.
    const role = await prisma.role.update({ where: { id }, data: req.validated.body });

    await recordAudit({
      actorId: req.user.id,
      action: AUDIT_ACTIONS.ROLE_UPDATED,
      entityType: 'Role',
      entityId: id,
      before,
      after: role,
      req,
    });

    res.json({ data: role });
  }),
);

// -----------------------------------------------------------------------------
//  DELETE /api/roles/:id
// -----------------------------------------------------------------------------
router.delete(
  '/:id',
  requirePermission('role:manage'),
  writeLimiter,
  validate({ params: cuidParam }),
  asyncHandler(async (req, res) => {
    const { id } = req.validated.params;

    const role = await prisma.role.findUnique({
      where: { id },
      include: { _count: { select: { users: true } } },
    });

    if (!role) throw ApiError.notFound('Role not found');

    if (role.isSystem) {
      throw ApiError.conflict(
        'Built-in roles cannot be deleted. You can edit their permissions instead.',
        { code: 'SYSTEM_ROLE' },
      );
    }

    // Refuse rather than silently leaving those users with no role at all —
    // they would lose access without anyone realising why.
    if (role._count.users > 0) {
      throw ApiError.conflict(
        `${role._count.users} user(s) still have this role. Move them to another role first.`,
        { code: 'ROLE_IN_USE' },
      );
    }

    await prisma.role.delete({ where: { id } });

    await recordAudit({
      actorId: req.user.id,
      action: AUDIT_ACTIONS.ROLE_DELETED,
      entityType: 'Role',
      entityId: id,
      before: role,
      req,
    });

    res.status(204).send();
  }),
);

export default router;
