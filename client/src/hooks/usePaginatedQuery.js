/**
 * =============================================================================
 *  usePaginatedQuery — list state in one line
 * =============================================================================
 *  Every list screen needs the same five things: a page number, a debounced
 *  search term, extra filters, the fetch, and a reset-to-page-1 whenever a
 *  filter changes.
 *
 *  That last rule is the one everybody forgets: search for something while on
 *  page 4 and, without a reset, you get page 4 of two results — an empty screen
 *  that looks like "no matches".
 *
 *  Usage:
 *      const list = usePaginatedQuery({
 *        key: 'items',
 *        url: '/inventory/items',
 *        filters: { categoryKey },
 *      });
 *
 *      <SearchInput value={list.search} onChange={list.setSearch} />
 *      <DataTable rows={list.rows} meta={list.meta} isLoading={list.isLoading}
 *                 onPageChange={list.setPage} />
 * =============================================================================
 */

import { useState, useEffect, useMemo } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { getPaged } from '@/lib/api';
import { useDebounced } from './useDebounced';

/**
 * @param {object} options
 * @param {string} options.key       Cache key prefix, e.g. 'items'.
 * @param {string} options.url       API path.
 * @param {object} [options.filters] Extra query params. Changing these resets
 *                                   the page.
 * @param {number} [options.limit]
 * @param {boolean}[options.enabled] Skip the request until true.
 */
export function usePaginatedQuery({ key, url, filters = {}, limit = 25, enabled = true }) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  /**
   * Wait 300ms after the last keystroke before querying. Without this, typing
   * "tourniquet" fires ten requests, and on a slow connection they can arrive
   * out of order — showing results for "tourni" after those for "tourniquet".
   */
  const debouncedSearch = useDebounced(search, 300);

  /**
   * Serialise the filters so the effect below compares by VALUE.
   * `filters` is usually an object literal, so it is a new reference on every
   * render and a plain dependency would reset the page continuously.
   */
  const filterKey = JSON.stringify(filters);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, filterKey]);

  const params = useMemo(
    () => ({
      page,
      limit,
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
      // Drop empty filters so the URL stays clean and the cache key stable:
      // `?status=` and no status at all must not be two different cache entries.
      ...Object.fromEntries(
        Object.entries(filters).filter(
          ([, value]) => value !== undefined && value !== null && value !== '',
        ),
      ),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filterKey stands in for filters
    [page, limit, debouncedSearch, filterKey],
  );

  const query = useQuery({
    queryKey: [key, params],
    queryFn: () => getPaged(url, { params }),
    enabled,
    /**
     * Keep showing the previous page while the next one loads. Without it the
     * table empties and the page height collapses on every page change, which
     * on a phone scrolls the user somewhere unexpected.
     */
    placeholderData: keepPreviousData,
  });

  return {
    rows: query.data?.data ?? [],
    meta: query.data?.meta,
    isLoading: query.isLoading,
    // True while a background refetch runs — for a subtle indicator, distinct
    // from the initial skeleton.
    isFetching: query.isFetching,
    error: query.error,
    refetch: query.refetch,

    page,
    setPage,
    search,
    setSearch,

    /** The exact key this list used — pass to invalidateQueries after a write. */
    queryKey: [key, params],
  };
}

export default usePaginatedQuery;
