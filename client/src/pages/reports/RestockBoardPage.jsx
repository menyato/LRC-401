/**
 * =============================================================================
 *  Restock board — Kanban
 * =============================================================================
 *  Every shortage that somebody decided to act on, as a card moving left to
 *  right until the vehicle is full again.
 *
 *      OPEN ──► PREPARING ──► READY ──► CONFIRMED
 *
 *  Who does what:
 *    the EQUIPMENT OFFICER gathers the items and sets them aside (READY);
 *    the CREW comes, collects them, and confirms they are in the vehicle.
 *    The officer never walks out to the ambulance.
 *
 *  WHY BUTTONS AND NOT DRAG-AND-DROP
 *
 *  The obvious way to build a Kanban is dragging. We deliberately do not:
 *
 *    • This is used on a phone, one-handed, often in a hurry. Dragging a card
 *      between horizontally-scrolling columns on a small screen is fiddly and
 *      easy to get wrong.
 *    • Confirming MOVES REAL STOCK. An accidental drag would silently transfer
 *      items between locations. A button that says "Confirm loaded" and opens a
 *      dialog showing exactly what will move is the honest interface for an
 *      action with consequences.
 *    • Dragging is invisible to keyboard and screen-reader users.
 *
 *  So each card carries the one or two actions that are legal from where it is.
 *  The columns still give the at-a-glance overview a board is for.
 * =============================================================================
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import {
  PackageCheck,
  PackageSearch,
  Truck,
  CheckCircle2,
  AlertTriangle,
  User as UserIcon,
  ArrowRight,
  XCircle,
} from 'lucide-react';

import { get, patch } from '@/lib/api';
import { useAuth } from '@/features/auth/AuthProvider';
import { useLocalised } from '@/hooks/useLocalised';
import { useToast } from '@/components/Toast';
import { PageHeader, StatTile } from '@/components/PageHeader';
import { FullPageSpinner, Spinner } from '@/components/Spinner';
import { Modal } from '@/components/Modal';

/** Column definitions — order here IS the order on screen. */
const COLUMNS = [
  { status: 'OPEN', icon: PackageSearch, tone: 'text-status-critical' },
  { status: 'PREPARING', icon: PackageCheck, tone: 'text-status-warn' },
  // READY is the handover point, and the column the crew watches.
  { status: 'READY', icon: Truck, tone: 'text-brand-600' },
  { status: 'CONFIRMED', icon: CheckCircle2, tone: 'text-status-ok' },
];

const PRIORITY_STYLES = {
  URGENT: 'bg-status-criticalBg text-status-critical',
  HIGH: 'bg-status-warnBg text-status-warn',
  NORMAL: 'bg-stone-100 text-stone-600',
  LOW: 'bg-stone-50 text-stone-400',
};

export default function RestockBoardPage() {
  const { t } = useTranslation();
  const L = useLocalised();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { can } = useAuth();

  /** The card whose delivery is being confirmed, if any. */
  const [deliveringCard, setDeliveringCard] = useState(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['restock-board'],
    queryFn: () => get('/restock/board'),
    // Several people work this board at once, so it must not go stale while
    // somebody is looking at it.
    refetchInterval: 30_000,
  });

  const move = useMutation({
    mutationFn: ({ id, status, lineQuantities }) =>
      patch(`/restock/${id}/status`, { status, lineQuantities }),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['restock-board'] });
      // Stock changed, so anything showing balances is now wrong.
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: ['movements'] });
      setDeliveringCard(null);
      toast.success(t(`restock.moved.${variables.status}`, t('common.save')));
    },
    onError: (mutationError) => toast.error(mutationError.message),
  });

  if (isLoading) return <FullPageSpinner />;

  if (error) {
    return (
      <div className="card p-6 text-center text-sm text-status-critical" role="alert">
        {error.message}
      </div>
    );
  }

  const { columns, totals } = data;

  return (
    <div>
      <PageHeader title={t('restock.title')} description={t('restock.subtitle')} />

      {/* Headline counts. Numbers, not charts — see DashboardPage for why. */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label={t('restock.status.OPEN')}
          value={totals.open}
          icon={PackageSearch}
          tone={totals.open > 0 ? 'critical' : 'default'}
        />
        <StatTile
          label={t('restock.status.PREPARING')}
          value={totals.preparing}
          icon={PackageCheck}
        />
        {/* The number that matters most day to day: waiting for a crew. */}
        <StatTile
          label={t('restock.status.READY')}
          value={totals.ready}
          icon={Truck}
          tone={totals.ready > 0 ? 'warn' : 'default'}
        />
        <StatTile
          label={t('restock.urgent')}
          value={totals.urgent}
          icon={AlertTriangle}
          tone={totals.urgent > 0 ? 'critical' : 'default'}
        />
      </div>

      {/*
        Horizontal scroll on small screens, four columns on a laptop. The
        columns keep a minimum width so a card never squashes to unreadable.
      */}
      <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
        <div className="flex min-w-max gap-3 lg:grid lg:min-w-0 lg:grid-cols-4">
          {COLUMNS.map((column) => {
            const cards = columns.find((c) => c.status === column.status)?.cards ?? [];

            return (
              <section
                key={column.status}
                className="w-72 shrink-0 lg:w-auto"
                aria-labelledby={`col-${column.status}`}
              >
                <header className="mb-2 flex items-center gap-2 px-1">
                  <column.icon className={`h-4 w-4 ${column.tone}`} aria-hidden="true" />
                  <h2
                    id={`col-${column.status}`}
                    className="text-sm font-semibold text-stone-700"
                  >
                    {t(`restock.status.${column.status}`)}
                  </h2>
                  <span className="ms-auto rounded-full bg-stone-100 px-2 py-0.5 text-xs tabular-nums text-stone-600">
                    {cards.length}
                  </span>
                </header>

                <div className="space-y-2 rounded-xl bg-stone-50 p-2">
                  {cards.length === 0 ? (
                    <p className="px-2 py-6 text-center text-xs text-stone-400">
                      {t('common.noResults')}
                    </p>
                  ) : (
                    cards.map((card) => (
                      <RestockCard
                        key={card.id}
                        card={card}
                        L={L}
                        t={t}
                        can={can}
                        isBusy={move.isPending}
                        onMove={(status) => move.mutate({ id: card.id, status })}
                        onDeliver={() => setDeliveringCard(card)}
                      />
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      {deliveringCard && (
        <DeliverModal
          card={deliveringCard}
          onClose={() => setDeliveringCard(null)}
          onConfirm={(lineQuantities) =>
            move.mutate({ id: deliveringCard.id, status: 'CONFIRMED', lineQuantities })
          }
          isBusy={move.isPending}
        />
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
//  One card
// -----------------------------------------------------------------------------
function RestockCard({ card, L, t, can, onMove, onDeliver, isBusy }) {
  const shortfall = card.lines.filter(
    (line) => line.isFulfilled && line.quantityIssued < line.quantityNeeded,
  );

  return (
    <article className="rounded-lg border border-surface-border bg-white p-3 shadow-sm">
      <header className="mb-1.5 flex items-start justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-stone-900">
          <Truck className="h-3.5 w-3.5 shrink-0 text-stone-400" aria-hidden="true" />
          <span className="truncate">
            {card.vehicle.code} · {L(card.vehicle)}
          </span>
        </p>

        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
            PRIORITY_STYLES[card.priority] ?? PRIORITY_STYLES.NORMAL
          }`}
        >
          {t(`priority.${card.priority}`)}
        </span>
      </header>

      <p className="mb-2 text-xs text-stone-500">
        {L(card.team)} · {dayjs(card.shiftDate).format('D MMM')}
      </p>

      {/* The items. Capped — the full list is on the card's own page. */}
      <ul className="mb-2 space-y-0.5">
        {card.lines.slice(0, 4).map((line) => (
          <li key={line.id} className="flex items-baseline justify-between gap-2 text-xs">
            <span className="min-w-0 truncate text-stone-700">
              {L.isArabic && line.labelAr ? line.labelAr : line.label}
              {line.size && <span className="text-stone-400"> · {line.size}</span>}
            </span>
            <span className="shrink-0 tabular-nums text-stone-500">
              {line.isFulfilled ? `${line.quantityIssued}/` : ''}
              {line.quantityNeeded}
            </span>
          </li>
        ))}
        {card.lines.length > 4 && (
          <li className="text-xs text-stone-400">+{card.lines.length - 4} more</li>
        )}
      </ul>

      {/* A short pick is worth surfacing — it means the cabinet needs topping up. */}
      {shortfall.length > 0 && (
        <p className="mb-2 flex items-center gap-1 text-[11px] text-status-warn">
          <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
          {t('restock.partiallyFilled', { count: shortfall.length })}
        </p>
      )}

      {card.assignedTo && (
        <p className="mb-2 flex items-center gap-1 text-[11px] text-stone-500">
          <UserIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
          {card.assignedTo.fullName}
        </p>
      )}

      {/* --- Only the actions that are legal from here --- */}
      <div className="flex flex-wrap gap-1.5">
        {/* --- Equipment officer's steps --- */}
        {card.status === 'OPEN' && can('restock:prepare') && (
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={isBusy}
            onClick={() => onMove('PREPARING')}
          >
            {t('restock.action.startPreparing')}
            <ArrowRight className="h-3 w-3 flip-in-rtl" aria-hidden="true" />
          </button>
        )}

        {card.status === 'PREPARING' && can('restock:prepare') && (
          <button
            type="button"
            className="btn-primary btn-sm"
            disabled={isBusy}
            onClick={() => onMove('READY')}
          >
            <PackageCheck className="h-3.5 w-3.5" aria-hidden="true" />
            {t('restock.action.markReady')}
          </button>
        )}

        {/*
          --- The crew's step ---
          Opens the dialog rather than moving straight away: this is what
          actually transfers stock, and they need to say what they took.
        */}
        {card.status === 'READY' && can('restock:confirm') && (
          <button type="button" className="btn-primary btn-sm" disabled={isBusy} onClick={onDeliver}>
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            {t('restock.action.confirmLoaded')}
          </button>
        )}

        {/* Waiting on the crew — say so, so the officer knows it is not theirs. */}
        {card.status === 'READY' && !can('restock:confirm') && (
          <span className="text-xs text-stone-500">{t('restock.waitingForCrew')}</span>
        )}

        {['OPEN', 'PREPARING', 'READY'].includes(card.status) && can('restock:prepare') && (
          <button
            type="button"
            className="btn-ghost btn-sm text-stone-500"
            disabled={isBusy}
            onClick={() => onMove('CANCELLED')}
          >
            <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}

        {card.submissionId && (
          <Link
            to={`/reports/${card.submissionId}`}
            className="btn-ghost btn-sm ms-auto text-brand-600"
          >
            {t('restock.action.viewReport')}
          </Link>
        )}
      </div>
    </article>
  );
}

// -----------------------------------------------------------------------------
//  Deliver — the one action that moves stock, so it is confirmed explicitly
// -----------------------------------------------------------------------------
function DeliverModal({ card, onClose, onConfirm, isBusy }) {
  const { t } = useTranslation();
  const L = useLocalised();

  /**
   * How many of each line actually went onto the vehicle.
   *
   * Starts at what was asked for, but is EDITABLE, because the cabinet is
   * sometimes short. Recording "we asked for 4 and loaded 2" is more useful
   * than pretending 4 went out — the gap is exactly the signal that the cabinet
   * itself needs replenishing from the main store.
   */
  const [quantities, setQuantities] = useState(() =>
    Object.fromEntries(card.lines.map((line) => [line.id, line.quantityNeeded])),
  );

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={t('restock.confirmTitle', { vehicle: card.vehicle.code })}
      size="md"
    >
      <p className="mb-4 text-sm text-stone-600">
        {t('restock.confirmHelp', {
          from: L(card.sourceLocation),
          to: L(card.targetLocation),
        })}
      </p>

      <ul className="mb-5 divide-y divide-surface-border rounded-lg border border-surface-border">
        {card.lines.map((line) => (
          <li key={line.id} className="flex items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-stone-800">
                {L.isArabic && line.labelAr ? line.labelAr : line.label}
              </p>
              <p className="text-xs text-stone-400">
                {line.item
                  ? `${L(line.item)}${line.size ? ` · ${line.size}` : ''}`
                  : t('restock.noLinkedItem')}
              </p>
            </div>

            <label className="sr-only" htmlFor={`qty-${line.id}`}>
              {t('inventory.quantity')}
            </label>
            <input
              id={`qty-${line.id}`}
              type="number"
              min="0"
              className="input w-20 text-center tabular-nums"
              value={quantities[line.id]}
              onChange={(event) =>
                setQuantities((current) => ({
                  ...current,
                  [line.id]: Math.max(0, Number(event.target.value) || 0),
                }))
              }
            />
          </li>
        ))}
      </ul>

      <p className="mb-4 rounded-lg bg-status-warnBg p-3 text-xs text-status-warn">
        {t('restock.confirmWarning')}
      </p>

      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onClose} disabled={isBusy}>
          {t('common.cancel')}
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={isBusy}
          onClick={() =>
            onConfirm(
              card.lines.map((line) => ({
                lineId: line.id,
                quantityIssued: quantities[line.id] ?? 0,
              })),
            )
          }
        >
          {isBusy ? <Spinner size="sm" /> : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
          {t('restock.action.confirmLoaded')}
        </button>
      </div>
    </Modal>
  );
}
