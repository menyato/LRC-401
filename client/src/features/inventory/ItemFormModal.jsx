/**
 * =============================================================================
 *  Create / edit an inventory item
 * =============================================================================
 *  One form for BOTH stores. The difference between a uniform shirt and a
 *  packet of gauze is two switches:
 *
 *      trackSize   -> keep a separate balance per size (clothing)
 *      trackExpiry -> require a batch number + expiry date on every receipt
 *
 *  Those two flags are the whole "clothing vs equipment" distinction, which is
 *  why there is no second screen for clothing.
 * =============================================================================
 */

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { X, Plus } from 'lucide-react';

import { post, patch } from '@/lib/api';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { useLocalised } from '@/hooks/useLocalised';

export function ItemFormModal({ isOpen, onClose, category, item }) {
  const { t } = useTranslation();
  const L = useLocalised();
  const toast = useToast();
  const queryClient = useQueryClient();

  const isEditing = Boolean(item);

  /** Custom sizes are managed as a chip list, not a comma-separated string. */
  const [sizes, setSizes] = useState([]);
  const [sizeDraft, setSizeDraft] = useState('');

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm();

  // Repopulate whenever the dialog opens for a different item. Without this the
  // form would keep the previous item's values after closing and reopening.
  useEffect(() => {
    if (!isOpen) return;

    reset({
      nameEn: item?.nameEn ?? '',
      nameAr: item?.nameAr ?? '',
      sku: item?.sku ?? '',
      unit: item?.unit ?? 'piece',
      trackSize: item?.trackSize ?? false,
      trackExpiry: item?.trackExpiry ?? false,
      lowStockThreshold: item?.lowStockThreshold ?? 0,
      expiryWarningDays: item?.expiryWarningDays ?? 30,
      notes: item?.notes ?? '',
    });

    setSizes(item?.sizes ?? []);
    setSizeDraft('');
  }, [isOpen, item, reset]);

  const trackSize = watch('trackSize');
  const trackExpiry = watch('trackExpiry');

  const save = useMutation({
    mutationFn: (values) => {
      const payload = {
        ...values,
        categoryId: category.id,
        sizes: values.trackSize ? sizes : [],
        // Empty strings must become null, not "", so the unique SKU constraint
        // does not treat several blank codes as duplicates.
        sku: values.sku?.trim() || null,
        nameAr: values.nameAr?.trim() || null,
        notes: values.notes?.trim() || null,
        lowStockThreshold: Number(values.lowStockThreshold),
        expiryWarningDays: Number(values.expiryWarningDays),
      };

      return isEditing
        ? patch(`/inventory/items/${item.id}`, payload)
        : post('/inventory/items', payload);
    },
    onSuccess: () => {
      toast.success(t('common.save'));
      queryClient.invalidateQueries({ queryKey: ['items'] });
      onClose();
    },
    onError: (error) => toast.error(error.message),
  });

  const addSize = () => {
    const value = sizeDraft.trim();
    // Silently ignore duplicates rather than erroring — the user's intent is
    // clear and an error here would be pedantic.
    if (value && !sizes.includes(value)) setSizes((current) => [...current, value]);
    setSizeDraft('');
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? t('common.edit') : t('inventory.newItem')}
      size="lg"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            form="item-form"
            className="btn-primary"
            disabled={isSubmitting || save.isPending}
          >
            {t('common.save')}
          </button>
        </>
      }
    >
      <form id="item-form" onSubmit={handleSubmit((values) => save.mutate(values))} noValidate>
        <p className="mb-4 text-xs text-stone-500">
          {t('inventory.category')}: <strong>{L(category)}</strong>
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="nameEn" className="label">
              {t('inventory.nameEn')} <span className="text-status-critical">*</span>
            </label>
            <input
              id="nameEn"
              className={`input ${errors.nameEn ? 'input-error' : ''}`}
              {...register('nameEn', { required: t('common.required') })}
            />
            {errors.nameEn && <p className="form-error">{errors.nameEn.message}</p>}
          </div>

          <div>
            <label htmlFor="nameAr" className="label">
              {t('inventory.nameAr')}
            </label>
            <input id="nameAr" dir="rtl" className="input" {...register('nameAr')} />
          </div>

          <div>
            <label htmlFor="sku" className="label">
              {t('inventory.sku')}
            </label>
            <input id="sku" className="input" {...register('sku')} />
          </div>

          <div>
            <label htmlFor="unit" className="label">
              {t('inventory.unit')}
            </label>
            <input id="unit" className="input" {...register('unit')} placeholder="piece, box, roll" />
          </div>

          <div>
            <label htmlFor="lowStockThreshold" className="label">
              {t('inventory.lowStockThreshold')}
            </label>
            <input
              id="lowStockThreshold"
              type="number"
              min={0}
              inputMode="numeric"
              className="input"
              {...register('lowStockThreshold')}
            />
          </div>
        </div>

        {/* ---------- Tracking switches ---------- */}
        <div className="mt-5 space-y-3 rounded-lg bg-stone-50 p-3">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-surface-border text-brand-600"
              {...register('trackSize')}
            />
            <span>
              <span className="block text-sm font-medium text-stone-800">
                {t('inventory.trackSize')}
              </span>
              <span className="block text-xs text-stone-500">{t('inventory.trackSizeHelp')}</span>
            </span>
          </label>

          {trackSize && (
            <div className="ps-7">
              <label htmlFor="size-draft" className="label">
                {t('inventory.sizes')}
              </label>

              <div className="mb-2 flex flex-wrap gap-1.5">
                {sizes.map((size) => (
                  <span
                    key={size}
                    className="inline-flex items-center gap-1 rounded-full bg-white
                               border border-surface-border px-2.5 py-1 text-xs"
                  >
                    {size}
                    <button
                      type="button"
                      onClick={() => setSizes((current) => current.filter((s) => s !== size))}
                      className="text-stone-400 hover:text-status-critical"
                      aria-label={`Remove ${size}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>

              <div className="flex gap-2">
                <input
                  id="size-draft"
                  className="input"
                  value={sizeDraft}
                  onChange={(event) => setSizeDraft(event.target.value)}
                  onKeyDown={(event) => {
                    // Enter adds a size. preventDefault stops it from also
                    // submitting the whole form.
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addSize();
                    }
                  }}
                  placeholder="S, M, L, 42…"
                />
                <button type="button" className="btn-secondary" onClick={addSize}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              <p className="mt-1 text-xs text-stone-500">{t('inventory.sizesHelp')}</p>
            </div>
          )}

          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-surface-border text-brand-600"
              {...register('trackExpiry')}
            />
            <span>
              <span className="block text-sm font-medium text-stone-800">
                {t('inventory.trackExpiry')}
              </span>
              <span className="block text-xs text-stone-500">{t('inventory.trackExpiryHelp')}</span>
            </span>
          </label>

          {trackExpiry && (
            <div className="ps-7">
              <label htmlFor="expiryWarningDays" className="label">
                {t('inventory.expiryWarningDays')}
              </label>
              <input
                id="expiryWarningDays"
                type="number"
                min={1}
                max={365}
                inputMode="numeric"
                className="input max-w-[8rem]"
                {...register('expiryWarningDays')}
              />
            </div>
          )}
        </div>

        <div className="mt-4">
          <label htmlFor="notes" className="label">
            {t('common.notes')}
          </label>
          <textarea id="notes" rows={2} className="input" {...register('notes')} />
        </div>
      </form>
    </Modal>
  );
}

export default ItemFormModal;
