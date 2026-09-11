/**
 * =============================================================================
 *  Form templates — request schemas
 * =============================================================================
 *  The equipment report is built by the super admin from the dashboard, so the
 *  API has to validate a structure that is itself user-defined. The schemas
 *  below are what stop a malformed template from being saved and then failing
 *  at 3am when a medic tries to open it.
 * =============================================================================
 */

import { z } from 'zod';
import { paginationQuery } from '../../utils/pagination.js';

/** Stable machine keys — used inside submission answers, so never renamed. */
const machineKey = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9_]+$/, 'Use lowercase letters, numbers and underscores only');

/**
 * The threshold the super admin sets. All three parts optional: a field can
 * have an expectation without a warning level, or none at all.
 */
export const thresholdSchema = z
  .object({
    /** What SHOULD be on the vehicle. Shown as "0 of 2". */
    expected: z.number().int().min(0).max(1000).optional(),
    /** Amber below this. */
    warnBelow: z.number().int().min(0).max(1000).optional(),
    /** Red below this. */
    criticalBelow: z.number().int().min(0).max(1000).optional(),
  })
  // A critical level above the warning level would make the amber band
  // unreachable — the field could only ever be OK or red.
  .refine(
    (data) =>
      data.criticalBelow === undefined ||
      data.warnBelow === undefined ||
      data.criticalBelow <= data.warnBelow,
    { path: ['criticalBelow'], message: 'The critical level must be at or below the warning level' },
  );

/** One row of a GRID question, e.g. "Airways — Red". */
const gridRowSchema = z.object({
  key: machineKey,
  labelEn: z.string().trim().min(1).max(120),
  labelAr: z.string().trim().min(1).max(120),
  threshold: thresholdSchema.optional(),
  /** Overrides the field's priority for this row alone. */
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(),
  /** Optional link to the stock item, so a shortage can be restocked in a click. */
  linkedItemId: z.string().cuid().nullish(),
});

/** One choice of a SINGLE_SELECT, optionally carrying its own severity. */
const selectOptionSchema = z.object({
  value: z.string().trim().min(1).max(60),
  labelEn: z.string().trim().min(1).max(160),
  labelAr: z.string().trim().min(1).max(160),
  /** Lets "Betadine: empty to quarter" be a red flag with no number involved. */
  severity: z.enum(['OK', 'WARN', 'CRITICAL']).default('OK'),
});

/**
 * Type-specific configuration.
 *
 * Kept permissive at the object level and then tightened per type by the
 * refinement below — a discriminated union would be stricter, but it would also
 * force the form builder UI to discard config when the user switches a field's
 * type, which is a frustrating way to lose thresholds you just typed in.
 */
const fieldConfigSchema = z.object({
  /** Allowed values for NUMBER_CHOICE, e.g. [0,1,2,3,4] or [0,1,2,"5+"]. */
  choices: z.array(z.union([z.number().int(), z.string().max(10)])).max(30).optional(),
  rows: z.array(gridRowSchema).max(60).optional(),
  options: z.array(selectOptionSchema).max(60).optional(),
  threshold: thresholdSchema.optional(),
  /** NUMBER bounds, e.g. oxygen pressure 0–250 bar. */
  min: z.number().optional(),
  max: z.number().optional(),
  /** Placeholder / unit shown next to the input. */
  unit: z.string().trim().max(20).optional(),

  /**
   * Judges a GRID's rows TOGETHER — "at least 2 boxes of gloves in total,
   * whichever sizes". Composes with per-row thresholds rather than replacing
   * them: a question may legitimately require one of every size AND four
   * overall, and each rule raises its own issue.
   */
  groupThreshold: thresholdSchema.optional(),

  /**
   * How urgently a shortage of this item must be put right.
   *
   * Distinct from severity, which is computed from the day's numbers. This is
   * the standing judgement, and it is what orders the restock board.
   */
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(),
});

export const fieldSchema = z
  .object({
    key: machineKey,
    labelEn: z.string().trim().min(1).max(200),
    labelAr: z.string().trim().min(1).max(200),
    helpEn: z.string().trim().max(500).nullish(),
    helpAr: z.string().trim().max(500).nullish(),
    type: z.enum([
      'TEXT',
      'NUMBER',
      'NUMBER_CHOICE',
      'SINGLE_SELECT',
      'MULTI_SELECT',
      'BOOLEAN',
      'DATE',
      'GRID',
      'SECTION_NOTE',
    ]),
    isRequired: z.boolean().default(true),
    sortOrder: z.number().int().min(0).max(999).default(0),
    config: fieldConfigSchema.default({}),
    linkedItemId: z.string().cuid().nullish(),
  })
  .superRefine((field, ctx) => {
    // Each type has one thing it cannot function without. Catching it here
    // means the builder shows a clear message instead of producing a form that
    // renders as an empty box for whoever has to fill it in.
    if (field.type === 'GRID' && !field.config.rows?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['config', 'rows'],
        message: 'A grid question needs at least one row',
      });
    }

    if (field.type === 'GRID' && !field.config.choices?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['config', 'choices'],
        message: 'A grid question needs the count choices (for example 0, 1, 2)',
      });
    }

    if (['SINGLE_SELECT', 'MULTI_SELECT'].includes(field.type) && !field.config.options?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['config', 'options'],
        message: 'A choice question needs at least one option',
      });
    }

    if (field.type === 'NUMBER_CHOICE' && !field.config.choices?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['config', 'choices'],
        message: 'Add the numbers the user can pick from',
      });
    }

    // Duplicate row keys would make two rows write to the same answer slot,
    // silently losing one of them.
    if (field.config.rows) {
      const keys = field.config.rows.map((row) => row.key);
      if (new Set(keys).size !== keys.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['config', 'rows'],
          message: 'Row keys must be unique within a question',
        });
      }
    }
  });

export const sectionSchema = z.object({
  key: machineKey,
  titleEn: z.string().trim().min(1).max(200),
  titleAr: z.string().trim().min(1).max(200),
  descriptionEn: z.string().trim().max(1000).nullish(),
  descriptionAr: z.string().trim().max(1000).nullish(),
  sortOrder: z.number().int().min(0).max(999).default(0),
  fields: z.array(fieldSchema).max(300).default([]),
});

export const createTemplateSchema = z.object({
  key: machineKey,
  titleEn: z.string().trim().min(2).max(200),
  titleAr: z.string().trim().min(2).max(200),
  descriptionEn: z.string().trim().max(2000).nullish(),
  descriptionAr: z.string().trim().max(2000).nullish(),
  scope: z.enum(['AMBULANCE', 'ER_ROOM', 'GENERIC']).default('AMBULANCE'),
  sections: z.array(sectionSchema).max(60).default([]),
});

/**
 * Replaces the whole structure in one call.
 *
 * The builder is a drag-and-drop editor holding the entire form in memory, so
 * "save" sends everything. Diffing sections and fields field-by-field would be
 * far more code and would still have to handle reordering — which is a rewrite
 * of every `sortOrder` anyway.
 */
export const updateTemplateSchema = createTemplateSchema.partial().omit({ key: true });

export const listTemplatesQuery = paginationQuery.extend({
  scope: z.enum(['AMBULANCE', 'ER_ROOM', 'GENERIC']).optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
  /** Return only the newest version of each key. */
  latestOnly: z.enum(['true', 'false']).optional().transform((value) => value === 'true'),
});
