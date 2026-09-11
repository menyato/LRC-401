/**
 * =============================================================================
 *  CRUD router factory
 * =============================================================================
 *  Several resources (teams, vehicles, item categories) need exactly the same
 *  five endpoints with exactly the same behaviour:
 *
 *      GET    /        paginated + searchable list
 *      GET    /:id     single record
 *      POST   /        create
 *      PATCH  /:id     update
 *      DELETE /:id     soft delete (deactivate)
 *
 *  Writing those five by hand three times would be ~450 lines of near-identical
 *  code, and — worse — three chances to forget the audit call, the pagination
 *  cap or the permission guard on one of them.
 *
 *  So this factory builds them once. Anything genuinely resource-specific
 *  (stock movements, form publishing, report scoping) is written explicitly in
 *  its own module: a factory should absorb the boring 80%, not contort itself
 *  to cover the interesting 20%.
 *
 *  DELETE IS ALWAYS SOFT. Teams, vehicles and categories are referenced by
 *  historical records; hard-deleting one would either break foreign keys or
 *  silently orphan a year of reports. `isActive: false` hides it from pickers
 *  while keeping history readable.
 * =============================================================================
 */

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/db.js';
import { ApiError } from './ApiError.js';
import { asyncHandler } from './asyncHandler.js';
import { paginate, searchFilter, toPrismaPagination, paginationQuery } from './pagination.js';
import { validate } from '../middleware/validate.js';
import { requirePermission } from '../middleware/auth.js';
import { writeLimiter } from '../middleware/rateLimiters.js';
import { recordAudit } from '../services/audit.service.js';
import { cuidParam } from '../modules/users/users.validators.js';

/**
 * @param {object} options
 * @param {string}   options.modelName      Prisma delegate name, e.g. 'team'.
 * @param {string}   options.entityType     Label used in the audit log.
 * @param {object}   options.permissions    { read, manage } permission strings.
 * @param {object}   options.schemas        { create, update, listQuery? } Zod schemas.
 * @param {string[]} options.searchFields   Columns the `search` param looks in.
 * @param {object}   options.orderBy        Default Prisma ordering.
 * @param {object}   options.auditActions   { created, updated, deleted }.
 * @param {object}  [options.include]       Prisma `include` for list/detail.
 * @param {Function}[options.extraFilters]  (validatedQuery) => Prisma `where`
 *                                          fragment, for resource-specific
 *                                          filters such as `?kind=AMBULANCE`.
 *                                          Without this, a filter declared in a
 *                                          listQuery schema would validate and
 *                                          then be silently ignored — the worst
 *                                          kind of bug, because the UI looks
 *                                          like it works.
 * @param {Function}[options.beforeDelete]  async (record) => void. Throw to block.
 * @returns {import('express').Router}
 */
export function createCrudRouter({
  modelName,
  entityType,
  permissions,
  schemas,
  searchFields = [],
  orderBy = { createdAt: 'desc' },
  auditActions,
  include,
  extraFilters,
  beforeDelete,
}) {
  const router = Router();
  const model = prisma[modelName];

  if (!model) {
    // Fail at boot, not on the first request: a typo here would otherwise show
    // up as a confusing "cannot read property findMany of undefined" in prod.
    throw new Error(`createCrudRouter: no Prisma model named "${modelName}"`);
  }

  const listQuery = schemas.listQuery ?? paginationQuery;

  // ---------------------------------------------------------------------------
  //  GET / — list
  // ---------------------------------------------------------------------------
  router.get(
    '/',
    requirePermission(permissions.read),
    validate({ query: listQuery }),
    asyncHandler(async (req, res) => {
      const query = req.validated.query;
      const pagination = toPrismaPagination(query);

      const where = {
        // Deactivated records are hidden unless explicitly asked for, so a
        // retired vehicle does not clutter every dropdown in the app.
        ...(query.includeInactive ? {} : { isActive: true }),
        ...searchFilter(query.search, searchFields),
        ...(extraFilters ? extraFilters(query) : {}),
      };

      res.json(
        await paginate(
          model,
          {
            where,
            include,
            orderBy: pagination.orderBy ?? orderBy,
            skip: pagination.skip,
            take: pagination.take,
          },
          { page: query.page, limit: query.limit },
        ),
      );
    }),
  );

  // ---------------------------------------------------------------------------
  //  GET /:id
  // ---------------------------------------------------------------------------
  router.get(
    '/:id',
    requirePermission(permissions.read),
    validate({ params: cuidParam }),
    asyncHandler(async (req, res) => {
      const record = await model.findUnique({ where: { id: req.validated.params.id }, include });

      if (!record) throw ApiError.notFound(`${entityType} not found`);

      res.json({ data: record });
    }),
  );

  // ---------------------------------------------------------------------------
  //  POST /
  // ---------------------------------------------------------------------------
  router.post(
    '/',
    requirePermission(permissions.manage),
    writeLimiter,
    validate({ body: schemas.create }),
    asyncHandler(async (req, res) => {
      const record = await model.create({ data: req.validated.body });

      await recordAudit({
        actorId: req.user.id,
        action: auditActions.created,
        entityType,
        entityId: record.id,
        after: record,
        req,
      });

      res.status(201).json({ data: record });
    }),
  );

  // ---------------------------------------------------------------------------
  //  PATCH /:id
  // ---------------------------------------------------------------------------
  router.patch(
    '/:id',
    requirePermission(permissions.manage),
    writeLimiter,
    validate({ params: cuidParam, body: schemas.update }),
    asyncHandler(async (req, res) => {
      const { id } = req.validated.params;

      // Read first so the audit log can store a real `before` snapshot —
      // "what changed" is the question the log exists to answer.
      const before = await model.findUnique({ where: { id } });
      if (!before) throw ApiError.notFound(`${entityType} not found`);

      const record = await model.update({ where: { id }, data: req.validated.body, include });

      await recordAudit({
        actorId: req.user.id,
        action: auditActions.updated,
        entityType,
        entityId: id,
        before,
        after: record,
        req,
      });

      res.json({ data: record });
    }),
  );

  // ---------------------------------------------------------------------------
  //  DELETE /:id — soft delete
  // ---------------------------------------------------------------------------
  router.delete(
    '/:id',
    requirePermission(permissions.manage),
    writeLimiter,
    validate({ params: cuidParam }),
    asyncHandler(async (req, res) => {
      const { id } = req.validated.params;

      const record = await model.findUnique({ where: { id } });
      if (!record) throw ApiError.notFound(`${entityType} not found`);

      // Resource-specific guard, e.g. "this team still has members".
      if (beforeDelete) await beforeDelete(record);

      await model.update({ where: { id }, data: { isActive: false } });

      await recordAudit({
        actorId: req.user.id,
        action: auditActions.deleted,
        entityType,
        entityId: id,
        before: record,
        req,
      });

      res.status(204).send();
    }),
  );

  return router;
}

/**
 * A boolean that arrives as a QUERY STRING.
 *
 * `z.coerce.boolean()` is wrong here: it applies JavaScript truthiness, and the
 * non-empty string "false" is truthy — so `?includeInactive=false` would come
 * out as `true`. We compare the text explicitly instead.
 */
export const queryBoolean = z
  .enum(['true', 'false'])
  .optional()
  .transform((value) => value === 'true');

/**
 * List query with the `includeInactive` flag the factory understands.
 * Extend it when a resource needs extra filters.
 */
export const crudListQuery = paginationQuery.extend({
  includeInactive: queryBoolean,
});
