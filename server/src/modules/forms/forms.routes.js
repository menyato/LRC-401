/**
 * =============================================================================
 *  Form template routes — the form builder API
 * =============================================================================
 */

import { Router } from 'express';
import { z } from 'zod';
import * as service from './forms.service.js';
import * as schema from './forms.validators.js';
import { validate } from '../../middleware/validate.js';
import { requirePermission } from '../../middleware/auth.js';
import { writeLimiter } from '../../middleware/rateLimiters.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { cuidParam } from '../users/users.validators.js';

const router = Router();

// -----------------------------------------------------------------------------
//  GET /api/forms/templates — list (metadata only, no nested fields)
// -----------------------------------------------------------------------------
router.get(
  '/templates',
  requirePermission('form.template:read'),
  validate({ query: schema.listTemplatesQuery }),
  asyncHandler(async (req, res) => {
    res.json(await service.listTemplates(req.validated.query));
  }),
);

// -----------------------------------------------------------------------------
//  GET /api/forms/active?scope=AMBULANCE
//  What a responder actually fills in: the newest PUBLISHED version.
//  Guarded by `submission:create`, not `form.template:read` — an EMT needs the
//  form to do their job but has no business browsing the builder.
// -----------------------------------------------------------------------------
router.get(
  '/active',
  requirePermission('submission:create'),
  validate({
    query: z.object({ scope: z.enum(['AMBULANCE', 'ER_ROOM', 'GENERIC']).default('AMBULANCE') }),
  }),
  asyncHandler(async (req, res) => {
    res.json({ data: await service.getActiveTemplate(req.validated.query.scope) });
  }),
);

// -----------------------------------------------------------------------------
//  GET /api/forms/templates/:id — full structure for the builder
// -----------------------------------------------------------------------------
router.get(
  '/templates/:id',
  requirePermission('form.template:read'),
  validate({ params: cuidParam }),
  asyncHandler(async (req, res) => {
    res.json({ data: await service.getTemplate(req.validated.params.id) });
  }),
);

// -----------------------------------------------------------------------------
//  POST /api/forms/templates
// -----------------------------------------------------------------------------
router.post(
  '/templates',
  requirePermission('form.template:manage'),
  writeLimiter,
  validate({ body: schema.createTemplateSchema }),
  asyncHandler(async (req, res) => {
    const template = await service.createTemplate(req.validated.body, req.user, { req });
    res.status(201).json({ data: template });
  }),
);

// -----------------------------------------------------------------------------
//  PUT /api/forms/templates/:id — save the builder's whole state
//
//  PUT, not PATCH: the body is the COMPLETE structure, not a partial diff. The
//  response may carry a different id — editing a PUBLISHED template forks it
//  into a new draft version (see forms.service.js) — so the client must read
//  the id back rather than assume it stayed on the same record.
// -----------------------------------------------------------------------------
router.put(
  '/templates/:id',
  requirePermission('form.template:manage'),
  writeLimiter,
  validate({ params: cuidParam, body: schema.updateTemplateSchema }),
  asyncHandler(async (req, res) => {
    const template = await service.updateTemplate(
      req.validated.params.id,
      req.validated.body,
      req.user,
      { req },
    );

    res.json({
      data: template,
      meta: {
        // Tells the UI to redirect to the new draft and explain why.
        forkedToNewVersion: template.id !== req.validated.params.id,
      },
    });
  }),
);

// -----------------------------------------------------------------------------
//  POST /api/forms/templates/:id/publish
// -----------------------------------------------------------------------------
router.post(
  '/templates/:id/publish',
  requirePermission('form.template:manage'),
  writeLimiter,
  validate({ params: cuidParam }),
  asyncHandler(async (req, res) => {
    const template = await service.publishTemplate(req.validated.params.id, req.user, { req });
    res.json({ data: template });
  }),
);

// -----------------------------------------------------------------------------
//  POST /api/forms/templates/:id/new-version — explicit fork
// -----------------------------------------------------------------------------
router.post(
  '/templates/:id/new-version',
  requirePermission('form.template:manage'),
  writeLimiter,
  validate({ params: cuidParam }),
  asyncHandler(async (req, res) => {
    const template = await service.forkTemplate(req.validated.params.id, req.user, { req });
    res.status(201).json({ data: template });
  }),
);

export default router;
