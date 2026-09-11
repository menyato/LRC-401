/**
 * =============================================================================
 *  Activity log
 * =============================================================================
 *  Read-only by construction — there is no write endpoint on the server, so
 *  there is nothing to build here beyond a filterable list. That is the point:
 *  a log that can be edited is not evidence of anything.
 * =============================================================================
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';

import { get } from '@/lib/api';
import { usePaginatedQuery } from '@/hooks/usePaginatedQuery';
import { PageHeader } from '@/components/PageHeader';
import { DataTable } from '@/components/DataTable';

export default function ActivityPage() {
  const { t } = useTranslation();

  const [action, setAction] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  /** The catalogue comes from the server so the filter can never go stale. */
  const { data: actions = [] } = useQuery({
    queryKey: ['audit-actions'],
    queryFn: () => get('/audit/actions'),
  });

  /**
   * Prefixes let the admin filter a whole area ("everything inventory") rather
   * than picking one action at a time. The API matches with `startsWith`.
   */
  const prefixes = [...new Set(actions.map((entry) => entry.split('.')[0]))];

  const list = usePaginatedQuery({
    key: 'audit',
    url: '/audit',
    filters: { action, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined },
  });

  const columns = [
    {
      key: 'createdAt',
      header: t('activity.when'),
      primary: true,
      render: (row) => (
        <span className="tabular-nums">{dayjs(row.createdAt).format('D MMM YYYY HH:mm')}</span>
      ),
    },
    {
      key: 'actor',
      header: t('activity.who'),
      render: (row) =>
        row.actor?.fullName ?? <span className="text-stone-400">(anonymous)</span>,
    },
    {
      key: 'action',
      header: t('activity.action'),
      render: (row) => (
        <code className="rounded bg-stone-100 px-1.5 py-0.5 text-xs">{row.action}</code>
      ),
    },
    {
      key: 'entity',
      header: t('activity.entity'),
      hideOnMobile: true,
      render: (row) => row.entityType ?? <span className="text-stone-300">—</span>,
    },
    {
      key: 'ipAddress',
      header: 'IP',
      hideOnMobile: true,
      render: (row) => (
        <span className="font-mono text-xs text-stone-500">{row.ipAddress ?? '—'}</span>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title={t('activity.title')} />

      <div className="card">
        <div className="card-header flex-wrap gap-2">
          <select
            className="input w-auto"
            value={action}
            onChange={(event) => setAction(event.target.value)}
            aria-label={t('activity.action')}
          >
            <option value="">{t('common.all')}</option>

            <optgroup label="Areas">
              {prefixes.map((prefix) => (
                <option key={prefix} value={prefix}>
                  {prefix}
                </option>
              ))}
            </optgroup>

            <optgroup label="Actions">
              {actions.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </optgroup>
          </select>

          <input
            type="date"
            className="input w-auto"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
            aria-label="From"
          />
          <input
            type="date"
            className="input w-auto"
            value={dateTo}
            onChange={(event) => setDateTo(event.target.value)}
            aria-label="To"
          />
        </div>

        <DataTable
          columns={columns}
          rows={list.rows}
          meta={list.meta}
          isLoading={list.isLoading}
          error={list.error}
          onPageChange={list.setPage}
        />
      </div>
    </div>
  );
}
