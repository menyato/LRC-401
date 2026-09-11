/**
 * =============================================================================
 *  Equipment report submissions — request schemas
 * =============================================================================
 */

import { z } from 'zod';
import { paginationQuery, sortQuery } from '../../utils/pagination.js';
import { dateOnly } from '../inventory/inventory.validators.js';

export const listSubmissionsQuery = paginationQuery
  .extend({
    teamId: z.string().cuid().optional(),
    vehicleId: z.string().cuid().optional(),
    templateKey: z.string().max(60).optional(),
    status: z.enum(['DRAFT', 'SUBMITTED', 'REVIEWED']).optional(),
    submittedById: z.string().cuid().optional(),
    dateFrom: dateOnly.optional(),
    dateTo: dateOnly.optional(),
    /** Only reports that have at least one red issue. */
    criticalOnly: z.enum(['true', 'false']).optional().transform((value) => value === 'true'),
  })
  .merge(sortQuery(['shiftDate', 'createdAt', 'criticalCount'], 'shiftDate'));

/**
 * Answers are a free-form map because the form is defined at runtime by the
 * super admin — we cannot know the keys at build time.
 *
 * They are NOT unvalidated, though: `submissions.service.js` checks every
 * answer against the template's own field definitions before storing, so a
 * client cannot invent keys or send a string where a count belongs.
 *
 * `z.unknown()` (not `z.any()`) so the values stay opaque until that check.
 */
const answersSchema = z.record(z.string().max(60), z.unknown());

export const saveSubmissionSchema = z.object({
  templateId: z.string().cuid(),
  vehicleId: z.string().cuid(),
  teamId: z.string().cuid(),
  shiftDate: dateOnly,
  /** The "Second Assigned Person" — free text, may be an unregistered helper. */
  secondPersonName: z.string().trim().max(120).nullish(),
  answers: answersSchema.default({}),
  /**
   * DRAFT lets a crew save halfway through a 200-question form and finish after
   * a call-out — required fields are only enforced on SUBMITTED.
   */
  status: z.enum(['DRAFT', 'SUBMITTED']).default('DRAFT'),
});

export const reviewSubmissionSchema = z.object({
  reviewNote: z.string().trim().max(2000).nullish(),
});

/** The team admin's day board: "how did every vehicle look on this date?" */
export const boardQuery = z.object({
  teamId: z.string().cuid().optional(),
  date: dateOnly,
});
