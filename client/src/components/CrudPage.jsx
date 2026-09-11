/**
 * =============================================================================
 *  CrudPage — the frontend twin of the backend's createCrudRouter
 * =============================================================================
 *  Teams and vehicles are the same screen with different fields: a searchable
 *  paginated list, a create button, an edit dialog, and a deactivate action.
 *
 *  Writing that twice would be ~350 lines of near-identical JSX and two chances
 *  to forget the empty state, the permission guard, or the mobile layout. So it
 *  is written once and driven by a field list.
 *
 *  Anything genuinely resource-specific — team membership, shift assignments —
 *  is written explicitly in its own page. A factory should absorb the boring
 *  majority, not contort itself to cover the interesting minority.
 * =============================================================================
 */

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus, Pencil, Ban } from 'lucide-react';

import { post, patch, del } from '@/lib/api';
import { usePaginatedQuery } from '@/hooks/usePaginatedQuery';
import { useAuth } from '@/features/auth/AuthProvider';
import { PageHeader } from '@/components/PageHeader';
import { DataTable, SearchInput } from '@/components/DataTable';
import { Modal, ConfirmDialog } from '@/components/Modal';
import { useToast } from '@/components/Toast';

/**
 * @param {object} props
 * @param {string} props.title
 * @param {string} props.queryKey        Cache key, e.g. 'teams'.
 * @param {string} props.url             API path, e.g. '/teams'.
 * @param {object} props.permissions     { read, manage }
 * @param {Array}  props.columns         DataTable column definitions.
 * @param {Array<{name:string, label:string, type?:string, required?:boolean,
 *                options?:Array, dir?:string, immutable?:boolean,
 *                help?:string}>} props.fields   Form field definitions.
 * @param {Function} [props.transform]   (values) => payload, before sending.
 * @param {React.ReactNode} [props.extraActions]
 */
export function CrudPage({
  title,
  description,
  queryKey,
  url,
  permissions,
  columns,
  fields,
  transform,
  extraActions,
}) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  // null = dialog closed, {} = creating, {…} = editing that record.
  const [editing, setEditing] = useState(null);
  const [deactivating, setDeactivating] = useState(null);

  const list = usePaginatedQuery({ key: queryKey, url });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: [queryKey] });

  const deactivate = useMutation({
    mutationFn: (id) => del(`${url}/${id}`),
    onSuccess: () => {
      toast.success(t('common.save'));
      setDeactivating(null);
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const canManage = can(permissions.manage);

  // Append an actions column only when the user can actually act — an empty
  // column of nothing is worse than no column.
  const allColumns = canManage
    ? [
        ...columns,
        {
          key: '__actions',
          header: t('common.actions'),
          align: 'end',
          render: (row) => (
            <div className="flex justify-end gap-1">
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => setEditing(row)}
                aria-label={t('common.edit')}
              >
                <Pencil className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="btn-ghost btn-sm text-status-critical"
                onClick={() => setDeactivating(row)}
                aria-label={t('common.delete')}
              >
                <Ban className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          ),
        },
      ]
    : columns;

  return (
    <div>
      <PageHeader title={title} description={description}>
        {extraActions}

        {canManage && (
          <button type="button" className="btn-primary" onClick={() => setEditing({})}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t('common.add')}
          </button>
        )}
      </PageHeader>

      <div className="card">
        <div className="card-header">
          <SearchInput value={list.search} onChange={list.setSearch} />
        </div>

        <DataTable
          columns={allColumns}
          rows={list.rows}
          meta={list.meta}
          isLoading={list.isLoading}
          error={list.error}
          onPageChange={list.setPage}
        />
      </div>

      <CrudFormModal
        record={editing}
        fields={fields}
        url={url}
        transform={transform}
        onClose={() => setEditing(null)}
        onSaved={invalidate}
      />

      <ConfirmDialog
        isOpen={Boolean(deactivating)}
        onClose={() => setDeactivating(null)}
        onConfirm={() => deactivate.mutate(deactivating.id)}
        title={t('common.delete')}
        // "Deactivate", never "delete": these records are referenced by
        // historical reports and movements, so they are only ever hidden.
        message="Deactivate this record? It will be hidden from the pickers but its history is kept."
        isPending={deactivate.isPending}
      />
    </div>
  );
}

/** The shared create/edit dialog, built from the `fields` definitions. */
function CrudFormModal({ record, fields, url, transform, onClose, onSaved }) {
  const { t } = useTranslation();
  const toast = useToast();

  const isOpen = record !== null;
  const isEditing = Boolean(record?.id);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm();

  useEffect(() => {
    if (!isOpen) return;

    // Build the defaults from the field list so a new field added below is
    // automatically reset correctly.
    reset(
      Object.fromEntries(
        fields.map((field) => [field.name, record[field.name] ?? field.defaultValue ?? '']),
      ),
    );
  }, [isOpen, record, fields, reset]);

  const save = useMutation({
    mutationFn: (values) => {
      let payload = transform ? transform(values) : values;

      // Immutable fields (a machine key) are only sent on creation.
      if (isEditing) {
        payload = Object.fromEntries(
          Object.entries(payload).filter(
            ([key]) => !fields.find((field) => field.name === key)?.immutable,
          ),
        );
        return patch(`${url}/${record.id}`, payload);
      }

      return post(url, payload);
    },
    onSuccess: () => {
      toast.success(t('common.save'));
      onSaved();
      onClose();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? t('common.edit') : t('common.add')}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            form="crud-form"
            className="btn-primary"
            disabled={save.isPending}
          >
            {t('common.save')}
          </button>
        </>
      }
    >
      <form id="crud-form" onSubmit={handleSubmit((values) => save.mutate(values))} noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          {fields
            // A machine key cannot be changed after creation, so hide the input
            // rather than showing a field that will be silently ignored.
            .filter((field) => !(isEditing && field.immutable))
            .map((field) => (
              <div key={field.name} className={field.fullWidth ? 'sm:col-span-2' : ''}>
                <label htmlFor={`crud-${field.name}`} className="label">
                  {field.label}
                  {field.required && <span className="text-status-critical"> *</span>}
                </label>

                {field.type === 'select' ? (
                  <select
                    id={`crud-${field.name}`}
                    className="input"
                    {...register(field.name, {
                      required: field.required ? t('common.required') : false,
                    })}
                  >
                    {field.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={`crud-${field.name}`}
                    type={field.type ?? 'text'}
                    dir={field.dir}
                    className={`input ${errors[field.name] ? 'input-error' : ''}`}
                    {...register(field.name, {
                      required: field.required ? t('common.required') : false,
                      valueAsNumber: field.type === 'number',
                    })}
                  />
                )}

                {field.help && <p className="mt-1 text-xs text-stone-500">{field.help}</p>}
                {errors[field.name] && (
                  <p className="form-error">{errors[field.name].message}</p>
                )}
              </div>
            ))}
        </div>
      </form>
    </Modal>
  );
}

export default CrudPage;
