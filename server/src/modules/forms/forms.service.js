/**
 * =============================================================================
 *  Form template service
 * =============================================================================
 *  The form builder: the super admin defines sections, questions and thresholds
 *  from the dashboard, with no code change and no database migration.
 *
 *  VERSIONING — the rule that protects your history
 *  ------------------------------------------------
 *  A DRAFT can be edited freely.
 *  A PUBLISHED template is FROZEN. Editing it creates version N+1 as a new
 *  draft; the published version keeps serving until the new one is published.
 *
 *  Why bother? Every submission stores `templateId` + `templateVersion`. If we
 *  let a published template be edited in place, raising "expected tourniquets"
 *  from 2 to 4 would retroactively turn every past report red — reports that
 *  were correct on the day they were filed. Freezing versions means a report
 *  always reads against the rules that applied when it was written.
 * =============================================================================
 */

import { prisma } from '../../config/db.js';
import { ApiError } from '../../utils/ApiError.js';
import { paginate, searchFilter, toPrismaPagination } from '../../utils/pagination.js';
import { recordAudit, AUDIT_ACTIONS } from '../../services/audit.service.js';

/** Nested include used wherever a full template is returned. */
const fullTemplateInclude = {
  sections: {
    orderBy: { sortOrder: 'asc' },
    include: { fields: { orderBy: { sortOrder: 'asc' } } },
  },
  createdBy: { select: { id: true, fullName: true } },
};

export async function listTemplates(query) {
  const { page, limit, search, scope, status, latestOnly } = query;
  const pagination = toPrismaPagination(query);

  const where = {
    ...(scope ? { scope } : {}),
    ...(status ? { status } : {}),
    ...searchFilter(search, ['titleEn', 'titleAr', 'key']),
  };

  const result = await paginate(
    prisma.formTemplate,
    {
      where,
      include: {
        createdBy: { select: { id: true, fullName: true } },
        _count: { select: { sections: true, submissions: true } },
      },
      orderBy: [{ key: 'asc' }, { version: 'desc' }],
      skip: pagination.skip,
      take: pagination.take,
    },
    { page, limit },
  );

  // Collapse to one row per key. Applied after the query because "the newest
  // version of each key" is a window function, and dropping to raw SQL for a
  // list filter would cost more in maintenance than it saves here.
  if (latestOnly) {
    const seen = new Set();
    result.data = result.data.filter((template) => {
      if (seen.has(template.key)) return false;
      seen.add(template.key);
      return true;
    });
  }

  return result;
}

export async function getTemplate(id) {
  const template = await prisma.formTemplate.findUnique({
    where: { id },
    include: fullTemplateInclude,
  });

  if (!template) throw ApiError.notFound('Form template not found');

  return template;
}

/**
 * The template a user should FILL IN for a given vehicle kind.
 * Always the newest PUBLISHED version — drafts are never served to responders.
 */
export async function getActiveTemplate(scope) {
  const template = await prisma.formTemplate.findFirst({
    where: { scope, status: 'PUBLISHED' },
    orderBy: { version: 'desc' },
    include: fullTemplateInclude,
  });

  if (!template) {
    throw ApiError.notFound(
      `No published equipment report form exists for ${scope}. Ask the super admin to publish one.`,
      { code: 'NO_PUBLISHED_TEMPLATE' },
    );
  }

  return template;
}

/** Creates a new template as version 1, in DRAFT. */
export async function createTemplate(input, actor, context = {}) {
  const { sections, ...templateData } = input;

  const existing = await prisma.formTemplate.findFirst({
    where: { key: input.key },
    select: { id: true },
  });

  if (existing) {
    throw ApiError.conflict(
      'A form with this key already exists. Edit it instead, or choose a different key.',
      { code: 'TEMPLATE_KEY_IN_USE' },
    );
  }

  const template = await prisma.$transaction(async (tx) => {
    const created = await tx.formTemplate.create({
      data: { ...templateData, version: 1, status: 'DRAFT', createdById: actor.id },
    });

    await writeSections(tx, created.id, sections);

    return created;
  });

  await recordAudit({
    actorId: actor.id,
    action: AUDIT_ACTIONS.TEMPLATE_CREATED,
    entityType: 'FormTemplate',
    entityId: template.id,
    after: { key: template.key, version: template.version },
    req: context.req,
  });

  return getTemplate(template.id);
}

/**
 * Saves the builder's state.
 *
 * DRAFT      -> edited in place.
 * PUBLISHED  -> a new DRAFT version is created and edited instead. The returned
 *               template therefore may have a DIFFERENT id from the one asked
 *               for; the client must follow it (the response carries the new id).
 */
export async function updateTemplate(id, input, actor, context = {}) {
  const current = await prisma.formTemplate.findUnique({
    where: { id },
    select: { id: true, key: true, version: true, status: true },
  });

  if (!current) throw ApiError.notFound('Form template not found');

  const { sections, ...templateData } = input;

  if (current.status === 'DRAFT') {
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.formTemplate.update({ where: { id }, data: templateData });

      // Only rewrite the structure when the caller actually sent one, so a
      // title-only edit does not delete every question.
      if (sections) await writeSections(tx, id, sections, { replace: true });

      return result;
    });

    await recordAudit({
      actorId: actor.id,
      action: AUDIT_ACTIONS.TEMPLATE_UPDATED,
      entityType: 'FormTemplate',
      entityId: id,
      after: { key: updated.key, version: updated.version },
      req: context.req,
    });

    return getTemplate(id);
  }

  // --- Published: fork into a new draft version ------------------------------
  return createNewVersion(current, { ...templateData, sections }, actor, context);
}

/**
 * Copies a published template into a new DRAFT version, applying the edits.
 * Extracted so "edit a published form" and an explicit "new version" button
 * share one implementation.
 */
async function createNewVersion(current, input, actor, context = {}) {
  const previous = await getTemplate(current.id);

  const { sections, ...templateData } = input;

  const nextVersionNumber =
    (await prisma.formTemplate.aggregate({
      where: { key: current.key },
      _max: { version: true },
    }))._max.version + 1;

  const created = await prisma.$transaction(async (tx) => {
    const template = await tx.formTemplate.create({
      data: {
        key: current.key,
        version: nextVersionNumber,
        status: 'DRAFT',
        createdById: actor.id,
        titleEn: templateData.titleEn ?? previous.titleEn,
        titleAr: templateData.titleAr ?? previous.titleAr,
        descriptionEn: templateData.descriptionEn ?? previous.descriptionEn,
        descriptionAr: templateData.descriptionAr ?? previous.descriptionAr,
        scope: templateData.scope ?? previous.scope,
      },
    });

    // Use the submitted structure if there is one; otherwise clone the previous
    // version's, so "new version" with no edits produces an identical draft.
    await writeSections(tx, template.id, sections ?? stripIds(previous.sections));

    return template;
  });

  await recordAudit({
    actorId: actor.id,
    action: AUDIT_ACTIONS.TEMPLATE_UPDATED,
    entityType: 'FormTemplate',
    entityId: created.id,
    before: { version: current.version, status: current.status },
    after: { version: created.version, status: 'DRAFT', forkedFrom: current.id },
    req: context.req,
  });

  return getTemplate(created.id);
}

/**
 * Publishes a draft and archives the version it replaces, in one transaction —
 * so there is never a moment with two published versions of the same form (the
 * "which one do I fill in?" bug) or none at all.
 */
export async function publishTemplate(id, actor, context = {}) {
  const template = await getTemplate(id);

  if (template.status === 'PUBLISHED') {
    throw ApiError.conflict('This version is already published');
  }

  if (template.status === 'ARCHIVED') {
    throw ApiError.conflict('Archived versions cannot be republished. Create a new version.');
  }

  // A form with no questions would be published and then hand a responder a
  // blank page.
  const fieldCount = template.sections.reduce((sum, section) => sum + section.fields.length, 0);

  if (fieldCount === 0) {
    throw ApiError.badRequest('Add at least one question before publishing', {
      code: 'TEMPLATE_EMPTY',
    });
  }

  await prisma.$transaction([
    prisma.formTemplate.updateMany({
      where: { key: template.key, status: 'PUBLISHED', id: { not: id } },
      data: { status: 'ARCHIVED' },
    }),
    prisma.formTemplate.update({
      where: { id },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
    }),
  ]);

  await recordAudit({
    actorId: actor.id,
    action: AUDIT_ACTIONS.TEMPLATE_PUBLISHED,
    entityType: 'FormTemplate',
    entityId: id,
    after: { key: template.key, version: template.version, fieldCount },
    req: context.req,
  });

  return getTemplate(id);
}

/**
 * Writes sections and their fields.
 *
 * `replace: true` deletes the existing structure first. That cascades to fields
 * (see the schema's onDelete: Cascade) and is safe ONLY on a draft — which is
 * why every caller checks the status before getting here. Submissions never
 * reference FormField rows directly; they store answers keyed by the field's
 * string `key`, so rewriting a draft's structure cannot orphan any report.
 */
async function writeSections(tx, templateId, sections = [], { replace = false } = {}) {
  if (replace) {
    await tx.formSection.deleteMany({ where: { templateId } });
  }

  for (const [sectionIndex, section] of sections.entries()) {
    const { fields = [], ...sectionData } = section;

    const createdSection = await tx.formSection.create({
      data: {
        ...sectionData,
        templateId,
        // Trust array order over any sortOrder the client sent: the builder is
        // drag-and-drop, and the array IS the order the user just arranged.
        sortOrder: sectionIndex,
      },
    });

    if (fields.length > 0) {
      await tx.formField.createMany({
        data: fields.map((field, fieldIndex) => ({
          ...field,
          sectionId: createdSection.id,
          sortOrder: fieldIndex,
        })),
      });
    }
  }
}

/** Removes database ids so a cloned structure is created fresh, not re-linked. */
function stripIds(sections) {
  return sections.map((section) => ({
    key: section.key,
    titleEn: section.titleEn,
    titleAr: section.titleAr,
    descriptionEn: section.descriptionEn,
    descriptionAr: section.descriptionAr,
    sortOrder: section.sortOrder,
    fields: section.fields.map((field) => ({
      key: field.key,
      labelEn: field.labelEn,
      labelAr: field.labelAr,
      helpEn: field.helpEn,
      helpAr: field.helpAr,
      type: field.type,
      isRequired: field.isRequired,
      sortOrder: field.sortOrder,
      config: field.config,
      linkedItemId: field.linkedItemId,
    })),
  }));
}

/** Explicit "create a new version" action for the builder's toolbar. */
export async function forkTemplate(id, actor, context = {}) {
  const current = await prisma.formTemplate.findUnique({
    where: { id },
    select: { id: true, key: true, version: true, status: true },
  });

  if (!current) throw ApiError.notFound('Form template not found');

  return createNewVersion(current, {}, actor, context);
}
