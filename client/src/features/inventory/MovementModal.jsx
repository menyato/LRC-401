/**
 * =============================================================================
 *  Record stock in / out
 * =============================================================================
 *  The form adapts to the item's own flags:
 *    • trackSize   -> a size must be chosen
 *    • trackExpiry -> a batch number and expiry date are required on IN
 *
 *  `movementDate` defaults to today but is EDITABLE. That was an explicit
 *  requirement: stock is often recorded a day or two after it physically moved,
 *  and back-dating it keeps the ledger honest. It is deliberately separate from
 *  `createdAt`, which records when it was typed in.
 * =============================================================================
 */

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { ArrowDownToLine, ArrowUpFromLine, Scale } from 'lucide-react';

import { get, post } from '@/lib/api';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/features/auth/AuthProvider';
import { useLocalised } from '@/hooks/useLocalised';

export function MovementModal({ isOpen, onClose, item }) {
  const { t } = useTranslation();
  const L = useLocalised();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { can } = useAuth();

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors },
  } = useForm();

  useEffect(() => {
    if (!isOpen) return;

    reset({
      direction: 'IN',
      quantity: 1,
      movementDate: dayjs().format('YYYY-MM-DD'),
      size: item?.sizes?.[0] ?? '',
      batchNumber: '',
      expiryDate: '',
      counterparty: '',
      issuedToUserId: '',
      reason: '',
      note: '',
      documentRef: '',
    });
  }, [isOpen, item, reset]);

  const direction = watch('direction');
  const isOut = direction === 'OUT';

  /**
   * Registered users, so clothing can be issued to a named volunteer.
   * Only loaded when the dialog is open and the user may read the roster —
   * an equipment admin without `user:read` simply types a name instead.
   */
  const { data: users = [] } = useQuery({
    queryKey: ['users', 'picker'],
    queryFn: () => get('/users', { params: { limit: 100, status: 'ACTIVE' } }),
    enabled: isOpen && isOut && can('user:read'),
  });

  const record = useMutation({
    mutationFn: (values) =>
      post('/inventory/movements', {
        itemId: item.id,
        direction: values.direction,
        quantity: Number(values.quantity),
        movementDate: values.movementDate,
        size: item.trackSize ? values.size : null,
        batchNumber: item.trackExpiry ? values.batchNumber || null : null,
        expiryDate: item.trackExpiry && values.expiryDate ? values.expiryDate : null,
        issuedToUserId: values.issuedToUserId || null,
        counterparty: values.counterparty?.trim() || null,
        reason: values.reason?.trim() || null,
        note: values.note?.trim() || null,
        documentRef: values.documentRef?.trim() || null,
      }),
    onSuccess: () => {
      toast.success(t('common.save'));
      // Both the item list (balances changed) and the log (a new row) are stale.
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: ['movements'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      onClose();
    },
    onError: (error) => toast.error(error.message),
  });

  if (!item) return null;

  /** The three directions, as buttons — clearer than a dropdown for 3 options. */
  const directions = [
    { value: 'IN', label: t('inventory.stockIn'), icon: ArrowDownToLine, tone: 'ok' },
    { value: 'OUT', label: t('inventory.stockOut'), icon: ArrowUpFromLine, tone: 'warn' },
    ...(can('inventory.movement:adjust')
      ? [{ value: 'ADJUST', label: t('inventory.adjust'), icon: Scale, tone: 'default' }]
      : []),
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`${t('inventory.recordMovement')} — ${L(item)}`}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            form="movement-form"
            className="btn-primary"
            disabled={record.isPending}
          >
            {t('common.save')}
          </button>
        </>
      }
    >
      <form id="movement-form" onSubmit={handleSubmit((values) => record.mutate(values))} noValidate>
        {/* ---------- Direction ---------- */}
        <div className="mb-4 grid grid-cols-3 gap-2">
          {directions.map((option) => (
            <label
              key={option.value}
              className={`flex cursor-pointer flex-col items-center gap-1 rounded-lg border p-3
                          text-xs font-medium transition-colors ${
                            direction === option.value
                              ? 'border-brand-600 bg-brand-50 text-brand-700'
                              : 'border-surface-border bg-white text-stone-600 hover:bg-stone-50'
                          }`}
            >
              {/* The radio is visually hidden but still the real control, so
                  keyboard and screen-reader behaviour stays correct. */}
              <input type="radio" value={option.value} className="sr-only" {...register('direction')} />
              <option.icon className="h-5 w-5" aria-hidden="true" />
              {option.label}
            </label>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="quantity" className="label">
              {t('inventory.quantity')} <span className="text-status-critical">*</span>
            </label>
            <input
              id="quantity"
              type="number"
              inputMode="numeric"
              className={`input ${errors.quantity ? 'input-error' : ''}`}
              {...register('quantity', {
                required: t('common.required'),
                // ADJUST may be negative (a count came up short); IN and OUT
                // carry their sign in the direction, so they must be positive.
                validate: (value) =>
                  direction === 'ADJUST'
                    ? Number(value) !== 0 || 'Cannot be zero'
                    : Number(value) > 0 || 'Must be greater than zero',
              })}
            />
            {errors.quantity && <p className="form-error">{errors.quantity.message}</p>}
            <p className="mt-1 text-xs text-stone-400">{item.unit}</p>
          </div>

          <div>
            <label htmlFor="movementDate" className="label">
              {t('inventory.movementDate')} <span className="text-status-critical">*</span>
            </label>
            <input
              id="movementDate"
              type="date"
              className="input"
              {...register('movementDate', { required: t('common.required') })}
            />
          </div>

          {/* ---------- Size (only when the item tracks it) ---------- */}
          {item.trackSize && (
            <div>
              <label htmlFor="size" className="label">
                {t('inventory.size')} <span className="text-status-critical">*</span>
              </label>
              <select
                id="size"
                className="input"
                {...register('size', { required: t('common.required') })}
              >
                {item.sizes.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* ---------- Batch + expiry (only when the item tracks it) ---------- */}
          {item.trackExpiry && (
            <>
              <div>
                <label htmlFor="batchNumber" className="label">
                  {t('inventory.batch')}
                </label>
                <input id="batchNumber" className="input" {...register('batchNumber')} />
              </div>

              <div>
                <label htmlFor="expiryDate" className="label">
                  {t('inventory.expiryDate')}
                  {direction === 'IN' && <span className="text-status-critical"> *</span>}
                </label>
                <input
                  id="expiryDate"
                  type="date"
                  className="input"
                  {...register('expiryDate', {
                    // Required on receipt only. Issuing older stock recorded
                    // before the flag was switched on must still be possible.
                    required: direction === 'IN' ? t('common.required') : false,
                  })}
                />
                {errors.expiryDate && <p className="form-error">{errors.expiryDate.message}</p>}
              </div>
            </>
          )}

          {/* ---------- Counterparty ---------- */}
          {isOut && can('user:read') && (
            <div>
              <label htmlFor="issuedToUserId" className="label">
                {t('inventory.issuedTo')}
              </label>
              <select id="issuedToUserId" className="input" {...register('issuedToUserId')}>
                <option value="">—</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.fullName}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label htmlFor="counterparty" className="label">
              {t('inventory.counterparty')}
            </label>
            <input
              id="counterparty"
              className="input"
              placeholder={isOut ? 'Name, team…' : 'Supplier, donor…'}
              {...register('counterparty')}
            />
          </div>

          <div>
            <label htmlFor="documentRef" className="label">
              {t('inventory.documentRef')}
            </label>
            <input id="documentRef" className="input" {...register('documentRef')} />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="note" className="label">
              {t('common.notes')}
            </label>
            <textarea id="note" rows={2} className="input" {...register('note')} />
          </div>
        </div>
      </form>
    </Modal>
  );
}

export default MovementModal;
