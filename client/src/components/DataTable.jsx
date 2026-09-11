/**
 * =============================================================================
 *  DataTable — one component for every list in the application
 * =============================================================================
 *  Users, items, stock movements, reports, assignments and the activity log are
 *  all "a paginated, searchable table with loading, empty and error states".
 *  Writing that seven times would be ~700 lines of near-identical JSX and seven
 *  chances to forget the empty state or the mobile layout.
 *
 *  RESPONSIVE STRATEGY — this is the important part:
 *  A table cannot usefully shrink to a phone screen. So below `sm` we do not
 *  render a table at all: each row becomes a CARD built from the same column
 *  definitions. One set of columns, two presentations, no duplicated markup.
 *
 *  Columns marked `primary` become the card's title; `hideOnMobile` columns are
 *  dropped from the card entirely.
 *
 *  Usage:
 *      <DataTable
 *        columns={[
 *          { key: 'nameEn', header: t('inventory.item'), primary: true },
 *          { key: 'totalOnHand', header: t('inventory.onHand'),
 *            render: (row) => <strong>{row.totalOnHand}</strong> },
 *        ]}
 *        rows={data}
 *        meta={meta}
 *        onPageChange={setPage}
 *      />
 * =============================================================================
 */

import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Inbox, AlertCircle, Search } from 'lucide-react';
import { TableSkeleton } from './Spinner';

/**
 * @param {object} props
 * @param {Array<{key:string, header:string, render?:Function, primary?:boolean,
 *                hideOnMobile?:boolean, align?:'start'|'end'|'center'}>} props.columns
 * @param {Array<object>}  props.rows
 * @param {boolean}       [props.isLoading]
 * @param {Error}         [props.error]
 * @param {object}        [props.meta]          Pagination envelope from the API.
 * @param {Function}      [props.onPageChange]
 * @param {Function}      [props.onRowClick]
 * @param {string}        [props.emptyMessage]
 * @param {Function}      [props.rowKey]        Defaults to `row.id`.
 */
export function DataTable({
  columns,
  rows = [],
  isLoading = false,
  error = null,
  meta,
  onPageChange,
  onRowClick,
  emptyMessage,
  rowKey = (row) => row.id,
}) {
  const { t } = useTranslation();

  /** Reads a cell: a custom `render`, otherwise the raw property. */
  const cellValue = (row, column) => (column.render ? column.render(row) : row[column.key]);

  // --- Error --------------------------------------------------------------
  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 p-10 text-center">
        <AlertCircle className="h-8 w-8 text-status-critical" aria-hidden="true" />
        <p className="text-sm text-stone-600">{error.message ?? t('errors.generic')}</p>
      </div>
    );
  }

  // --- Loading ------------------------------------------------------------
  if (isLoading) {
    return <TableSkeleton rows={6} columns={columns.length} />;
  }

  // --- Empty --------------------------------------------------------------
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 p-10 text-center">
        <Inbox className="h-8 w-8 text-stone-300" aria-hidden="true" />
        <p className="text-sm text-stone-500">{emptyMessage ?? t('common.noResults')}</p>
      </div>
    );
  }

  const alignment = { start: 'text-start', end: 'text-end', center: 'text-center' };

  return (
    <div>
      {/* ================= DESKTOP: a real table ================= */}
      <div className="table-wrap hidden sm:block">
        <table className="table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} className={alignment[column.align ?? 'start']}>
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={onRowClick ? 'cursor-pointer' : undefined}
              >
                {columns.map((column) => (
                  <td key={column.key} className={alignment[column.align ?? 'start']}>
                    {cellValue(row, column)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ================= MOBILE: the same columns, as cards ================= */}
      <ul className="divide-y divide-surface-border sm:hidden">
        {rows.map((row) => {
          const primary = columns.find((column) => column.primary) ?? columns[0];
          const details = columns.filter(
            (column) => column !== primary && !column.hideOnMobile,
          );

          return (
            <li key={rowKey(row)}>
              {/*
                A real <button> when the row is clickable, so it is reachable by
                keyboard and announced correctly — a clickable <div> is not.
              */}
              <Component
                as={onRowClick ? 'button' : 'div'}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className="w-full px-4 py-3 text-start"
              >
                <div className="mb-1 font-medium text-stone-900">{cellValue(row, primary)}</div>

                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  {details.map((column) => (
                    <div key={column.key} className="flex items-baseline gap-1.5">
                      <dt className="shrink-0 text-stone-500">{column.header}:</dt>
                      <dd className="min-w-0 truncate text-stone-800">{cellValue(row, column)}</dd>
                    </div>
                  ))}
                </dl>
              </Component>
            </li>
          );
        })}
      </ul>

      {meta && onPageChange && <Pagination meta={meta} onPageChange={onPageChange} />}
    </div>
  );
}

/** Renders `as` with the given props — avoids duplicating the card markup. */
function Component({ as: Tag = 'div', children, ...props }) {
  return <Tag {...props}>{children}</Tag>;
}

/**
 * Pagination controls.
 *
 * Deliberately minimal: previous / next plus a position readout. A numbered
 * page list looks tidy on desktop but the buttons become too small to tap
 * reliably on a phone, and "page 7 of 400" is not information anyone acts on —
 * they filter instead.
 */
export function Pagination({ meta, onPageChange }) {
  const { t } = useTranslation();

  if (!meta || meta.totalPages <= 1) return null;

  const from = (meta.page - 1) * meta.limit + 1;
  const to = Math.min(meta.page * meta.limit, meta.total);

  return (
    <nav
      className="flex items-center justify-between gap-3 border-t border-surface-border px-4 py-3"
      aria-label="Pagination"
    >
      <p className="text-xs text-stone-500">
        {t('common.showing', { from, to, total: meta.total })}
      </p>

      <div className="flex items-center gap-1">
        <button
          type="button"
          className="btn-secondary btn-sm"
          disabled={!meta.hasPrevious}
          onClick={() => onPageChange(meta.page - 1)}
          aria-label="Previous page"
        >
          {/*
            flip-in-rtl mirrors the arrow in Arabic. A chevron is directional:
            in RTL, "previous" points right.
          */}
          <ChevronLeft className="h-4 w-4 flip-in-rtl" aria-hidden="true" />
        </button>

        <span className="px-2 text-xs tabular-nums text-stone-600">
          {meta.page} {t('common.of')} {meta.totalPages}
        </span>

        <button
          type="button"
          className="btn-secondary btn-sm"
          disabled={!meta.hasNext}
          onClick={() => onPageChange(meta.page + 1)}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4 flip-in-rtl" aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}

/**
 * Search box for a table toolbar.
 * Controlled by the caller so the search term can live in the same state as the
 * page number — resetting to page 1 on a new search is then one update, not two
 * that would fire two requests.
 */
export function SearchInput({ value, onChange, placeholder }) {
  const { t } = useTranslation();

  return (
    <div className="relative flex-1 sm:max-w-xs">
      <Search
        className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400"
        aria-hidden="true"
      />
      <input
        type="search"
        className="input ps-9"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder ?? t('common.search')}
        aria-label={t('common.search')}
      />
    </div>
  );
}

export default DataTable;
