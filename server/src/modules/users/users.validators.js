/**
 * =============================================================================
 *  Users — request schemas
 * =============================================================================
 */

import { z } from 'zod';
import { paginationQuery, sortQuery } from '../../utils/pagination.js';
import { isValidPermission } from '../../config/permissions.js';
import { emailField } from '../auth/auth.validators.js';

/**
 * A permission string that actually exists in the catalogue.
 *
 * Without this check, a typo ("inventory.item:crate") would be stored happily
 * and silently grant nothing — the admin would believe access was given, and
 * the volunteer would be blocked with no explanation. Rejecting it at the API
 * boundary turns a silent failure into an immediate, obvious error.
 */
const permissionKey = z
  .string()
  .refine(isValidPermission, (value) => ({ message: `Unknown permission: ${value}` }));

const permissionList = z.array(permissionKey).max(100).default([]);

/** Reusable id validator — Prisma's default ids are cuids. */
export const cuidParam = z.object({ id: z.string().cuid('Invalid id') });

// -----------------------------------------------------------------------------
//  Listing
// -----------------------------------------------------------------------------

export const listUsersQuery = paginationQuery
  .extend({
    status: z.enum(['INVITED', 'ACTIVE', 'SUSPENDED']).optional(),
    roleId: z.string().cuid().optional(),
    teamId: z.string().cuid().optional(),
    /** "true"/"false" from the query string. */
    isSuperAdmin: z.coerce.boolean().optional(),
  })
  .merge(sortQuery(['fullName', 'email', 'createdAt', 'lastLoginAt'], 'createdAt'));

// -----------------------------------------------------------------------------
//  Invitations
// -----------------------------------------------------------------------------

export const inviteUserSchema = z.object({
  email: emailField,
  fullName: z.string().trim().min(2, 'Please enter a full name').max(120),
  roleId: z.string().cuid().nullish(),
  extraPermissions: permissionList,
  teamIds: z.array(z.string().cuid()).max(20).default([]),
  /**
   * Creating another super admin. The route additionally requires the CALLER to
   * be a super admin — a schema cannot enforce that, only shape.
   */
  isSuperAdmin: z.boolean().default(false),
});

// -----------------------------------------------------------------------------
//  Editing
// -----------------------------------------------------------------------------

/**
 * Profile-level edits. Deliberately EXCLUDES role, permissions, status and
 * isSuperAdmin: privilege changes go through a separate endpoint with its own
 * permission (`user:manage_access`) and its own audit action, so "fixing a
 * phone number" and "granting the clothing store" can never be the same request.
 */
export const updateUserSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  phone: z.string().trim().max(30).nullish(),
  locale: z.enum(['en', 'ar']).optional(),
});

/** Privilege changes. Separate on purpose — see above. */
export const updateAccessSchema = z.object({
  roleId: z.string().cuid().nullish(),
  extraPermissions: permissionList.optional(),
  deniedPermissions: permissionList.optional(),
  isSuperAdmin: z.boolean().optional(),
});

export const updateTeamsSchema = z.object({
  teams: z
    .array(
      z.object({
        teamId: z.string().cuid(),
        teamRole: z.enum(['MEMBER', 'TEAM_ADMIN']).default('MEMBER'),
      }),
    )
    .max(20),
});

export const setStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED']),
  reason: z.string().trim().max(500).optional(),
});

/**
 * Admin-triggered password reset.
 * `mustChangePassword` is forced true by the service regardless of input: a
 * password an admin knows must never remain in use.
 */
export const adminResetPasswordSchema = z.object({
  notifyByEmail: z.boolean().default(true),
});
