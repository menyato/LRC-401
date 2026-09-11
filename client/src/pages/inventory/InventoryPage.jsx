/**
 * =============================================================================
 *  Inventory — the item list
 * =============================================================================
 *  ONE page serves both stores. `/inventory/clothing` and
 *  `/inventory/medical_equipment` render this same component; the `:category`
 *  route param selects the catalogue.
 *
 *  That is the payoff of the single inventory engine described in
 *  docs/02-DOMAIN-MODEL.md: adding a third category (vehicle spares, say) needs
 *  no new page, no new route and no new code — the super admin creates it from
 *  the dashboard and it appears here.
 * =============================================================================
 */

import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus, ArrowLeftRight, AlertTriangle } from 'lucide-react';

import { get } from '@/lib/api';
import { usePaginatedQuery } from '@/hooks/usePaginatedQuery';
import { useAuth } from '@/features/auth/AuthProvider';
import { useLocalised } from '@/hooks/useLocalised';
import { PageHeader } from '@/components/PageHeader';
import { DataTable, SearchInput } from '@/components/DataTable';
import { FullPageSpinner } from '@/components/Spinner';
import { ItemFormModal } from '@/features/inventory/ItemFormModal';
import { MovementModal } from '@/features/inventory/MovementModal';

export default function InventoryPage() {
  const { category: categoryKey } = useParams();
  const { t } = useTranslation();
  const L = useLocalised();
  const { can } = useAuth();

  const [editingItem, setEditingItem] = useState(null);
  const [isItemFormOpen, setIsItemFormOpen] = useState(false);
  const [movementItem, setMovementItem] = useState(null);
  const [lowStockOnly, setLowStockOnly] = useState(false);

  const { data: categories = [], isLoading: isCategoryLoading } = useQuery({
    queryKey: ['item-categories'],
    queryFn: () => get('/inventory/categories'),
  });

  const category = categories.find((entry) => entry.key === categoryKey);

  const list = usePaginatedQuery({
    key: 'items',
    url: '/inventory/items',
    filters: {
      categoryKey,
      lowStockOnly: lowStockOnly ? 'true' : undefined,
    },
    // Wait for the category list so the page does not flash an empty table.
    enabled: Boolean(categoryKey),
  });

  if (isCategoryLoading) return <FullPageSpinner />;

  if (!category) {
    return (
      <div className="card p-6 text-center text-sm text-stone-500">
        {t('errors.notFound')}
      </div>
    );
  }

  const columns = [
    {
      key: 'name',
      header: t('inventory.item'),
      primary: true,
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-stone-900">{L(row)}</p>
          {row.sku && <p className="text-xs text-stone-400">{row.sku}</p>}
        </div>
      ),
    },
    {
      key: 'totalOnHand',
      header: t('inventory.onHand'),
      align: 'end',
      render: (row) => (
        <span
          className={`tabular-nums ${
            row.isLowStock ? 'font-semibold text-status-critical' : 'text-stone-800'
          }`}
        >
          {row.totalOnHand}
          <span className="ms-1 text-xs font-normal text-stone-400">{row.unit}</span>
        </span>
      ),
    },
    {
      key: 'breakdown',
      header: t('inventory.size'),
      hideOnMobile: true,
      render: (row) => {
        // Only meaningful for items that split their stock. For everything else
        // the single total above already says it all.
        if (!row.trackSize && !row.trackExpiry) return <span className="text-stone-300">—</span>;

        return (
          <div className="flex flex-wrap gap-1">
            {row.lots.slice(0, 4).map((lot) => (
              <span
                key={lot.id}
                className="rounded bg-stone-100 px-1.5 py-0.5 text-xs tabular-nums text-stone-600"
              >
                {[lot.size, lot.batchNumber].filter(Boolean).join(' ') || '·'} {lot.quantityOnHand}
              </span>
            ))}
            {row.lots.length > 4 && (
              <span className="text-xs text-stone-400">+{row.lots.length - 4}</span>
            )}
          </div>
        );
      },
    },
    {
      key: 'flags',
      header: '',
      render: (row) => (
        <div className="flex items-center gap-1.5">
          {row.expiredLots?.length > 0 && (
            <span className="badge-critical" title="Expired batches on the shelf">
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              {row.expiredLots.length}
            </span>
          )}
          {row.expiringLots?.length > 0 && row.expiredLots?.length === 0 && (
            <span className="badge-warn" title="Expiring soon">
              {row.expiringLots.length}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'actions',
      header: t('common.actions'),
      align: 'end',
      render: (row) => (
        <div className="flex justify-end gap-1">
          {can('inventory.movement:create') && (
            <button
              type="button"
              className="btn-ghost btn-sm"
              // stopPropagation so clicking the button does not also fire the
              // row's own click handler and open the edit form behind it.
              onClick={(event) => {
                event.stopPropagation();
                setMovementItem(row);
              }}
              title={t('inventory.recordMovement')}
            >
              <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
          {can('inventory.item:update') && (
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={(event) => {
                event.stopPropagation();
                setEditingItem(row);
                setIsItemFormOpen(true);
              }}
              title={t('common.edit')}
            >
              {t('common.edit')}
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title={L(category)} description={category.description}>
        {can('inventory.movement:read') && (
          <Link to={`/inventory/${categoryKey}/movements`} className="btn-secondary">
            <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
            {t('inventory.movements')}
          </Link>
        )}

        {can('inventory.item:create') && (
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              setEditingItem(null);
              setIsItemFormOpen(true);
            }}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t('inventory.newItem')}
          </button>
        )}
      </PageHeader>

      <div className="card">
        <div className="card-header flex-wrap gap-2">
          <SearchInput value={list.search} onChange={list.setSearch} />

          <label className="flex items-center gap-2 text-sm text-stone-600">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-surface-border text-brand-600"
              checked={lowStockOnly}
              onChange={(event) => setLowStockOnly(event.target.checked)}
            />
            {t('inventory.lowStock')}
          </label>
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

      <ItemFormModal
        isOpen={isItemFormOpen}
        onClose={() => setIsItemFormOpen(false)}
        category={category}
        item={editingItem}
      />

      <MovementModal
        isOpen={Boolean(movementItem)}
        onClose={() => setMovementItem(null)}
        item={movementItem}
      />
    </div>
  );
}
