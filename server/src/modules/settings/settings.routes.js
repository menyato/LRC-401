/**
 * =============================================================================
 *  Station settings
 * =============================================================================
 *  A small key/value store so the super admin can change station-wide options
 *  without a code change or a migration.
 *
 *  The KEYS are declared here rather than being free-form. Same reasoning as
 *  the permission catalogue: a setting only means something because some code
 *  reads it, so letting the UI invent keys would create settings that do
 *  nothing — and an admin who believes they have configured something they
 *  have not is worse off than one who knows they cannot.
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
import { recordAudit, AUDIT_ACTIONS } from '../../services/audit.service.js';

const router = Router();

/**
 * Known settings, their shapes and their defaults.
 * Adding one here plus reading it somewhere is the whole process.
 */
export const SETTING_DEFINITIONS = {
  'station.name': {
    schema: z.object({ en: z.string().max(120), ar: z.string().max(120) }),
    default: { en: 'Lebanese Red Cross — Saida 401', ar: 'الصليب الأحمر اللبناني - صيدا ٤٠١' },
    description: 'Station name shown in the header and in emails.',
  },
  'reports.defaultThreshold': {
    schema: z.object({
      warnBelow: z.number().int().min(0).max(1000),
      criticalBelow: z.number().int().min(0).max(1000),
    }),
    default: { warnBelow: 1, criticalBelow: 1 },
    description: 'Threshold pre-filled for a new question in the form builder.',
  },
  'reports.requireSecondPerson': {
    schema: z.object({ enabled: z.boolean() }),
    default: { enabled: false },
    description: 'Require a second crew member to be named on every report.',
  },
  'inventory.defaultExpiryWarningDays': {
    schema: z.object({ days: z.number().int().min(1).max(365) }),
    default: { days: 30 },
    description: 'How many days before expiry a batch starts showing as a warning.',
  },
  'ui.locale': {
    schema: z.object({ default: z.enum(['en', 'ar']) }),
    default: { default: 'en' },
    description: 'Language new accounts start in.',
  },
};

// -----------------------------------------------------------------------------
//  GET /api/settings
//  Returns every known setting, falling back to its default when the row does
//  not exist yet — so the client never has to handle a missing setting.
// -----------------------------------------------------------------------------
router.get(
  '/',
  requirePermission('dashboard:view'),
  asyncHandler(async (_req, res) => {
    const stored = await prisma.setting.findMany();
    const byKey = new Map(stored.map((row) => [row.key, row.value]));

    const settings = Object.entries(SETTING_DEFINITIONS).map(([key, definition]) => ({
      key,
      value: byKey.get(key) ?? definition.default,
      description: definition.description,
      isDefault: !byKey.has(key),
    }));

    res.json({ data: settings });
  }),
);

// -----------------------------------------------------------------------------
//  PUT /api/settings/:key
// -----------------------------------------------------------------------------
router.put(
  '/:key',
  requirePermission('settings:manage'),
  writeLimiter,
  validate({
    params: z.object({ key: z.string().max(60) }),
    // Validated against the specific setting's own schema below — we cannot
    // know which shape to expect until we have read the key.
    body: z.object({ value: z.unknown() }),
  }),
  asyncHandler(async (req, res) => {
    const { key } = req.validated.params;
    const definition = SETTING_DEFINITIONS[key];

    if (!definition) {
      throw ApiError.badRequest(`Unknown setting "${key}"`, { code: 'UNKNOWN_SETTING' });
    }

    // Per-setting validation. Without it, a malformed value would be stored and
    // then break whichever screen reads it, far from the cause.
    const parsed = definition.schema.safeParse(req.validated.body.value);

    if (!parsed.success) {
      throw ApiError.validation(
        'That value does not match the expected format for this setting',
        Object.fromEntries(
          parsed.error.issues.map((issue) => [issue.path.join('.') || 'value', issue.message]),
        ),
      );
    }

    const before = await prisma.setting.findUnique({ where: { key } });

    const setting = await prisma.setting.upsert({
      where: { key },
      create: { key, value: parsed.data, description: definition.description },
      update: { value: parsed.data },
    });

    await recordAudit({
      actorId: req.user.id,
      action: AUDIT_ACTIONS.SETTING_UPDATED,
      entityType: 'Setting',
      entityId: key,
      before: before?.value,
      after: parsed.data,
      req,
    });

    res.json({ data: setting });
  }),
);

/**
 * Reads one setting with its default applied.
 * Exported so other modules can use settings without duplicating the fallback.
 */
export async function getSetting(key) {
  const definition = SETTING_DEFINITIONS[key];
  if (!definition) throw new Error(`Unknown setting: ${key}`);

  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value ?? definition.default;
}

export default router;
