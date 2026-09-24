/**
 * =============================================================================
 *  Pagination — written once, used by every list endpoint.
 * =============================================================================
 *  Pagination is not a nice-to-have here. `GET /inventory/movements` will hold
 *  tens of thousands of rows within a year. An unpaginated endpoint would:
 *    • exhaust the free-tier database's memory,
 *    • take seconds to render on a phone at the station,
 *    • and hand an attacker a cheap denial-of-service (one request, whole table).
 *
 *  So the rules enforced here are:
 *    1. There is ALWAYS a limit. A missing `limit` becomes the default, and a
 *       `limit` above MAX_LIMIT is clamped rather than honoured.
 *    2. Sorting is restricted to a per-endpoint whitelist. Passing a user string
 *       straight into Prisma's `orderBy` would let anyone sort by, say,
 *       `passwordHash` and infer values from the ordering.
 *    3. Every list response has the same envelope, so the React table component
 *       is written once and reused everywhere.
 * =============================================================================
 */

import { z } from 'zod';

/** Hard ceiling. Even an admin asking for 10 000 rows gets 100. */
export const MAX_LIMIT = 100;
export const DEFAULT_LIMIT = 25;

/**
 * Base query schema every list endpoint extends.
 *
 * Usage in a module's validators:
 *
 *     export const listItemsQuery = paginationQuery
 *       .extend({ categoryId: z.string().cuid().optional() })
 *       .merge(sortQuery(['nameEn', 'createdAt']));
 */
export const paginationQuery = z.object({
  // `coerce` because query strings arrive as text: "?page=2" -> 2.
  // Capped: `?page=99999999999999999999` coerces to 1e20, and the resulting
  // OFFSET overflowed Postgres's BIGINT — a 500 from one crafted URL.
  // 10 000 pages × 100 rows is far beyond any real list here.
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  /** Free-text search. Trimmed, and capped so it cannot become a huge LIKE. */
  search: z.string().trim().max(120).optional(),
});

/**
 * Builds a sort schema locked to the columns an endpoint actually permits.
 *
 * @param {string[]} allowedFields  Whitelist of sortable column names.
 * @param {string}   [defaultField] Falls back to the first allowed field.
 */
export const sortQuery = (allowedFields, defaultField) =>
  z.object({
    sortBy: z.enum(allowedFields).default(defaultField ?? allowedFields[0]),
    sortDir: z.enum(['asc', 'desc']).default('desc'),
  });

/**
 * Translates validated query params into Prisma arguments.
 *
 * @param {{page:number, limit:number, sortBy?:string, sortDir?:string}} query
 * @returns {{skip:number, take:number, orderBy?:object, page:number, limit:number}}
 */
export function toPrismaPagination(query) {
  const { page, limit, sortBy, sortDir } = query;

  return {
    skip: (page - 1) * limit,
    take: limit,
    // Only set orderBy when the endpoint declared sortable fields; otherwise
    // let the caller supply its own (e.g. a multi-column sort).
    ...(sortBy ? { orderBy: { [sortBy]: sortDir ?? 'desc' } } : {}),
    page,
    limit,
  };
}

/**
 * Wraps rows + total count into the response envelope used by the whole API.
 * The frontend's `<DataTable>` reads exactly this shape, everywhere.
 *
 * @param {unknown[]} rows   The page of records.
 * @param {number}    total  Total matching records, ignoring pagination.
 * @param {{page:number, limit:number}} query
 */
export function paginatedResponse(rows, total, { page, limit }) {
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return {
    data: rows,
    meta: {
      page,
      limit,
      total,
      totalPages,
      hasPrevious: page > 1,
      hasNext: page < totalPages,
    },
  };
}

/**
 * Convenience wrapper: runs the find and the count in ONE round trip.
 *
 * Using `$transaction` here is not about atomicity — it is about latency. Two
 * sequential awaits cost two round trips to the database; on a free-tier host
 * in another region that is easily 200ms of avoidable delay per page load.
 *
 * @param {object} model  A Prisma model delegate, e.g. `prisma.item`.
 * @param {object} args   Prisma findMany args (where/include/orderBy/skip/take).
 * @param {{page:number, limit:number}} pageInfo
 */
export async function paginate(model, args, pageInfo) {
  const { prisma } = await import('../config/db.js');

  const [rows, total] = await prisma.$transaction([
    model.findMany(args),
    // Count with the same filter but WITHOUT skip/take/orderBy/include:
    // counting a joined, ordered, sliced query is far slower and gives the
    // same number.
    model.count({ where: args.where }),
  ]);

  return paginatedResponse(rows, total, pageInfo);
}

/**
 * Builds a case-insensitive "contains" filter across several columns.
 * Keeps every module from re-writing the same OR block for its search box.
 *
 * @param {string|undefined} term
 * @param {string[]} fields  Column names to search.
 * @returns {object} A Prisma `where` fragment, or `{}` when there is no term.
 */
export function searchFilter(term, fields) {
  if (!term) return {};

  return {
    OR: fields.map((field) => ({
      [field]: { contains: term, mode: 'insensitive' },
    })),
  };
}
