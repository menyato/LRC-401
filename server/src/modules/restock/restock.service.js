/**
 * =============================================================================
 *  Restock service — closing the loop between "472 is short" and "472 is full"
 * =============================================================================
 *  THE PROBLEM THIS SOLVES
 *
 *  Before this existed, a shortage was only ever a red badge on a dashboard.
 *  Someone had to notice it, remember it, walk to the cabinet, fetch the items,
 *  load the vehicle, and separately remember to record the stock movement.
 *  Six steps, none of them tracked, and any one of them could be dropped
 *  without anybody finding out until the next report said the same thing again.
 *
 *  THE FLOW — and note who does each step
 *
 *      Team Equipment Officer reviews a report
 *        └─ ticks the shortages worth acting on   ──► OPEN
 *                                                       │
 *      EQUIPMENT OFFICER starts gathering the items ──► PREPARING
 *                                                       │
 *      Items gathered and set aside for the crew    ──► READY
 *        └─ the officer's job ends here. They do NOT walk out to the vehicle.
 *                                                       │
 *      THE CREW collects them and confirms loaded   ──► CONFIRMED
 *        └─ stock TRANSFERS cabinet ➜ vehicle at THIS point
 *
 *  WHY THE STOCK MOVES AT CONFIRM, NOT BEFORE
 *
 *  An earlier version moved it when the officer finished, on the assumption
 *  that they delivered to the vehicle. They do not — they collate and set
 *  aside, and the crew comes to fetch. Moving the stock when the officer
 *  finished would have recorded items as being on an ambulance while they were
 *  still sitting on a shelf, and if the crew never came, the ledger would have
 *  been permanently wrong with nothing to correct it.
 *
 *  Confirming is also the only step the crew performs, which makes it the
 *  meaningful one: somebody is attesting the items are physically in their
 *  vehicle.
 *
 *  THE RULE THAT MATTERS: the transfer happens in the SAME TRANSACTION as the
 *  confirmation. If the cabinet turns out to be empty, the confirmation fails
 *  with it — the board can never claim a vehicle was refilled from stock the
 *  ledger says never moved.
 * =============================================================================
 */

import { prisma } from '../../config/db.js';
import { ApiError } from '../../utils/ApiError.js';
import { buildSubmissionScope, hasPermission } from '../../services/access.service.js';
import { recordAudit, AUDIT_ACTIONS } from '../../services/audit.service.js';
import { PRIORITY_RANK } from '../../services/threshold.service.js';

/** Everything a board card needs, in one shape used by every endpoint here. */
const cardInclude = {
  vehicle: { select: { id: true, code: true, nameEn: true, nameAr: true, kind: true } },
  team: { select: { id: true, nameEn: true, nameAr: true } },
  requestedBy: { select: { id: true, fullName: true } },
  assignedTo: { select: { id: true, fullName: true } },
  confirmedBy: { select: { id: true, fullName: true } },
  sourceLocation: { select: { id: true, nameEn: true, nameAr: true, kind: true } },
  targetLocation: { select: { id: true, nameEn: true, nameAr: true, kind: true } },
  lines: {
    orderBy: { createdAt: 'asc' },
    include: {
      item: { select: { id: true, nameEn: true, nameAr: true, unit: true, trackSize: true } },
    },
  },
};

/**
 * Which cards this person may see.
 *
 * Three audiences, and each needs a different slice:
 *
 *   District Chief / deputy  — everything
 *   Team Equipment Officer   — their teams' jobs (they raise and prepare them)
 *   Crew                     — jobs for the vehicles they are rostered on,
 *                              because they are the ones who come and collect
 *
 * Plus, for everybody, any job they personally raised, prepared or confirmed.
 */
async function buildRestockScope(actor) {
  // Station-wide (District Chief, deputy, anyone with read.all): no restriction.
  if (actor.isSuperAdmin || hasPermission(actor, 'submission:read.all')) return {};

  const clauses = [
    // Always visible: a job you raised, or one you are preparing.
    { requestedById: actor.id },
    { assignedToId: actor.id },
    { confirmedById: actor.id },
  ];

  // A Team Equipment Officer sees everything for the teams they lead.
  if (hasPermission(actor, 'submission:read.team') && actor.adminTeamIds.length > 0) {
    clauses.push({ teamId: { in: actor.adminTeamIds } });
  }

  /**
   * A CREW MEMBER sees jobs for the vehicles they are rostered on.
   *
   * This clause is the one that makes the whole workflow function, and it was
   * missing. Deriving restock visibility from the report scope alone meant an
   * EMT with `submission:read.own` could only see jobs THEY had raised — but
   * jobs are raised by the equipment officer. The crew, who are the people
   * meant to walk over and collect the items, could not see that anything was
   * waiting for them.
   *
   * Rostered-on is the right test: it is the same fact that decides whether
   * they may file that vehicle's report in the first place.
   */
  const assignments = await prisma.assignment.findMany({
    where: { OR: [{ firstPersonId: actor.id }, { secondPersonId: actor.id }] },
    select: { vehicleId: true },
    // A crew member needs to see what is waiting for the vehicle they are on
    // now, not every vehicle they have ever been on.
    orderBy: { shiftDate: 'desc' },
    take: 50,
  });

  const vehicleIds = [...new Set(assignments.map((assignment) => assignment.vehicleId))];

  if (vehicleIds.length > 0) {
    clauses.push({ vehicleId: { in: vehicleIds } });
  }

  return { OR: clauses };
}

// =============================================================================
//  READ
// =============================================================================

/**
 * The Kanban board: cards grouped into their status columns.
 *
 * Returns ALL columns even when empty, so the board renders a stable layout
 * rather than columns appearing and disappearing as work moves.
 */
export async function getBoard({ teamId, vehicleId, days = 30 }, actor) {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);

  /**
   * `AND` rather than spreading, because both the scope and the age window can
   * each contain an `OR`, and spreading two objects that both have an `OR` key
   * silently keeps only the last one — which would have widened the scope.
   */
  const where = {
    AND: [
      await buildRestockScope(actor),
      {
        // Unfinished work stays on the board no matter how old it is: a job
        // nobody completed must not quietly vanish because a fortnight passed.
        // Finished work drops off after the window so the board stays about now.
        OR: [
          { status: { in: ['OPEN', 'PREPARING', 'READY'] } },
          { createdAt: { gte: since } },
        ],
      },
      ...(teamId ? [{ teamId }] : []),
      ...(vehicleId ? [{ vehicleId }] : []),
    ],
  };

  const cards = await prisma.restockRequest.findMany({
    where,
    include: cardInclude,
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
  });

  // Sort by real priority rank — Prisma orders enums by their declaration
  // order, which happens to be LOW..URGENT, i.e. backwards from what we want.
  cards.sort(
    (a, b) =>
      (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2) ||
      a.createdAt.getTime() - b.createdAt.getTime(),
  );

  const columns = ['OPEN', 'PREPARING', 'READY', 'CONFIRMED'];

  return {
    columns: columns.map((status) => ({
      status,
      cards: cards.filter((card) => card.status === status),
    })),
    // Cancelled jobs are kept out of the columns but still reachable, so the
    // board stays about work that matters while nothing is silently destroyed.
    cancelled: cards.filter((card) => card.status === 'CANCELLED'),
    totals: {
      open: cards.filter((card) => card.status === 'OPEN').length,
      preparing: cards.filter((card) => card.status === 'PREPARING').length,
      // The count that matters most day to day: items sitting on the shelf
      // waiting for a crew to come and take them.
      ready: cards.filter((card) => card.status === 'READY').length,
      urgent: cards.filter(
        (card) => card.priority === 'URGENT' && card.status !== 'CONFIRMED',
      ).length,
    },
  };
}

export async function getRequest(id, actor) {
  const request = await prisma.restockRequest.findFirst({
    where: { id, ...(await buildRestockScope(actor)) },
    include: { ...cardInclude, submission: { select: { id: true, shiftDate: true } } },
  });

  if (!request) throw ApiError.notFound('Restock job not found');

  return request;
}

// =============================================================================
//  CREATE — from a report's shortages
// =============================================================================

/**
 * Raises a restock job from the shortages the reviewer selected.
 *
 * `selections` are the issue keys from the report's stored summary. We read the
 * labels and quantities from that summary rather than trusting the client, so a
 * tampered request cannot invent a line for an item nobody was short of.
 */
export async function createFromSubmission(
  submissionId,
  { selections, assignedToId, sourceLocationId, note },
  actor,
  context = {},
) {
  const submission = await prisma.formSubmission.findFirst({
    where: { id: submissionId, ...(buildSubmissionScope(actor) ?? { id: '__none__' }) },
    include: {
      vehicle: { select: { id: true, code: true, nameEn: true } },
      template: {
        include: {
          sections: { include: { fields: true } },
        },
      },
    },
  });

  if (!submission) throw ApiError.notFound('Report not found');

  if (submission.status === 'DRAFT') {
    throw ApiError.badRequest('This report has not been submitted yet', { code: 'REPORT_IS_DRAFT' });
  }

  // --- Source: the daily cabinet by default ---------------------------------
  const source = sourceLocationId
    ? await prisma.storageLocation.findUnique({ where: { id: sourceLocationId } })
    : await prisma.storageLocation.findFirst({ where: { kind: 'CABINET', isActive: true } });

  if (!source) {
    throw ApiError.badRequest(
      'No source location found. Add a daily cabinet under Inventory → Locations.',
      { code: 'NO_SOURCE_LOCATION' },
    );
  }

  // --- Target: the vehicle's own location -----------------------------------
  const target = await prisma.storageLocation.findFirst({
    where: { vehicleId: submission.vehicleId },
  });

  if (!target) {
    throw ApiError.badRequest(
      `${submission.vehicle.code} has no storage location. Re-run the seed, or add one under Inventory → Locations.`,
      { code: 'NO_VEHICLE_LOCATION' },
    );
  }

  // --- Build the lines from the STORED summary, not from the request --------
  const issues = submission.summary?.issues ?? [];

  // Index the template's fields so a line can inherit its linked item.
  const fieldsByKey = new Map(
    submission.template.sections
      .flatMap((section) => section.fields)
      .map((field) => [field.key, field]),
  );

  const selected = new Set(selections.map((s) => `${s.field}::${s.row ?? ''}`));

  const lines = issues
    .filter((issue) => selected.has(`${issue.field}::${issue.row ?? ''}`))
    .map((issue) => {
      const field = fieldsByKey.get(issue.field);

      // A GRID row can carry its own linked item; otherwise fall back to the
      // field's. Either may be absent — the line is still useful as a checklist
      // entry, it just cannot move stock by itself.
      const row = (field?.config?.rows ?? []).find((r) => r.key === issue.row);
      const itemId = issue.linkedItemId ?? row?.linkedItemId ?? field?.linkedItemId ?? null;

      // The override the reviewer typed, if any.
      const override = selections.find(
        (s) => s.field === issue.field && (s.row ?? null) === (issue.row ?? null),
      );

      const gap = Math.max(
        1,
        (issue.expected ?? 1) - (typeof issue.value === 'number' ? issue.value : 0),
      );

      return {
        fieldKey: issue.field,
        rowKey: issue.row ?? null,
        label: issue.label,
        labelAr: issue.labelAr ?? null,
        itemId,
        // For a size-tracked item the grid row IS usually the size ("Large"),
        // so it is a sensible default the officer can correct.
        size: override?.size ?? null,
        priority: issue.priority ?? 'NORMAL',
        reportedQuantity: typeof issue.value === 'number' ? issue.value : null,
        expectedQuantity: issue.expected ?? null,
        quantityNeeded: override?.quantityNeeded ?? gap,
      };
    });

  if (lines.length === 0) {
    throw ApiError.badRequest('Select at least one item to restock', { code: 'NO_LINES' });
  }

  // The card's priority is the most urgent of its lines, so the board can sort
  // without opening every card.
  const priority = lines.reduce(
    (worst, line) =>
      (PRIORITY_RANK[line.priority] ?? 2) < (PRIORITY_RANK[worst] ?? 2) ? line.priority : worst,
    'LOW',
  );

  const request = await prisma.restockRequest.create({
    data: {
      submissionId: submission.id,
      vehicleId: submission.vehicleId,
      teamId: submission.teamId,
      shiftDate: submission.shiftDate,
      status: 'OPEN',
      priority,
      sourceLocationId: source.id,
      targetLocationId: target.id,
      requestedById: actor.id,
      assignedToId: assignedToId ?? null,
      note: note ?? null,
      lines: { create: lines },
    },
    include: cardInclude,
  });

  await recordAudit({
    actorId: actor.id,
    action: AUDIT_ACTIONS.RESTOCK_CREATED,
    entityType: 'RestockRequest',
    entityId: request.id,
    after: {
      submissionId: submission.id,
      vehicle: submission.vehicle.code,
      lineCount: lines.length,
      priority,
    },
    req: context.req,
  });

  return request;
}

// =============================================================================
//  MOVE ACROSS THE BOARD
// =============================================================================

/** Which transitions are legal. Anything not listed is refused. */
const ALLOWED_TRANSITIONS = {
  OPEN: ['PREPARING', 'CANCELLED'],
  // Back to OPEN is allowed: an officer may start and have to hand it over.
  PREPARING: ['READY', 'OPEN', 'CANCELLED'],
  // Back to PREPARING is allowed — nothing has moved yet, and the officer may
  // realise a line is wrong after setting the items aside.
  READY: ['CONFIRMED', 'PREPARING', 'CANCELLED'],
  // NOTHING comes back from CONFIRMED: stock has moved, and reversing it must
  // be an explicit, audited stock adjustment rather than a button on a board.
  CONFIRMED: [],
  CANCELLED: ['OPEN'],
};

/**
 * Moves a card to a new status.
 *
 * CONFIRMED is the significant one: it performs the stock transfer from the
 * cabinet to the vehicle, in the same transaction as the status change.
 */
export async function changeStatus(id, { status, lineQuantities }, actor, context = {}) {
  const request = await getRequest(id, actor);

  const allowed = ALLOWED_TRANSITIONS[request.status] ?? [];

  if (!allowed.includes(status)) {
    throw ApiError.badRequest(
      `A job that is ${request.status} cannot move to ${status}.` +
        (request.status === 'CONFIRMED'
          ? ' Stock has already been moved — correct it with a stock adjustment instead.'
          : ''),
      { code: 'INVALID_TRANSITION', details: { from: request.status, allowed } },
    );
  }

  // Gathering the items is the equipment officer's job.
  if (['PREPARING', 'READY'].includes(status) && !hasPermission(actor, 'restock:prepare')) {
    throw ApiError.forbidden('You do not have permission to prepare restock jobs', {
      code: 'MISSING_PERMISSION',
      details: { required: 'restock:prepare' },
    });
  }

  // Confirming is the crew's, and it is the step that moves stock.
  if (status === 'CONFIRMED' && !hasPermission(actor, 'restock:confirm')) {
    throw ApiError.forbidden('You do not have permission to confirm a refill', {
      code: 'MISSING_PERMISSION',
      details: { required: 'restock:confirm' },
    });
  }

  // --- CONFIRMED: the crew has it in the vehicle, so move the stock ----------
  if (status === 'CONFIRMED') {
    return confirmLoaded(request, lineQuantities ?? [], actor, context);
  }

  const updated = await prisma.restockRequest.update({
    where: { id },
    data: {
      status,
      startedAt: status === 'PREPARING' ? new Date() : request.startedAt,
      readyAt: status === 'READY' ? new Date() : request.readyAt,
      // Starting work claims it, so the board shows who is gathering.
      assignedToId:
        status === 'PREPARING' && !request.assignedToId ? actor.id : request.assignedToId,
    },
    include: cardInclude,
  });

  await recordAudit({
    actorId: actor.id,
    action:
      status === 'CONFIRMED'
        ? AUDIT_ACTIONS.RESTOCK_CONFIRMED
        : status === 'CANCELLED'
          ? AUDIT_ACTIONS.RESTOCK_CANCELLED
          : AUDIT_ACTIONS.RESTOCK_STATUS_CHANGED,
    entityType: 'RestockRequest',
    entityId: id,
    before: { status: request.status },
    after: { status },
    req: context.req,
  });

  return updated;
}

/**
 * The crew confirms the items are in their vehicle — and the stock moves.
 *
 * `lineQuantities` lets them record what they ACTUALLY took, which may be less
 * than was set aside if the cabinet was short. That shortfall is worth
 * recording rather than smoothing over: it is the signal that the cabinet
 * itself needs replenishing from the main store, and it stops the vehicle's
 * recorded holdings from claiming items nobody received.
 */
async function confirmLoaded(request, lineQuantities, actor, context) {
  const quantityByLine = new Map(
    lineQuantities.map((entry) => [entry.lineId, entry.quantityIssued]),
  );

  const results = await prisma.$transaction(async (tx) => {
    const fulfilled = [];

    for (const line of request.lines) {
      const issued = quantityByLine.has(line.id)
        ? quantityByLine.get(line.id)
        : line.quantityNeeded;

      // Nothing loaded for this line — record that, move no stock.
      if (!issued || issued <= 0) {
        await tx.restockLine.update({
          where: { id: line.id },
          data: { quantityIssued: 0, isFulfilled: false },
        });
        continue;
      }

      // A line with no linked inventory item is still a real checklist entry
      // (someone fetched it) — it just cannot move a balance automatically.
      if (!line.itemId) {
        await tx.restockLine.update({
          where: { id: line.id },
          data: { quantityIssued: issued, isFulfilled: true },
        });
        fulfilled.push({ lineId: line.id, issued, moved: false });
        continue;
      }

      // THE TRANSFER: cabinet ➜ vehicle. Inside this transaction, so a failure
      // here aborts the whole confirmation rather than leaving the board
      // claiming a refill the ledger denies.
      await applyTransfer(tx, {
        itemId: line.itemId,
        quantity: issued,
        size: line.size,
        fromLocationId: request.sourceLocationId,
        toLocationId: request.targetLocationId,
        teamId: request.teamId,
        vehicleId: request.vehicleId,
        restockLineId: line.id,
        reason: 'restock',
        note: `Restock ${request.vehicle.code} — ${line.label}`,
        actorId: actor.id,
      });

      await tx.restockLine.update({
        where: { id: line.id },
        data: { quantityIssued: issued, isFulfilled: true },
      });

      fulfilled.push({ lineId: line.id, issued, moved: true });
    }

    const updated = await tx.restockRequest.update({
      where: { id: request.id },
      data: {
        status: 'CONFIRMED',
        confirmedAt: new Date(),
        // The crew member who collected and loaded them. Deliberately recorded
        // separately from whoever prepared the job.
        confirmedById: actor.id,
      },
      include: cardInclude,
    });

    return { updated, fulfilled };
  });

  await recordAudit({
    actorId: actor.id,
    action: AUDIT_ACTIONS.RESTOCK_CONFIRMED,
    entityType: 'RestockRequest',
    entityId: request.id,
    after: {
      vehicle: request.vehicle.code,
      linesFulfilled: results.fulfilled.length,
      stockMoved: results.fulfilled.filter((f) => f.moved).length,
    },
    req: context.req,
  });

  return results.updated;
}

/**
 * The stock half of a delivery, written directly against the transaction client.
 *
 * Mirrors inventory.service.js's own transfer logic. It is duplicated here
 * rather than imported because that module's public functions open their own
 * transaction, and nesting one inside this one would defeat the atomicity that
 * is the entire point of this step.
 */
async function applyTransfer(tx, input) {
  const item = await tx.item.findUnique({
    where: { id: input.itemId },
    select: { id: true, nameEn: true, trackSize: true, trackExpiry: true, isActive: true },
  });

  if (!item) throw ApiError.badRequest('That item no longer exists');

  const size = item.trackSize ? (input.size ?? null) : null;

  if (item.trackSize && !size) {
    throw ApiError.badRequest(
      `"${item.nameEn}" is tracked by size — set the size on this line before delivering.`,
      { code: 'SIZE_REQUIRED' },
    );
  }

  const movementDate = new Date();
  const dateOnly = new Date(
    Date.UTC(movementDate.getUTCFullYear(), movementDate.getUTCMonth(), movementDate.getUTCDate()),
  );

  /** Moves one side of the transfer. See inventory.service.js for the rationale. */
  const moveSide = async (locationId, delta, restockLineId) => {
    const lotKey = {
      itemId: item.id,
      locationId,
      size,
      // Restock does not pick a specific batch: it draws from unbatched stock.
      // Batch-level picking would need a FEFO strategy, which is listed as
      // future work in the roadmap rather than guessed at here.
      batchNumber: null,
      expiryDate: null,
    };

    let lot = await tx.stockLot.findFirst({ where: lotKey });

    if (!lot) {
      if (delta < 0) {
        throw ApiError.conflict(
          `The cabinet has no "${item.nameEn}"${size ? ` (${size})` : ''} to give.`,
          { code: 'INSUFFICIENT_STOCK', details: { available: 0 } },
        );
      }
      lot = await tx.stockLot.create({ data: { ...lotKey, quantityOnHand: 0 } });
    }

    const balanceAfter = lot.quantityOnHand + delta;

    if (balanceAfter < 0) {
      throw ApiError.conflict(
        `Not enough "${item.nameEn}"${size ? ` (${size})` : ''} in the cabinet: ` +
          `${lot.quantityOnHand} available, ${Math.abs(delta)} needed.`,
        { code: 'INSUFFICIENT_STOCK', details: { available: lot.quantityOnHand } },
      );
    }

    await tx.stockLot.update({ where: { id: lot.id }, data: { quantityOnHand: balanceAfter } });

    await tx.stockMovement.create({
      data: {
        itemId: item.id,
        lotId: lot.id,
        direction: 'TRANSFER',
        quantity: delta,
        movementDate: dateOnly,
        fromLocationId: input.fromLocationId,
        toLocationId: input.toLocationId,
        teamId: input.teamId ?? null,
        vehicleId: input.vehicleId ?? null,
        reason: input.reason ?? null,
        note: input.note ?? null,
        // Only ONE of the two rows carries the link — the column is unique, and
        // the source row is the one that represents "this line was fulfilled".
        restockLineId: restockLineId ?? null,
        balanceAfter,
        recordedById: input.actorId,
      },
    });
  };

  // Source first, so an empty cabinet aborts before stock is invented.
  await moveSide(input.fromLocationId, -input.quantity, input.restockLineId);
  await moveSide(input.toLocationId, input.quantity, null);
}

// =============================================================================
//  EDIT
// =============================================================================

export async function assign(id, { assignedToId }, actor, context = {}) {
  await getRequest(id, actor);

  const updated = await prisma.restockRequest.update({
    where: { id },
    data: { assignedToId: assignedToId ?? null },
    include: cardInclude,
  });

  await recordAudit({
    actorId: actor.id,
    action: AUDIT_ACTIONS.RESTOCK_ASSIGNED,
    entityType: 'RestockRequest',
    entityId: id,
    after: { assignedToId },
    req: context.req,
  });

  return updated;
}

/** Edits the quantity, size or item on one line, before it is delivered. */
export async function updateLine(id, lineId, data, actor, context = {}) {
  const request = await getRequest(id, actor);

  if (request.status === 'CONFIRMED') {
    throw ApiError.conflict(
      'This job is confirmed — its lines record what actually moved onto the vehicle and cannot be edited.',
      { code: 'ALREADY_CONFIRMED' },
    );
  }

  const line = request.lines.find((candidate) => candidate.id === lineId);
  if (!line) throw ApiError.notFound('Line not found on this job');

  const updated = await prisma.restockLine.update({
    where: { id: lineId },
    data: {
      quantityNeeded: data.quantityNeeded ?? line.quantityNeeded,
      size: data.size === undefined ? line.size : data.size,
      itemId: data.itemId === undefined ? line.itemId : data.itemId,
      priority: data.priority ?? line.priority,
      note: data.note === undefined ? line.note : data.note,
    },
  });

  await recordAudit({
    actorId: actor.id,
    action: AUDIT_ACTIONS.RESTOCK_STATUS_CHANGED,
    entityType: 'RestockLine',
    entityId: lineId,
    before: line,
    after: updated,
    req: context.req,
  });

  return getRequest(id, actor);
}
