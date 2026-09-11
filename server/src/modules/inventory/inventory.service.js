/**
 * =============================================================================
 *  Inventory service
 * =============================================================================
 *  ONE engine serving both the clothing store and the medical equipment store.
 *
 *  THE CENTRAL INVARIANT
 *  ---------------------
 *      StockLot.quantityOnHand  ===  SUM of that lot's StockMovement rows
 *
 *  `quantityOnHand` is a CACHE of the ledger, kept so the item list can show
 *  live balances without summing thousands of rows on every page load. The
 *  cache is only trustworthy if it is updated in the SAME TRANSACTION as the
 *  movement that changes it — which is why every write here goes through
 *  `prisma.$transaction`, and why nothing outside this file is allowed to write
 *  `quantityOnHand`.
 *
 *  Two consequences, both deliberate:
 *    • Movements are IMMUTABLE. There is no update or delete. A mistake is
 *      corrected with a compensating ADJUST row, so the ledger always explains
 *      itself.
 *    • Stock cannot go negative. A store that reports -3 tourniquets has lost
 *      the ability to tell you what it actually holds.
 * =============================================================================
 */

import { prisma } from '../../config/db.js';
import { ApiError } from '../../utils/ApiError.js';
import { paginate, searchFilter, toPrismaPagination } from '../../utils/pagination.js';
import { recordAudit, AUDIT_ACTIONS } from '../../services/audit.service.js';

// =============================================================================
//  CATEGORIES  &  DYNAMIC ATTRIBUTES
// =============================================================================

/** Categories with their attribute definitions, for the item form to render. */
export async function listCategories({ includeInactive = false } = {}) {
  return prisma.itemCategory.findMany({
    where: includeInactive ? {} : { isActive: true },
    include: {
      attributeDefs: { orderBy: { sortOrder: 'asc' } },
      _count: { select: { items: true } },
    },
    orderBy: { nameEn: 'asc' },
  });
}

/**
 * Creates or updates a dynamic attribute for a category.
 *
 * `key` is the identity: re-sending the same key edits the existing definition
 * rather than creating a duplicate. That matters because the key is what item
 * `attributes` JSON is stored under — changing it would orphan every stored
 * value, so the API simply does not offer a way to rename one.
 */
export async function upsertAttributeDef(categoryId, data, actor, context = {}) {
  const category = await prisma.itemCategory.findUnique({
    where: { id: categoryId },
    select: { id: true },
  });

  if (!category) throw ApiError.notFound('Category not found');

  const definition = await prisma.itemAttributeDef.upsert({
    where: { categoryId_key: { categoryId, key: data.key } },
    create: { ...data, categoryId },
    update: { ...data, categoryId: undefined, key: undefined },
  });

  await recordAudit({
    actorId: actor.id,
    action: AUDIT_ACTIONS.ATTRIBUTE_DEF_CHANGED,
    entityType: 'ItemAttributeDef',
    entityId: definition.id,
    after: definition,
    req: context.req,
  });

  return definition;
}

/**
 * Removes an attribute definition.
 *
 * Existing values stay inside each item's `attributes` JSON. That is
 * intentional: deleting a field should not silently destroy data an admin may
 * have spent weeks collecting. The values simply stop being displayed, and
 * re-creating the field with the same key brings them back.
 */
export async function deleteAttributeDef(id, actor, context = {}) {
  const definition = await prisma.itemAttributeDef.findUnique({ where: { id } });
  if (!definition) throw ApiError.notFound('Field not found');

  await prisma.itemAttributeDef.delete({ where: { id } });

  await recordAudit({
    actorId: actor.id,
    action: AUDIT_ACTIONS.ATTRIBUTE_DEF_CHANGED,
    entityType: 'ItemAttributeDef',
    entityId: id,
    before: definition,
    req: context.req,
  });
}

// =============================================================================
//  ITEMS
// =============================================================================

/**
 * The item list — your spreadsheet, with live totals.
 *
 * `lots` are included so the frontend can render the size/batch breakdown
 * inline; `totalOnHand` is summed here rather than in the browser so that
 * sorting and the low-stock filter agree with what is displayed.
 */
export async function listItems(query) {
  const { page, limit, search, categoryId, categoryKey, includeInactive, lowStockOnly, expiringOnly, trackExpiry } =
    query;
  const pagination = toPrismaPagination(query);

  const where = {
    ...(includeInactive ? {} : { isActive: true }),
    ...(categoryId ? { categoryId } : {}),
    ...(categoryKey ? { category: { key: categoryKey } } : {}),
    ...(trackExpiry !== undefined ? { trackExpiry } : {}),
    ...searchFilter(search, ['nameEn', 'nameAr', 'sku']),
    ...(expiringOnly
      ? {
          trackExpiry: true,
          lots: {
            some: {
              quantityOnHand: { gt: 0 },
              expiryDate: { not: null, lte: addDays(new Date(), 60) },
            },
          },
        }
      : {}),
  };

  const result = await paginate(
    prisma.item,
    {
      where,
      include: {
        category: { select: { id: true, key: true, nameEn: true, nameAr: true } },
        lots: {
          // Hide emptied lots: a storekeeper wants to see what is there, not a
          // list of batches that ran out last year.
          where: { quantityOnHand: { gt: 0 } },
          orderBy: [{ expiryDate: 'asc' }, { size: 'asc' }],
        },
      },
      orderBy: pagination.orderBy,
      skip: pagination.skip,
      take: pagination.take,
    },
    { page, limit },
  );

  // Derive the roll-up numbers the UI needs on every row.
  result.data = result.data.map(decorateItem);

  // `lowStockOnly` filters AFTER the query because the total is a sum across
  // lots, which Prisma cannot express in a `where`. The trade-off is that this
  // filter applies within the current page. It is used on a small "what needs
  // restocking" screen, so that is acceptable — and it keeps us from dropping
  // to raw SQL for a secondary feature.
  if (lowStockOnly) {
    result.data = result.data.filter((item) => item.isLowStock);
  }

  return result;
}

/** Adds computed fields every item view needs. Written once, used everywhere. */
function decorateItem(item) {
  const totalOnHand = item.lots.reduce((sum, lot) => sum + lot.quantityOnHand, 0);
  const warningDate = addDays(new Date(), item.expiryWarningDays);

  return {
    ...item,
    totalOnHand,
    isLowStock: item.lowStockThreshold > 0 && totalOnHand <= item.lowStockThreshold,
    /** Lots expiring inside this item's own warning window. */
    expiringLots: item.trackExpiry
      ? item.lots.filter((lot) => lot.expiryDate && lot.expiryDate <= warningDate)
      : [],
    /** Already past their date and still on the shelf — must be pulled. */
    expiredLots: item.trackExpiry
      ? item.lots.filter((lot) => lot.expiryDate && lot.expiryDate < startOfToday())
      : [],
  };
}

export async function getItem(id) {
  const item = await prisma.item.findUnique({
    where: { id },
    include: {
      category: { include: { attributeDefs: { orderBy: { sortOrder: 'asc' } } } },
      lots: { orderBy: [{ expiryDate: 'asc' }, { size: 'asc' }] },
    },
  });

  if (!item) throw ApiError.notFound('Item not found');

  return decorateItem(item);
}

export async function createItem(data, actor, context = {}) {
  const category = await prisma.itemCategory.findUnique({
    where: { id: data.categoryId },
    select: { id: true },
  });

  if (!category) throw ApiError.badRequest('The selected category does not exist');

  const item = await prisma.item.create({ data });

  await recordAudit({
    actorId: actor.id,
    action: AUDIT_ACTIONS.ITEM_CREATED,
    entityType: 'Item',
    entityId: item.id,
    after: item,
    req: context.req,
  });

  return item;
}

export async function updateItem(id, data, actor, context = {}) {
  const before = await prisma.item.findUnique({ where: { id }, include: { lots: true } });
  if (!before) throw ApiError.notFound('Item not found');

  // --- Guard: turning tracking OFF while stock exists ------------------------
  // Existing lots are keyed by (size, batch, expiry). Flipping a flag off would
  // leave balances sitting on lots the UI no longer knows how to display, and
  // the totals would appear to change for no reason.
  const hasStock = before.lots.some((lot) => lot.quantityOnHand > 0);

  if (hasStock && data.trackSize === false && before.trackSize) {
    throw ApiError.conflict(
      'This item still has stock recorded per size. Issue or adjust it to zero before turning size tracking off.',
      { code: 'STOCK_EXISTS' },
    );
  }

  if (hasStock && data.trackExpiry === false && before.trackExpiry) {
    throw ApiError.conflict(
      'This item still has stock recorded against batches. Clear it before turning expiry tracking off.',
      { code: 'STOCK_EXISTS' },
    );
  }

  // --- Guard: removing a size that still holds stock -------------------------
  if (data.sizes && before.trackSize) {
    const removed = before.lots
      .filter((lot) => lot.quantityOnHand > 0 && lot.size && !data.sizes.includes(lot.size))
      .map((lot) => lot.size);

    if (removed.length > 0) {
      throw ApiError.conflict(
        `Cannot remove size(s) ${[...new Set(removed)].join(', ')} — stock is still recorded against them.`,
        { code: 'SIZE_IN_USE' },
      );
    }
  }

  const item = await prisma.item.update({ where: { id }, data });

  await recordAudit({
    actorId: actor.id,
    action: AUDIT_ACTIONS.ITEM_UPDATED,
    entityType: 'Item',
    entityId: id,
    // Strip lots from the snapshot: they are a large, separately-audited
    // structure and would drown the diff.
    before: { ...before, lots: undefined },
    after: item,
    req: context.req,
  });

  return item;
}

/** Deactivate, never delete — movements reference this row forever. */
export async function deactivateItem(id, actor, context = {}) {
  const item = await prisma.item.findUnique({ where: { id }, include: { lots: true } });
  if (!item) throw ApiError.notFound('Item not found');

  const remaining = item.lots.reduce((sum, lot) => sum + lot.quantityOnHand, 0);

  if (remaining > 0) {
    throw ApiError.conflict(
      `This item still has ${remaining} in stock. Issue or write it off first.`,
      { code: 'STOCK_EXISTS' },
    );
  }

  await prisma.item.update({ where: { id }, data: { isActive: false } });

  await recordAudit({
    actorId: actor.id,
    action: AUDIT_ACTIONS.ITEM_DEACTIVATED,
    entityType: 'Item',
    entityId: id,
    before: item,
    req: context.req,
  });
}

// =============================================================================
//  STOCK MOVEMENTS
// =============================================================================

/** The in/out log — your "summary log", paginated and filterable. */
export async function listMovements(query) {
  const { page, limit, search, itemId, categoryId, direction, teamId, vehicleId, issuedToUserId, dateFrom, dateTo } =
    query;
  const pagination = toPrismaPagination(query);

  const where = {
    ...(itemId ? { itemId } : {}),
    ...(categoryId ? { item: { categoryId } } : {}),
    ...(direction ? { direction } : {}),
    ...(teamId ? { teamId } : {}),
    ...(vehicleId ? { vehicleId } : {}),
    ...(issuedToUserId ? { issuedToUserId } : {}),
    // Both bounds inclusive — `dateTo` is a date at UTC midnight, and `lte`
    // against a `@db.Date` column includes that whole day.
    ...(dateFrom || dateTo
      ? { movementDate: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateTo ? { lte: dateTo } : {}) } }
      : {}),
    ...searchFilter(search, ['counterparty', 'note', 'documentRef', 'reason']),
  };

  return paginate(
    prisma.stockMovement,
    {
      where,
      include: {
        item: { select: { id: true, nameEn: true, nameAr: true, unit: true, categoryId: true } },
        lot: { select: { size: true, batchNumber: true, expiryDate: true } },
        issuedToUser: { select: { id: true, fullName: true } },
        team: { select: { id: true, nameEn: true, nameAr: true } },
        vehicle: { select: { id: true, code: true } },
        recordedBy: { select: { id: true, fullName: true } },
      },
      // Secondary sort by createdAt so several movements on the same DAY appear
      // in the order they were actually recorded, not arbitrarily.
      orderBy: [pagination.orderBy, { createdAt: 'desc' }],
      skip: pagination.skip,
      take: pagination.take,
    },
    { page, limit },
  );
}

/**
 * Records ONE movement.
 *
 * @param {object} input   Validated createMovementSchema payload.
 * @param {object} actor   req.user
 */
export async function createMovement(input, actor, context = {}) {
  const result = await prisma.$transaction(async (tx) =>
    applyMovement(tx, input, actor, input.movementDate ?? startOfToday()),
  );

  await recordAudit({
    actorId: actor.id,
    action: auditActionFor(input.direction),
    entityType: 'StockMovement',
    entityId: result.movement.id,
    after: {
      itemId: input.itemId,
      direction: input.direction,
      quantity: input.quantity,
      size: input.size,
      batchNumber: input.batchNumber,
      balanceAfter: result.movement.balanceAfter,
    },
    req: context.req,
  });

  return result;
}

/**
 * Records MANY movements as one atomic operation.
 *
 * Used for "issue a full uniform" and "restock a vehicle after its report".
 * All-or-nothing: a partial issue would leave the store's books wrong in a way
 * nobody would notice until the next physical count.
 */
export async function createBulkMovements(input, actor, context = {}) {
  const { lines, movementDate, ...shared } = input;
  const date = movementDate ?? startOfToday();

  const results = await prisma.$transaction(async (tx) => {
    const applied = [];

    // Sequential, not Promise.all: two lines may touch the SAME lot (e.g. two
    // sizes of one item, or a repeated item id). Running them in parallel
    // inside one transaction would race on that lot's balance and produce a
    // wrong total.
    for (const line of lines) {
      applied.push(await applyMovement(tx, { ...shared, ...line }, actor, date));
    }

    return applied;
  });

  await recordAudit({
    actorId: actor.id,
    action: auditActionFor(input.direction),
    entityType: 'StockMovement',
    entityId: results[0]?.movement.id,
    after: {
      bulk: true,
      direction: input.direction,
      lineCount: lines.length,
      movementIds: results.map((result) => result.movement.id),
    },
    req: context.req,
  });

  return results;
}

/**
 * THE CORE OPERATION — must only ever be called inside a transaction.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {object} input
 * @param {object} actor
 * @param {Date}   movementDate
 */
async function applyMovement(tx, input, actor, movementDate) {
  const item = await tx.item.findUnique({
    where: { id: input.itemId },
    select: {
      id: true,
      nameEn: true,
      isActive: true,
      trackSize: true,
      trackExpiry: true,
      sizes: true,
    },
  });

  if (!item) throw ApiError.badRequest(`Item ${input.itemId} does not exist`);
  if (!item.isActive) throw ApiError.badRequest(`"${item.nameEn}" is deactivated`);

  // --- Normalise the lot key against the item's own flags -------------------
  // Everything not tracked becomes null, so an item that ignores sizes can only
  // ever have ONE lot. Without this, a stray `size: ""` from the UI would
  // create a second, invisible balance line for the same physical stock.
  const size = item.trackSize ? (input.size ?? null) : null;
  const batchNumber = item.trackExpiry ? (input.batchNumber ?? null) : null;
  const expiryDate = item.trackExpiry ? (input.expiryDate ?? null) : null;

  if (item.trackSize && !size) {
    throw ApiError.badRequest(`"${item.nameEn}" is tracked by size — please choose a size`, {
      code: 'SIZE_REQUIRED',
    });
  }

  if (size && item.sizes.length > 0 && !item.sizes.includes(size)) {
    throw ApiError.badRequest(
      `"${size}" is not a valid size for "${item.nameEn}". Valid sizes: ${item.sizes.join(', ')}`,
      { code: 'INVALID_SIZE' },
    );
  }

  // Receiving stock for an expiry-tracked item without an expiry date defeats
  // the whole point of the flag. Not enforced on OUT: we must still be able to
  // issue historical stock recorded before the flag was switched on.
  if (item.trackExpiry && input.direction === 'IN' && !expiryDate) {
    throw ApiError.badRequest(`"${item.nameEn}" is tracked by expiry — please enter the expiry date`, {
      code: 'EXPIRY_REQUIRED',
    });
  }

  // --- Resolve the locations -------------------------------------------------
  // IN       : arrives at `toLocation`   (from outside the station)
  // OUT      : leaves `fromLocation`     (consumed, or out of the station)
  // TRANSFER : both — cabinet to vehicle, store to cabinet
  // ADJUST   : one location, signed
  const { fromLocationId, toLocationId } = await resolveLocations(tx, input);

  /**
   * Moves one lot's balance and writes the ledger row for it.
   *
   * A TRANSFER calls this TWICE — once negative at the source, once positive at
   * the target — rather than writing a single row touching two lots.
   *
   * That matters for the invariant the whole engine rests on:
   *
   *     lot.quantityOnHand === SUM of that lot's movements
   *
   * With one row per transfer, the destination lot's balance would change with
   * no ledger row of its own, and that sum would no longer reconcile. Two rows
   * keep every lot's history self-explaining, and both carry the same
   * from/to pair so the pair is still recognisable as one physical move.
   */
  async function moveLot({ locationId, delta, signedQuantity }) {
    const lotKey = { itemId: item.id, locationId, size, batchNumber, expiryDate };

    let lot = await tx.stockLot.findFirst({ where: lotKey });

    if (!lot) {
      if (delta < 0) {
        const where = await tx.storageLocation.findUnique({
          where: { id: locationId },
          select: { nameEn: true },
        });

        throw ApiError.badRequest(
          `No stock of "${item.nameEn}"${size ? ` (${size})` : ''} in ${where?.nameEn ?? 'that location'}`,
          { code: 'NO_STOCK' },
        );
      }

      lot = await tx.stockLot.create({ data: { ...lotKey, quantityOnHand: 0 } });
    }

    const balanceAfter = lot.quantityOnHand + delta;

    if (balanceAfter < 0) {
      const where = await tx.storageLocation.findUnique({
        where: { id: locationId },
        select: { nameEn: true },
      });

      throw ApiError.conflict(
        `Not enough stock: "${item.nameEn}"${size ? ` (${size})` : ''} in ` +
          `${where?.nameEn ?? 'that location'} has ${lot.quantityOnHand}, ` +
          `you tried to take ${Math.abs(delta)}.`,
        {
          code: 'INSUFFICIENT_STOCK',
          details: { available: lot.quantityOnHand, locationId },
        },
      );
    }

    const [updatedLot, movement] = await Promise.all([
      tx.stockLot.update({ where: { id: lot.id }, data: { quantityOnHand: balanceAfter } }),
      tx.stockMovement.create({
        data: {
          itemId: item.id,
          lotId: lot.id,
          direction: input.direction,
          // IN/OUT are stored positive and take their sign from `direction`.
          // TRANSFER and ADJUST are stored SIGNED, because a single direction
          // value cannot say which side of a transfer a row represents.
          quantity: signedQuantity,
          movementDate,
          fromLocationId,
          toLocationId,
          issuedToUserId: input.issuedToUserId ?? null,
          counterparty: input.counterparty ?? null,
          teamId: input.teamId ?? null,
          vehicleId: input.vehicleId ?? null,
          reason: input.reason ?? null,
          note: input.note ?? null,
          documentRef: input.documentRef ?? null,
          restockLineId: input.restockLineId ?? null,
          balanceAfter,
          recordedById: actor.id,
        },
      }),
    ]);

    return { movement, lot: updatedLot };
  }

  // --- Apply ------------------------------------------------------------------
  if (input.direction === 'TRANSFER') {
    // Source first: if there is not enough, the transaction aborts before any
    // stock is invented at the destination.
    const out = await moveLot({
      locationId: fromLocationId,
      delta: -input.quantity,
      signedQuantity: -input.quantity,
    });

    const into = await moveLot({
      locationId: toLocationId,
      delta: input.quantity,
      signedQuantity: input.quantity,
    });

    return { movement: out.movement, counterMovement: into.movement, lot: out.lot, targetLot: into.lot };
  }

  if (input.direction === 'IN') {
    return moveLot({ locationId: toLocationId, delta: input.quantity, signedQuantity: input.quantity });
  }

  if (input.direction === 'OUT') {
    return moveLot({ locationId: fromLocationId, delta: -input.quantity, signedQuantity: input.quantity });
  }

  // ADJUST — signed, against one location.
  return moveLot({
    locationId: fromLocationId ?? toLocationId,
    delta: input.quantity,
    signedQuantity: input.quantity,
  });
}

/**
 * Works out which locations a movement is between, applying sensible defaults
 * so the common cases need no extra input from the user.
 *
 * Defaults: a receipt lands in the default location (the main store); an issue
 * or an adjustment comes out of it. Only a transfer has to name both sides.
 */
async function resolveLocations(tx, input) {
  const defaultLocation = async () => {
    const location = await tx.storageLocation.findFirst({
      where: { isDefault: true, isActive: true },
      select: { id: true },
    });

    if (!location) {
      throw ApiError.badRequest(
        'No default storage location is configured. Add one under Inventory → Locations.',
        { code: 'NO_DEFAULT_LOCATION' },
      );
    }

    return location.id;
  };

  switch (input.direction) {
    case 'IN':
      return { fromLocationId: null, toLocationId: input.toLocationId ?? (await defaultLocation()) };

    case 'OUT':
      return { fromLocationId: input.fromLocationId ?? (await defaultLocation()), toLocationId: null };

    case 'TRANSFER': {
      if (!input.fromLocationId || !input.toLocationId) {
        throw ApiError.badRequest('A transfer needs both a source and a destination', {
          code: 'TRANSFER_NEEDS_BOTH',
        });
      }

      // Otherwise the two moveLot calls would fight over one lot and the
      // balance would end up unchanged while the ledger claimed otherwise.
      if (input.fromLocationId === input.toLocationId) {
        throw ApiError.badRequest('Source and destination must be different locations', {
          code: 'TRANSFER_SAME_LOCATION',
        });
      }

      return { fromLocationId: input.fromLocationId, toLocationId: input.toLocationId };
    }

    default:
      // ADJUST corrects a balance in one place.
      return {
        fromLocationId: input.fromLocationId ?? input.toLocationId ?? (await defaultLocation()),
        toLocationId: null,
      };
  }
}

/** Maps a direction onto its audit action. */
const auditActionFor = (direction) =>
  ({
    IN: AUDIT_ACTIONS.STOCK_IN,
    OUT: AUDIT_ACTIONS.STOCK_OUT,
    TRANSFER: AUDIT_ACTIONS.STOCK_TRANSFERRED,
    ADJUST: AUDIT_ACTIONS.STOCK_ADJUSTED,
  })[direction];

// =============================================================================
//  REPORTS
// =============================================================================

/**
 * "What expires soon" — the reason `trackExpiry` exists.
 * Includes already-expired lots, which are the urgent ones.
 */
export async function listExpiring({ withinDays, categoryId, page, limit }) {
  const cutoff = addDays(new Date(), withinDays);

  const where = {
    quantityOnHand: { gt: 0 },
    expiryDate: { not: null, lte: cutoff },
    item: { isActive: true, ...(categoryId ? { categoryId } : {}) },
  };

  const result = await paginate(
    prisma.stockLot,
    {
      where,
      include: {
        item: {
          select: {
            id: true,
            nameEn: true,
            nameAr: true,
            unit: true,
            category: { select: { key: true, nameEn: true, nameAr: true } },
          },
        },
      },
      // Soonest first: the top of the list is what to act on today.
      orderBy: { expiryDate: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
    },
    { page, limit },
  );

  const today = startOfToday();

  result.data = result.data.map((lot) => ({
    ...lot,
    // .getTime() rather than subtracting the Dates directly: the implicit
    // valueOf() coercion works but reads as a mistake, and is not type-safe.
    daysUntilExpiry: Math.ceil((lot.expiryDate.getTime() - today.getTime()) / 86_400_000),
    isExpired: lot.expiryDate < today,
  }));

  return result;
}

/** Headline numbers for the inventory dashboard card. */
export async function getStockSummary(categoryId) {
  const itemWhere = { isActive: true, ...(categoryId ? { categoryId } : {}) };
  const today = startOfToday();

  const [totalItems, lots, expiredCount, expiringSoonCount] = await prisma.$transaction([
    prisma.item.count({ where: itemWhere }),
    prisma.stockLot.findMany({
      where: { quantityOnHand: { gt: 0 }, item: itemWhere },
      select: { itemId: true, quantityOnHand: true },
    }),
    prisma.stockLot.count({
      where: { quantityOnHand: { gt: 0 }, expiryDate: { lt: today }, item: itemWhere },
    }),
    prisma.stockLot.count({
      where: {
        quantityOnHand: { gt: 0 },
        expiryDate: { gte: today, lte: addDays(today, 30) },
        item: itemWhere,
      },
    }),
  ]);

  return {
    totalItems,
    itemsWithStock: new Set(lots.map((lot) => lot.itemId)).size,
    totalUnits: lots.reduce((sum, lot) => sum + lot.quantityOnHand, 0),
    expiredLots: expiredCount,
    expiringSoonLots: expiringSoonCount,
  };
}

// =============================================================================
//  DATE HELPERS
// =============================================================================
//  All dates in this module are UTC midnight, matching the `@db.Date` columns.
//  Mixing local-midnight and UTC-midnight dates is how off-by-one-day bugs get
//  into inventory systems, so both helpers below work exclusively in UTC.
// =============================================================================

function startOfToday() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function addDays(date, days) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth(), result.getUTCDate()),
  );
}
