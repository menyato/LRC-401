/**
 * =============================================================================
 *  Review a report — and send its shortages for restocking
 * =============================================================================
 *  The moment the loop closes.
 *
 *  Reviewing a report used to be a note and a status change: the shortages were
 *  acknowledged and then somebody had to remember them. Here the reviewer ticks
 *  what should actually be put right, and those become a job on the restock
 *  board — which is what eventually moves the stock onto the vehicle.
 *
 *  DESIGN NOTES
 *
 *  • Everything short is PRE-TICKED. The common case is "yes, refill all of it",
 *    and making the reviewer tick fifteen boxes to do the obvious thing is how a
 *    step gets skipped. Unticking is the deliberate act, because deciding NOT to
 *    replace something is the decision worth making consciously.
 *
 *  • Quantities are editable. The suggestion is the gap (expected minus found),
 *    but an officer may want to top a vehicle up further while somebody is
 *    already walking to it.
 *
 *  • "Mark reviewed only" stays available. Not every shortage needs stock —
 *    sometimes the item was simply mislaid and has already turned up.
 * =============================================================================
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { PackageSearch, CheckCircle2 } from 'lucide-react';

import { post } from '@/lib/api';
import { useAuth } from '@/features/auth/AuthProvider';
import { useLocalised } from '@/hooks/useLocalised';
import { useToast } from '@/components/Toast';
import { Modal } from '@/components/Modal';
import { Spinner } from '@/components/Spinner';

/** A stable key for one issue — the pair the API identifies a line by. */
const issueKey = (issue) => `${issue.field}::${issue.row ?? ''}`;

export function ReviewAndRestockModal({ report, isOpen, onClose, onReviewed }) {
  const { t } = useTranslation();
  const L = useLocalised();
  const toast = useToast();
  const { can } = useAuth();

  const [reviewNote, setReviewNote] = useState('');

  /**
   * Only genuine shortages can be restocked.
   *
   * `NOT_ANSWERED` means nobody checked the question — the answer to that is to
   * go and look, not to fetch stock. `CONDITION` issues (a nearly-empty
   * betadine bottle) are real but have no countable gap, so they are shown as
   * context rather than offered as restock lines.
   */
  const restockable = (report.summary?.issues ?? []).filter(
    (issue) => issue.kind === 'SHORTAGE',
  );

  const [selected, setSelected] = useState(
    () => new Set(restockable.map(issueKey)),
  );

  const [quantities, setQuantities] = useState(() =>
    Object.fromEntries(
      restockable.map((issue) => [
        issueKey(issue),
        Math.max(1, (issue.expected ?? 1) - (typeof issue.value === 'number' ? issue.value : 0)),
      ]),
    ),
  );

  const canRaiseJob = can('restock:create') && restockable.length > 0;

  const toggle = (key) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // --- Review only -----------------------------------------------------------
  const reviewOnly = useMutation({
    mutationFn: () => post(`/submissions/${report.id}/review`, { reviewNote: reviewNote || null }),
    onSuccess: () => {
      toast.success(t('reports.reviewed'));
      onReviewed();
    },
    onError: (error) => toast.error(error.message),
  });

  // --- Review AND raise a restock job ----------------------------------------
  const reviewAndRestock = useMutation({
    mutationFn: async () => {
      const selections = restockable
        .filter((issue) => selected.has(issueKey(issue)))
        .map((issue) => ({
          field: issue.field,
          row: issue.row ?? null,
          quantityNeeded: quantities[issueKey(issue)],
        }));

      // The job first: if it fails (no cabinet configured, say), the report is
      // left unreviewed so the reviewer can try again rather than being told it
      // is done while nothing was raised.
      await post(`/restock/from-submission/${report.id}`, { selections, note: reviewNote || null });
      await post(`/submissions/${report.id}/review`, { reviewNote: reviewNote || null });
    },
    onSuccess: () => {
      toast.success(t('restock.jobCreated'));
      onReviewed();
    },
    onError: (error) => toast.error(error.message),
  });

  const isBusy = reviewOnly.isPending || reviewAndRestock.isPending;
  const selectedCount = selected.size;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('reports.review')} size="lg">
      {/* ---------- What to restock ---------- */}
      {canRaiseJob ? (
        <>
          <h3 className="mb-1 text-sm font-semibold text-stone-800">
            {t('restock.selectShortages')}
          </h3>
          <p className="mb-3 text-xs text-stone-500">{t('restock.selectShortagesHelp')}</p>

          <ul className="mb-5 max-h-72 divide-y divide-surface-border overflow-y-auto rounded-lg border border-surface-border">
            {restockable.map((issue) => {
              const key = issueKey(issue);
              const isSelected = selected.has(key);

              return (
                <li key={key} className="flex items-center gap-3 p-2.5">
                  <input
                    id={`restock-${key}`}
                    type="checkbox"
                    className="h-4 w-4 shrink-0 rounded border-stone-300 text-brand-600"
                    checked={isSelected}
                    onChange={() => toggle(key)}
                  />

                  <label htmlFor={`restock-${key}`} className="min-w-0 flex-1 cursor-pointer">
                    <span className="block truncate text-sm text-stone-800">
                      {L.isArabic && issue.labelAr ? issue.labelAr : issue.label}
                    </span>
                    <span className="block text-xs text-stone-400">
                      {t('reports.expectedShort', {
                        expected: issue.expected ?? '—',
                        value: issue.value ?? 0,
                      })}
                      {issue.priority && issue.priority !== 'NORMAL' && (
                        <span
                          className={
                            issue.priority === 'URGENT' || issue.priority === 'HIGH'
                              ? ' text-status-critical'
                              : ''
                          }
                        >
                          {' · '}
                          {t(`priority.${issue.priority}`)}
                        </span>
                      )}
                    </span>
                  </label>

                  <label className="sr-only" htmlFor={`qty-${key}`}>
                    {t('inventory.quantity')}
                  </label>
                  <input
                    id={`qty-${key}`}
                    type="number"
                    min="1"
                    className="input w-20 shrink-0 text-center tabular-nums"
                    value={quantities[key] ?? 1}
                    disabled={!isSelected}
                    onChange={(event) =>
                      setQuantities((current) => ({
                        ...current,
                        [key]: Math.max(1, Number(event.target.value) || 1),
                      }))
                    }
                  />
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <p className="mb-5 rounded-lg bg-stone-50 p-3 text-sm text-stone-500">
          {t('restock.noShortagesToRestock')}
        </p>
      )}

      {/* ---------- Note ---------- */}
      <label htmlFor="reviewNote" className="label">
        {t('reports.reviewNote')} <span className="text-stone-400">({t('common.optional')})</span>
      </label>
      <textarea
        id="reviewNote"
        rows={2}
        className="input mb-5"
        value={reviewNote}
        onChange={(event) => setReviewNote(event.target.value)}
      />

      {/* ---------- Actions ---------- */}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onClose} disabled={isBusy}>
          {t('common.cancel')}
        </button>

        <button
          type="button"
          className="btn-secondary"
          onClick={() => reviewOnly.mutate()}
          disabled={isBusy}
        >
          {reviewOnly.isPending ? <Spinner size="sm" /> : <CheckCircle2 className="h-4 w-4" />}
          {t('restock.reviewOnly')}
        </button>

        {canRaiseJob && (
          <button
            type="button"
            className="btn-primary"
            onClick={() => reviewAndRestock.mutate()}
            // Nothing ticked means there is no job to raise — "review only" is
            // the action that fits, and it is right there.
            disabled={isBusy || selectedCount === 0}
          >
            {reviewAndRestock.isPending ? <Spinner size="sm" /> : <PackageSearch className="h-4 w-4" />}
            {t('restock.reviewAndRestock')}
            {selectedCount > 0 && ` (${selectedCount})`}
          </button>
        )}
      </div>
    </Modal>
  );
}

export default ReviewAndRestockModal;
