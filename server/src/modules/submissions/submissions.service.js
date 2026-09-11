/**
 * =============================================================================
 *  Equipment report submissions
 * =============================================================================
 *  Where the three parts of the system meet:
 *
 *      the TEMPLATE says what to ask and what "enough" means
 *      the SUBMISSION records what the crew found
 *      the THRESHOLD ENGINE turns that into "what is missing"
 *
 *  EVERY read goes through `buildSubmissionScope()`. That is what implements
 *  "a team admin sees their team's reports only" — as a SQL WHERE clause, so an
 *  out-of-scope report is never selected in the first place and cannot leak via
 *  a forgotten check or a crafted request.
 * =============================================================================
 */

import { prisma } from '../../config/db.js';
import { ApiError } from '../../utils/ApiError.js';
import { paginate, toPrismaPagination } from '../../utils/pagination.js';
import {
  buildSubmissionScope,
  canSubmitForAssignment,
  hasPermission,
} from '../../services/access.service.js';
import { evaluateSubmission, flattenTemplateFields } from '../../services/threshold.service.js';
import { recordAudit, AUDIT_ACTIONS } from '../../services/audit.service.js';

/** Columns for list views — deliberately excludes the bulky `answers` blob. */
const listSelect = {
  id: true,
  shiftDate: true,
  status: true,
  criticalCount: true,
  warnCount: true,
  summary: true,
  submittedAt: true,
  reviewedAt: true,
  createdAt: true,
  templateVersion: true,
  template: { select: { id: true, key: true, titleEn: true, titleAr: true } },
  team: { select: { id: true, nameEn: true, nameAr: true, dayOfWeek: true } },
  vehicle: { select: { id: true, code: true, nameEn: true, kind: true } },
  submittedBy: { select: { id: true, fullName: true } },
  reviewedBy: { select: { id: true, fullName: true } },
};

// =============================================================================
//  READ
// =============================================================================

export async function listSubmissions(query, actor) {
  const scope = buildSubmissionScope(actor);

  // No read scope at all — the person holds none of the three read permissions.
  if (!scope) {
    throw ApiError.forbidden('You do not have permission to view equipment reports');
  }

  const pagination = toPrismaPagination(query);

  const where = {
    // Spread FIRST so a caller-supplied filter can never overwrite the scope.
    // (Order matters: a later key wins in an object spread.)
    ...scope,
    ...(query.teamId ? { teamId: query.teamId } : {}),
    ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.submittedById ? { submittedById: query.submittedById } : {}),
    ...(query.templateKey ? { template: { key: query.templateKey } } : {}),
    ...(query.criticalOnly ? { criticalCount: { gt: 0 } } : {}),
    ...(query.dateFrom || query.dateTo
      ? {
          shiftDate: {
            ...(query.dateFrom ? { gte: query.dateFrom } : {}),
            ...(query.dateTo ? { lte: query.dateTo } : {}),
          },
        }
      : {}),
  };

  return paginate(
    prisma.formSubmission,
    {
      where,
      select: listSelect,
      orderBy: [pagination.orderBy, { createdAt: 'desc' }],
      skip: pagination.skip,
      take: pagination.take,
    },
    { page: query.page, limit: query.limit },
  );
}

/**
 * One full report, including answers and the template it was filled against.
 *
 * The scope is applied as part of the WHERE, so an out-of-scope id returns 404
 * rather than 403 — a 403 would confirm the report exists, which tells a team
 * admin something about another team's operations.
 */
export async function getSubmission(id, actor) {
  const scope = buildSubmissionScope(actor);

  if (!scope) {
    throw ApiError.forbidden('You do not have permission to view equipment reports');
  }

  const submission = await prisma.formSubmission.findFirst({
    where: { id, ...scope },
    include: {
      template: {
        include: {
          sections: {
            orderBy: { sortOrder: 'asc' },
            include: { fields: { orderBy: { sortOrder: 'asc' } } },
          },
        },
      },
      team: { select: { id: true, nameEn: true, nameAr: true } },
      vehicle: { select: { id: true, code: true, nameEn: true, kind: true } },
      submittedBy: { select: { id: true, fullName: true, email: true } },
      reviewedBy: { select: { id: true, fullName: true } },
      assignment: {
        select: {
          firstPerson: { select: { id: true, fullName: true } },
          secondPerson: { select: { id: true, fullName: true } },
        },
      },
    },
  });

  if (!submission) throw ApiError.notFound('Report not found');

  return submission;
}

// =============================================================================
//  WRITE
// =============================================================================

/**
 * Creates or updates a report.
 *
 * One report per (vehicle, date, template family) — enforced by a unique
 * constraint in the schema — so this is an upsert: opening the form again on
 * the same shift continues the same report rather than creating a duplicate
 * that would split the day's record in two.
 */
export async function saveSubmission(input, actor, context = {}) {
  const template = await prisma.formTemplate.findUnique({
    where: { id: input.templateId },
    include: {
      sections: {
        orderBy: { sortOrder: 'asc' },
        include: { fields: { orderBy: { sortOrder: 'asc' } } },
      },
    },
  });

  if (!template) throw ApiError.badRequest('That report form does not exist');

  if (template.status !== 'PUBLISHED') {
    throw ApiError.badRequest('This form is not published and cannot be filled in yet', {
      code: 'TEMPLATE_NOT_PUBLISHED',
    });
  }

  // --- May this person file for this vehicle on this date? -------------------
  const allowed = await canSubmitForAssignment(actor, {
    vehicleId: input.vehicleId,
    shiftDate: input.shiftDate,
    teamId: input.teamId,
  });

  if (!allowed) {
    throw ApiError.forbidden(
      'You are not assigned to this vehicle on this date, so you cannot file its report.',
      { code: 'NOT_ASSIGNED' },
    );
  }

  const fields = flattenTemplateFields(template);

  /**
   * This vehicle's exceptions to the form's rules.
   *
   * Loaded at SUBMIT time and applied by the threshold engine, so the stored
   * verdict already accounts for "474 carries no Matlat". Because the result is
   * frozen onto the submission, changing an exception later cannot silently
   * re-grade a report that was filed under the old rule — the same guarantee
   * template versioning gives.
   */
  const overrides = await prisma.vehicleRuleOverride.findMany({
    where: { vehicleId: input.vehicleId },
  });

  // Reject unknown or wrongly-shaped answers before anything is stored.
  const answers = sanitizeAnswers(fields, input.answers);

  // Required fields are only enforced on SUBMIT: a crew must be able to save a
  // half-finished form and come back to it after a call-out.
  if (input.status === 'SUBMITTED') {
    // Excluded questions are not part of this vehicle's form, so they cannot be
    // "required". Without this, a crew would be unable to submit because of
    // equipment their vehicle is not supposed to carry.
    assertRequiredAnswered(fields, answers, overrides);
  }

  // The stored verdict. Computed here, once — see threshold.service.js.
  const evaluation = evaluateSubmission(fields, answers, overrides);

  const assignment = await prisma.assignment.findFirst({
    where: { vehicleId: input.vehicleId, shiftDate: input.shiftDate },
    select: { id: true },
  });

  const isSubmitting = input.status === 'SUBMITTED';

  const data = {
    templateId: template.id,
    templateVersion: template.version,
    teamId: input.teamId,
    vehicleId: input.vehicleId,
    shiftDate: input.shiftDate,
    assignmentId: assignment?.id ?? null,
    submittedById: actor.id,
    secondPersonName: input.secondPersonName ?? null,
    status: input.status,
    answers,
    summary: evaluation,
    // Denormalised so the day board can sort and badge without opening the JSON.
    criticalCount: evaluation.counts.critical + evaluation.counts.missing,
    warnCount: evaluation.counts.warn,
    submittedAt: isSubmitting ? new Date() : null,
  };

  const existing = await prisma.formSubmission.findFirst({
    where: {
      vehicleId: input.vehicleId,
      shiftDate: input.shiftDate,
      templateId: template.id,
    },
    select: { id: true, status: true, submittedById: true },
  });

  // A submitted report is a record of what was found. Editing it after the fact
  // would let a crew quietly "fix" a shortage the admin has already acted on.
  if (existing && existing.status !== 'DRAFT' && !hasPermission(actor, 'submission:review')) {
    throw ApiError.conflict(
      'This report has already been submitted and can no longer be edited. Ask your team admin.',
      { code: 'ALREADY_SUBMITTED' },
    );
  }

  const submission = existing
    ? await prisma.formSubmission.update({ where: { id: existing.id }, data })
    : await prisma.formSubmission.create({ data });

  await recordAudit({
    actorId: actor.id,
    action: isSubmitting ? AUDIT_ACTIONS.SUBMISSION_SUBMITTED : AUDIT_ACTIONS.SUBMISSION_SAVED,
    entityType: 'FormSubmission',
    entityId: submission.id,
    after: {
      vehicleId: input.vehicleId,
      shiftDate: input.shiftDate,
      status: input.status,
      critical: data.criticalCount,
      warn: data.warnCount,
    },
    req: context.req,
  });

  return submission;
}

/** Team admin acknowledges a report and optionally records what they did. */
export async function reviewSubmission(id, { reviewNote }, actor, context = {}) {
  // getSubmission applies the scope, so a team admin cannot review another
  // team's report even by guessing an id.
  const submission = await getSubmission(id, actor);

  if (submission.status === 'DRAFT') {
    throw ApiError.badRequest('This report has not been submitted yet');
  }

  const updated = await prisma.formSubmission.update({
    where: { id },
    data: {
      status: 'REVIEWED',
      reviewedAt: new Date(),
      reviewedById: actor.id,
      reviewNote: reviewNote ?? null,
    },
    select: listSelect,
  });

  await recordAudit({
    actorId: actor.id,
    action: AUDIT_ACTIONS.SUBMISSION_REVIEWED,
    entityType: 'FormSubmission',
    entityId: id,
    after: { reviewNote },
    req: context.req,
  });

  return updated;
}

// =============================================================================
//  THE DAY BOARD  —  "the summary of the car status for that day"
// =============================================================================

/**
 * Every vehicle for one team on one date, with its report status.
 *
 * Vehicles with NO report are included and marked `MISSING`. That is the whole
 * point: the question the team admin needs answered is "which vehicles have not
 * been checked?", and a list of only the reports that exist cannot answer it.
 */
export async function getDayBoard({ teamId, date }, actor) {
  const scope = buildSubmissionScope(actor);

  if (!scope) {
    throw ApiError.forbidden('You do not have permission to view equipment reports');
  }

  /**
   * Which team's board to show when the caller did not name one.
   *
   * A Team Equipment Officer leading several teams gets one board at a time —
   * their own first — rather than the teams being silently mixed together.
   *
   * The District Equipment Chief SUPERVISES every team without being a crew
   * member of any, so they normally have no memberships at all. Falling through
   * to "you are not a member of any team" locked the person with the most
   * authority out of the one screen they most need. They now fall back to the
   * first active team, and can switch with `?teamId=`.
   */
  const supervisesAllTeams = actor.isSuperAdmin || hasPermission(actor, 'submission:read.all');

  let effectiveTeamId = teamId ?? actor.adminTeamIds[0] ?? actor.memberTeamIds[0];

  if (!effectiveTeamId && supervisesAllTeams) {
    const firstTeam = await prisma.team.findFirst({
      where: { isActive: true },
      // Day order, so an unspecified board opens on Monday rather than
      // whichever team happens to have been created first.
      orderBy: [{ dayOfWeek: 'asc' }, { nameEn: 'asc' }],
      select: { id: true },
    });

    effectiveTeamId = firstTeam?.id;
  }

  if (!effectiveTeamId) {
    throw ApiError.badRequest(
      supervisesAllTeams
        ? 'No teams have been created yet. Add one under Teams.'
        : 'You are not a member of any team.',
      { code: 'NO_TEAM' },
    );
  }

  const [vehicles, submissions, assignments] = await prisma.$transaction([
    prisma.vehicle.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, nameEn: true, nameAr: true, kind: true },
    }),
    prisma.formSubmission.findMany({
      where: { ...scope, teamId: effectiveTeamId, shiftDate: date },
      select: listSelect,
    }),
    prisma.assignment.findMany({
      where: { teamId: effectiveTeamId, shiftDate: date },
      select: {
        vehicleId: true,
        firstPerson: { select: { id: true, fullName: true } },
        secondPerson: { select: { id: true, fullName: true } },
      },
    }),
  ]);

  // Index by vehicle id so the join below is O(n) rather than a nested scan.
  const submissionByVehicle = new Map(submissions.map((row) => [row.vehicle.id, row]));
  const assignmentByVehicle = new Map(assignments.map((row) => [row.vehicleId, row]));

  const rows = vehicles.map((vehicle) => {
    const submission = submissionByVehicle.get(vehicle.id) ?? null;
    const assignment = assignmentByVehicle.get(vehicle.id) ?? null;

    return {
      vehicle,
      assignment,
      submission,
      /**
       * A single value the UI colours the card by:
       *   MISSING   — no report filed (grey/red)
       *   DRAFT     — started, not submitted
       *   CRITICAL  — submitted with at least one red issue
       *   WARN      — submitted with amber issues only
       *   OK        — submitted, everything within threshold
       */
      status: deriveBoardStatus(submission),
      criticalCount: submission?.criticalCount ?? 0,
      warnCount: submission?.warnCount ?? 0,
      /** The top few shortages, so a card can show them without a second call. */
      topIssues: (submission?.summary?.issues ?? []).slice(0, 5),
    };
  });

  return {
    date,
    teamId: effectiveTeamId,
    rows,
    totals: {
      vehicles: rows.length,
      reported: rows.filter((row) => row.submission?.status !== undefined).length,
      missing: rows.filter((row) => row.status === 'MISSING').length,
      critical: rows.filter((row) => row.status === 'CRITICAL').length,
      warn: rows.filter((row) => row.status === 'WARN').length,
      ok: rows.filter((row) => row.status === 'OK').length,
    },
  };
}

function deriveBoardStatus(submission) {
  if (!submission) return 'MISSING';
  if (submission.status === 'DRAFT') return 'DRAFT';
  if (submission.criticalCount > 0) return 'CRITICAL';
  if (submission.warnCount > 0) return 'WARN';
  return 'OK';
}

// =============================================================================
//  ANSWER VALIDATION
// =============================================================================

/**
 * Keeps only answers that correspond to a real field, coerced to the shape that
 * field expects.
 *
 * Necessary because `answers` is a JSONB blob: without this, a client could
 * post arbitrary keys and we would store — and later render — whatever they
 * sent. Dropping unknown keys also means a form that has since had a question
 * removed cannot resurrect it through an old client.
 */
function sanitizeAnswers(fields, rawAnswers = {}) {
  const clean = {};

  for (const field of fields) {
    if (!(field.key in rawAnswers)) continue;

    const value = rawAnswers[field.key];
    if (value === null || value === undefined || value === '') continue;

    switch (field.type) {
      case 'GRID': {
        // Keep only rows the field actually declares.
        if (typeof value !== 'object' || Array.isArray(value)) break;

        const rowKeys = new Set((field.config?.rows ?? []).map((row) => row.key));
        const rows = {};

        for (const [rowKey, rowValue] of Object.entries(value)) {
          if (rowKeys.has(rowKey)) rows[rowKey] = rowValue;
        }

        if (Object.keys(rows).length > 0) clean[field.key] = rows;
        break;
      }

      case 'SINGLE_SELECT': {
        const allowed = (field.config?.options ?? []).map((option) => option.value);
        if (allowed.includes(value)) clean[field.key] = value;
        break;
      }

      case 'MULTI_SELECT': {
        if (!Array.isArray(value)) break;
        const allowed = new Set((field.config?.options ?? []).map((option) => option.value));
        clean[field.key] = value.filter((entry) => allowed.has(entry));
        break;
      }

      case 'NUMBER':
      case 'NUMBER_CHOICE': {
        // "5+" is a legitimate stored value from your form's top choice, so we
        // keep strings as-is and let the threshold engine interpret them.
        clean[field.key] = typeof value === 'string' ? value : Number(value);
        break;
      }

      case 'BOOLEAN':
        clean[field.key] = Boolean(value);
        break;

      default:
        // TEXT, DATE — store as text, capped so one answer cannot bloat the row.
        clean[field.key] = String(value).slice(0, 2000);
    }
  }

  return clean;
}

/** Blocks submission while required questions are unanswered. */
function assertRequiredAnswered(fields, answers, overrides = []) {
  const excluded = new Set(
    overrides.filter((rule) => rule.isExcluded && !rule.rowKey).map((rule) => rule.fieldKey),
  );

  const excludedRows = new Set(
    overrides
      .filter((rule) => rule.isExcluded && rule.rowKey)
      .map((rule) => `${rule.fieldKey}::${rule.rowKey}`),
  );

  const missing = fields
    .filter((field) => field.isRequired && field.type !== 'SECTION_NOTE')
    .filter((field) => !excluded.has(field.key))
    .filter((field) => {
      const value = answers[field.key];

      if (value === undefined || value === null || value === '') return true;

      // A grid counts as answered only when EVERY row has a value — a partly
      // filled matrix is the most common way a shortage goes unnoticed.
      if (field.type === 'GRID') {
        const rows = (field.config?.rows ?? []).filter(
          (row) => !excludedRows.has(`${field.key}::${row.key}`),
        );
        return rows.some((row) => value[row.key] === undefined || value[row.key] === null);
      }

      return false;
    });

  if (missing.length > 0) {
    throw ApiError.validation(
      `${missing.length} required question${missing.length === 1 ? '' : 's'} still need an answer`,
      // Keyed by field key so the React form can scroll to and highlight each one.
      Object.fromEntries(missing.map((field) => [field.key, 'This question is required'])),
    );
  }
}
