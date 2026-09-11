/**
 * =============================================================================
 *  Inventory — request schemas
 * =============================================================================
 *  These cover BOTH clothing and medical equipment. There is no separate
 *  "clothing" schema: the difference is entirely in an item's flags
 *  (`trackSize`, `trackExpiry`) and its category, exactly as described in
 *  docs/02-DOMAIN-MODEL.md.
 * =============================================================================
 */

import { z } from 'zod';
import { paginationQuery, sortQuery } from '../../utils/pagination.js';
import { queryBoolean } from '../../utils/crudRouter.js';

/**
 * A calendar date with no time component.
 *
 * We accept "YYYY-MM-DD" and build the Date at UTC midnight. Doing
 * `new Date("2026-09-14")` in a browser in Beirut and sending the ISO string
 * would arrive as 2026-09-13T21:00:00Z and silently record the movement on the
 * WRONG DAY. Parsing the parts explicitly removes the time zone from the
 * question entirely.
 */
export const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
  .transform((value) => {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  });

// =============================================================================
//  CATEGORIES  &  DYNAMIC ATTRIBUTES
// =============================================================================

export const createCategorySchema = z.object({
  key: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9_]+$/, 'Use lowercase letters, numbers and underscores only'),
  nameEn: z.string().trim().min(2).max(80),
  nameAr: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).nullish(),
  /** lucide-react icon name rendered by the frontend. */
  icon: z.string().trim().max(40).nullish(),
});

export const updateCategorySchema = createCategorySchema
  .partial()
  .omit({ key: true })
  .extend({ isActive: z.boolean().optional() });

/**
 * A super-admin-defined extra field on every item in a category.
 * This is the "super admin can change the fields / tracked section" feature.
 */
export const attributeDefSchema = z
  .object({
    key: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .regex(/^[a-z0-9_]+$/, 'Use lowercase letters, numbers and underscores only'),
    labelEn: z.string().trim().min(1).max(80),
    labelAr: z.string().trim().min(1).max(80),
    type: z.enum(['TEXT', 'NUMBER', 'SELECT', 'BOOLEAN', 'DATE']).default('TEXT'),
    options: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
    isRequired: z.boolean().default(false),
    /** Show as a column in the item table. */
    showInList: z.boolean().default(false),
    sortOrder: z.number().int().min(0).max(999).default(0),
  })
  // A SELECT with no options renders as an empty dropdown the user cannot use.
  .refine((data) => data.type !== 'SELECT' || data.options.length > 0, {
    path: ['options'],
    message: 'A choice field needs at least one option',
  });

// =============================================================================
//  ITEMS
// =============================================================================

export const listItemsQuery = paginationQuery
  .extend({
    categoryId: z.string().cuid().optional(),
    categoryKey: z.string().optional(),
    includeInactive: queryBoolean,
    /** Only items whose total stock is at or below their low-stock threshold. */
    lowStockOnly: queryBoolean,
    /** Only items that track expiry and have a batch expiring soon. */
    expiringOnly: queryBoolean,
    trackExpiry: queryBoolean,
  })
  .merge(sortQuery(['nameEn', 'createdAt', 'updatedAt'], 'nameEn'));

export const createItemSchema = z
  .object({
    categoryId: z.string().cuid(),
    sku: z.string().trim().max(60).nullish(),
    nameEn: z.string().trim().min(1, 'Item name is required').max(160),
    nameAr: z.string().trim().max(160).nullish(),
    unit: z.string().trim().min(1).max(30).default('piece'),

    /** Your spreadsheet's `Track Expiry? YES/NO` column. */
    trackExpiry: z.boolean().default(false),
    /** Clothing: keep separate balances per size. */
    trackSize: z.boolean().default(false),
    /**
     * Custom sizes, free text so both "S/M/L/XL" and "40/42/44" work — you
     * asked for sizes to be custom, so this is not an enum.
     */
    sizes: z.array(z.string().trim().min(1).max(20)).max(40).default([]),

    lowStockThreshold: z.number().int().min(0).max(100000).default(0),
    /** Warn this many days before a batch expires. */
    expiryWarningDays: z.number().int().min(1).max(365).default(30),

    /** Values for the category's ItemAttributeDef rows. */
    attributes: z.record(z.unknown()).default({}),
    notes: z.string().trim().max(1000).nullish(),
  })
  // An item that tracks size but lists none produces stock lines nobody can
  // select — caught here rather than confusing a storekeeper later.
  .refine((data) => !data.trackSize || data.sizes.length > 0, {
    path: ['sizes'],
    message: 'Add at least one size, or turn off size tracking',
  });

export const updateItemSchema = createItemSchema
  .innerType() // unwrap the .refine() so .partial() is available
  .partial()
  .extend({ isActive: z.boolean().optional() });

// =============================================================================
//  STOCK MOVEMENTS
// =============================================================================

export const listMovementsQuery = paginationQuery
  .extend({
    itemId: z.string().cuid().optional(),
    categoryId: z.string().cuid().optional(),
    direction: z.enum(['IN', 'OUT', 'TRANSFER', 'ADJUST']).optional(),
    locationId: z.string().cuid().optional(),
    teamId: z.string().cuid().optional(),
    vehicleId: z.string().cuid().optional(),
    issuedToUserId: z.string().cuid().optional(),
    /** Inclusive date window over `movementDate` (the real-world date). */
    dateFrom: dateOnly.optional(),
    dateTo: dateOnly.optional(),
  })
  .merge(sortQuery(['movementDate', 'createdAt'], 'movementDate'));

/**
 * Recording stock in or out.
 *
 * The lot identity (size / batch / expiry) is part of the movement because that
 * is what determines WHICH balance line changes. The service validates these
 * against the item's flags: sending a size for an item that does not track
 * sizes is rejected rather than quietly creating a stray lot.
 */
export const createMovementSchema = z
  .object({
    itemId: z.string().cuid(),
    direction: z.enum(['IN', 'OUT', 'TRANSFER', 'ADJUST']),

    /**
     * Where the stock moves between. Both optional for IN/OUT/ADJUST — they
     * default to the main store — but a TRANSFER must name both sides.
     */
    fromLocationId: z.string().cuid().nullish(),
    toLocationId: z.string().cuid().nullish(),

    /**
     * IN/OUT: must be positive — direction already carries the sign.
     * ADJUST: may be negative, since a stock count can go either way.
     * The cross-field rule below enforces this.
     */
    quantity: z.number().int().refine((value) => value !== 0, 'Quantity cannot be zero'),

    /** The real-world date, chosen by the user. Defaults to today. */
    movementDate: dateOnly.optional(),

    // --- Lot identity -------------------------------------------------------
    size: z.string().trim().max(20).nullish(),
    batchNumber: z.string().trim().max(60).nullish(),
    expiryDate: dateOnly.nullish(),

    // --- Counterparty -------------------------------------------------------
    issuedToUserId: z.string().cuid().nullish(),
    /** Free text for a supplier, or a person who is not a system user. */
    counterparty: z.string().trim().max(120).nullish(),
    teamId: z.string().cuid().nullish(),
    vehicleId: z.string().cuid().nullish(),

    reason: z.string().trim().max(60).nullish(),
    note: z.string().trim().max(1000).nullish(),
    documentRef: z.string().trim().max(60).nullish(),
  })
  .refine((data) => data.direction === 'ADJUST' || data.quantity > 0, {
    path: ['quantity'],
    message: 'Quantity must be greater than zero for stock in, out and transfers',
  });

/**
 * Issuing several different items in one go — the realistic case when a
 * volunteer collects a full uniform, or a vehicle is restocked after a report
 * shows six shortages.
 *
 * One request, one transaction: either the whole issue is recorded or none of
 * it is. Ten separate requests could half-succeed and leave the store's books
 * wrong with nobody aware.
 */
export const createBulkMovementSchema = z.object({
  movementDate: dateOnly.optional(),
  direction: z.enum(['IN', 'OUT', 'TRANSFER', 'ADJUST']),
  fromLocationId: z.string().cuid().nullish(),
  toLocationId: z.string().cuid().nullish(),
  issuedToUserId: z.string().cuid().nullish(),
  counterparty: z.string().trim().max(120).nullish(),
  teamId: z.string().cuid().nullish(),
  vehicleId: z.string().cuid().nullish(),
  reason: z.string().trim().max(60).nullish(),
  note: z.string().trim().max(1000).nullish(),
  documentRef: z.string().trim().max(60).nullish(),
  lines: z
    .array(
      z.object({
        itemId: z.string().cuid(),
        quantity: z.number().int().refine((value) => value !== 0, 'Quantity cannot be zero'),
        size: z.string().trim().max(20).nullish(),
        batchNumber: z.string().trim().max(60).nullish(),
        expiryDate: dateOnly.nullish(),
      }),
    )
    .min(1, 'Add at least one line')
    // Capped so one request cannot lock a large number of rows in a single
    // transaction and stall everyone else.
    .max(100, 'Split this into batches of 100 lines or fewer'),
});

/** Expiry dashboard: "what expires in the next N days". */
export const expiringQuery = paginationQuery.extend({
  withinDays: z.coerce.number().int().min(1).max(365).default(60),
  categoryId: z.string().cuid().optional(),
});
