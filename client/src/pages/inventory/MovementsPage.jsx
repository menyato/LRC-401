/**
 * =============================================================================
 *  Stock in / out log — "the summary log"
 * =============================================================================
 *  The immutable ledger. Rows are never edited or deleted; a mistake is fixed
 *  with a compensating ADJUST entry, which is why this page has no edit action.
 * =============================================================================
 */

import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { ArrowDownToLine, ArrowUpFromLine, Scale } from 'lucide-react';

import { get } from '@/lib/api';
import { usePaginatedQuery } from '@/hooks/usePaginatedQuery';
import { useLocalised } from '@/hooks/useLocalised';
import { PageHeader } from '@/components/PageHeader';
import { DataTable, SearchInput } from '@/components/DataTable';

/** Icon + colour per direction. Never colour alone — the icon carries it too. */
const DIRECTION_META = {
  IN: { icon: ArrowDownToLine, className: 'text-status-ok', sign: '+' },
  OUT: { icon: ArrowUpFromLine, className: 'text-status-warn', sign: '−' },
  ADJUST: { icon: Scale, className: 'text-stone-500', sign: '±' },
};

export default function MovementsPage() {
  const { category: categoryKey } = useParams();
  const { t } = useTranslation();
  const L = useLocalised();

  const [direction, setDirection] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const { data: categories = [] } = useQuery({
    queryKey: ['item-categories'],
    queryFn: () => get('/inventory/categories'),
  });

  const category = categories.find((entry) => entry.key === categoryKey);

  const list = usePaginatedQuery({
    key: 'movements',
    url: '/inventory/movements',
    filters: {
      categoryId: category?.id,
      direction,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    },
    // Hold the request until we know the category id, otherwise the first
    // render would fetch every movement in the station and then discard it.
    enabled: Boolean(category),
  });

  const columns = [
    {
      key: 'movementDate',
      header: t('inventory.movementDate'),
      primary: true,
      render: (row) => (
        <span className="tabular-nums">{dayjs(row.movementDate).format('D MMM YYYY')}</span>
      ),
    },
    {
      key: 'item',
      header: t('inventory.item'),
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate">{L(row.item)}</p>
          {(row.lot?.size || row.lot?.batchNumber) && (
            <p className="text-xs text-stone-400">
              {[row.lot.size, row.lot.batchNumber].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'quantity',
      header: t('inventory.quantity'),
      align: 'end',
      render: (row) => {
        const meta = DIRECTION_META[row.direction];
        const Icon = meta.icon;

        return (
          <span className={`inline-flex items-center gap-1 tabular-nums ${meta.className}`}>
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {meta.sign}
            {Math.abs(row.quantity)}
          </span>
        );
      },
    },
    {
      key: 'balanceAfter',
      header: t('inventory.balanceAfter'),
      align: 'end',
      hideOnMobile: true,
      render: (row) => <span className="tabular-nums text-stone-500">{row.balanceAfter}</span>,
    },
    {
      key: 'counterparty',
      header: t('inventory.counterparty'),
      render: (row) => row.issuedToUser?.fullName ?? row.counterparty ?? '—',
    },
    {
      key: 'recordedBy',
      header: t('inventory.recordedBy'),
      hideOnMobile: true,
      render: (row) => row.recordedBy?.fullName ?? '—',
    },
  ];

  return (
    <div>
      <PageHeader
        title={t('inventory.movements')}
        description={category ? L(category) : undefined}
      />

      <div className="card">
        <div className="card-header flex-wrap gap-2">
          <SearchInput value={list.search} onChange={list.setSearch} />

          <select
            className="input w-auto"
            value={direction}
            onChange={(event) => setDirection(event.target.value)}
            aria-label={t('inventory.direction')}
          >
            <option value="">{t('common.all')}</option>
            <option value="IN">{t('inventory.stockIn')}</option>
            <option value="OUT">{t('inventory.stockOut')}</option>
            <option value="ADJUST">{t('inventory.adjust')}</option>
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
