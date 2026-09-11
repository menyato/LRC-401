/**
 * =============================================================================
 *  Expiring soon
 * =============================================================================
 *  Every batch with stock on the shelf that expires within the chosen window,
 *  soonest first — so the top of the list is what to pull today.
 *
 *  Already-expired batches are INCLUDED and shown in red. They are the urgent
 *  ones: expired stock still physically sitting in a vehicle is worse than
 *  stock that is merely about to expire, because a crew may reach for it.
 * =============================================================================
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';

import { usePaginatedQuery } from '@/hooks/usePaginatedQuery';
import { useLocalised } from '@/hooks/useLocalised';
import { PageHeader } from '@/components/PageHeader';
import { DataTable } from '@/components/DataTable';
import { StatusBadge } from '@/components/StatusBadge';

/** Windows the station actually plans around. */
const WINDOWS = [30, 60, 90, 180];

export default function ExpiringPage() {
  const { t } = useTranslation();
  const L = useLocalised();
  const [withinDays, setWithinDays] = useState(60);

  const list = usePaginatedQuery({
    key: 'expiring',
    url: '/inventory/expiring',
    filters: { withinDays },
  });

  const columns = [
    {
      key: 'item',
      header: t('inventory.item'),
      primary: true,
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{L(row.item)}</p>
          <p className="text-xs text-stone-400">{L(row.item.category)}</p>
        </div>
      ),
    },
    {
      key: 'batchNumber',
      header: t('inventory.batch'),
      render: (row) => row.batchNumber ?? <span className="text-stone-300">—</span>,
    },
    {
      key: 'quantityOnHand',
      header: t('inventory.onHand'),
      align: 'end',
      render: (row) => (
        <span className="tabular-nums">
          {row.quantityOnHand}
          <span className="ms-1 text-xs text-stone-400">{row.item.unit}</span>
        </span>
      ),
    },
    {
      key: 'expiryDate',
      header: t('inventory.expiryDate'),
      render: (row) => (
        <span className="tabular-nums">{dayjs(row.expiryDate).format('D MMM YYYY')}</span>
      ),
    },
    {
      key: 'daysUntilExpiry',
      header: '',
      align: 'end',
      render: (row) =>
        row.isExpired ? (
          <StatusBadge
            status="CRITICAL"
            label={t('inventory.expiredAgo', { days: Math.abs(row.daysUntilExpiry) })}
          />
        ) : (
          <StatusBadge
            // Under 30 days is a warning; beyond that it is simply scheduled.
            status={row.daysUntilExpiry <= 30 ? 'WARN' : 'OK'}
            label={t('inventory.expiresIn', { days: row.daysUntilExpiry })}
          />
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t('inventory.expiringTitle')}
        description={t('inventory.withinDays', { days: withinDays })}
      />

      <div className="card">
        <div className="card-header">
          <div
            className="inline-flex rounded-lg border border-surface-border bg-white p-0.5"
            role="group"
            aria-label={t('inventory.withinDays', { days: withinDays })}
          >
            {WINDOWS.map((days) => (
              <button
                key={days}
                type="button"
                onClick={() => setWithinDays(days)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                  withinDays === days
                    ? 'bg-brand-600 text-white'
                    : 'text-stone-600 hover:bg-stone-100'
                }`}
                aria-pressed={withinDays === days}
              >
                {days}d
              </button>
            ))}
          </div>
        </div>

        <DataTable
          columns={columns}
          rows={list.rows}
          meta={list.meta}
          isLoading={list.isLoading}
          error={list.error}
          onPageChange={list.setPage}
          emptyMessage={t('common.noResults')}
        />
      </div>
    </div>
  );
}
