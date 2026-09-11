/**
 * =============================================================================
 *  Roles & permissions
 * =============================================================================
 *  Roles are DATA — the super admin composes any bundle they like from the
 *  fixed permission catalogue. This is what makes "create admin accounts and
 *  give them access to different things" work without a developer.
 *
 *  Built-in roles can be EDITED but not DELETED, so the station can never end
 *  up with no role that supports a workflow it depends on.
 * =============================================================================
 */

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, Pencil, Lock } from 'lucide-react';

import { get, post, patch, del } from '@/lib/api';
import { useAuth } from '@/features/auth/AuthProvider';
import { useLocalised } from '@/hooks/useLocalised';
import { PageHeader } from '@/components/PageHeader';
import { Modal, ConfirmDialog } from '@/components/Modal';
import { FullPageSpinner } from '@/components/Spinner';
import { useToast } from '@/components/Toast';

export default function RolesPage() {
  const { t } = useTranslation();
  const L = useLocalised();
  const { can, permissionCatalogue } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const { data: roles = [], isLoading } = useQuery({
    queryKey: ['roles'],
    queryFn: () => get('/roles'),
  });

  const remove = useMutation({
    mutationFn: (id) => del(`/roles/${id}`),
    onSuccess: () => {
      toast.success(t('common.delete'));
      setDeleting(null);
      queryClient.invalidateQueries({ queryKey: ['roles'] });
    },
    onError: (error) => toast.error(error.message),
  });

  if (isLoading) return <FullPageSpinner />;

  return (
    <div>
      <PageHeader title={t('roles.title')}>
        {can('role:manage') && (
          <button
            type="button"
            className="btn-primary"
            // `{}` (not null) means "new role" — null means the dialog is shut.
            onClick={() => setEditing({})}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t('roles.newRole')}
          </button>
        )}
      </PageHeader>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {roles.map((role) => (
          <article key={role.id} className="card p-4">
            <header className="mb-2 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="flex items-center gap-1.5 font-medium text-stone-900">
                  <span className="truncate">{L(role)}</span>
                  {role.isSystem && (
                    <Lock
                      className="h-3.5 w-3.5 shrink-0 text-stone-400"
                      aria-label={t('roles.systemRole')}
                    />
                  )}
                </h2>
                <p className="text-xs text-stone-400">
                  {t('roles.usersWithRole', { count: role._count?.users ?? 0 })}
                </p>
              </div>

              {can('role:manage') && (
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() => setEditing(role)}
                    aria-label={t('common.edit')}
                  >
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </button>

                  {/* Built-in roles have no delete button at all — the API
                      would refuse, so offering it would only produce an error. */}
                  {!role.isSystem && (
                    <button
                      type="button"
                      className="btn-ghost btn-sm text-status-critical"
                      onClick={() => setDeleting(role)}
                      aria-label={t('common.delete')}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
              )}
            </header>

            {role.description && (
              <p className="mb-2 text-xs text-stone-500">{role.description}</p>
            )}

            <p className="text-xs text-stone-600">
              {role.permissions.length} {t('roles.permissions').toLowerCase()}
            </p>
          </article>
        ))}
      </div>

      <RoleFormModal
        role={editing}
        catalogue={permissionCatalogue}
        onClose={() => setEditing(null)}
      />

      <ConfirmDialog
        isOpen={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => remove.mutate(deleting.id)}
        title={t('common.delete')}
        message={`Delete the role "${deleting?.nameEn}"? This cannot be undone.`}
        isPending={remove.isPending}
      />
    </div>
  );
}

/** Create/edit dialog. `role` is null when closed, `{}` for a new role. */
function RoleFormModal({ role, catalogue, onClose }) {
  const { t } = useTranslation();
  const L = useLocalised();
  const toast = useToast();
  const queryClient = useQueryClient();

  const isOpen = role !== null;
  const isEditing = Boolean(role?.id);

  const [form, setForm] = useState({ key: '', nameEn: '', nameAr: '', description: '' });
  const [permissions, setPermissions] = useState([]);

  useEffect(() => {
    if (!isOpen) return;

    setForm({
      key: role.key ?? '',
      nameEn: role.nameEn ?? '',
      nameAr: role.nameAr ?? '',
      description: role.description ?? '',
    });
    setPermissions(role.permissions ?? []);
  }, [isOpen, role]);

  const save = useMutation({
    mutationFn: () => {
      const payload = { ...form, description: form.description || null, permissions };

      // `key` is immutable after creation — it is referenced by the seed and
      // by code, so the API rejects a change and we do not send one.
      if (isEditing) {
        const { key: _key, ...rest } = payload;
        return patch(`/roles/${role.id}`, rest);
      }

      return post('/roles', payload);
    },
    onSuccess: () => {
      toast.success(t('common.save'));
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      onClose();
    },
    onError: (error) => toast.error(error.message),
  });

  const toggle = (key) =>
    setPermissions((current) =>
      current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key],
    );

  /** Selects or clears a whole group in one click — 40 permissions is a lot. */
  const toggleGroup = (group) => {
    const keys = group.permissions.map((permission) => permission.key);
    const allSelected = keys.every((key) => permissions.includes(key));

    setPermissions((current) =>
      allSelected
        ? current.filter((key) => !keys.includes(key))
        : [...new Set([...current, ...keys])],
    );
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? t('common.edit') : t('roles.newRole')}
      size="xl"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => save.mutate()}
            disabled={save.isPending}
          >
            {t('common.save')}
          </button>
        </>
      }
    >
      <div className="mb-5 grid gap-3 sm:grid-cols-2">
        {!isEditing && (
          <div>
            <label htmlFor="role-key" className="label">
              Key
            </label>
            <input
              id="role-key"
              className="input font-mono text-sm"
              value={form.key}
              onChange={(event) =>
                // Normalise as they type so the API's pattern rule cannot fail
                // on a stray space or capital.
                setForm((current) => ({
                  ...current,
                  key: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
                }))
              }
              placeholder="clothing_officer"
            />
          </div>
        )}

        <div>
          <label htmlFor="role-nameEn" className="label">
            {t('roles.roleName')} (EN)
          </label>
          <input
            id="role-nameEn"
            className="input"
            value={form.nameEn}
            onChange={(event) => setForm((current) => ({ ...current, nameEn: event.target.value }))}
          />
        </div>

        <div>
          <label htmlFor="role-nameAr" className="label">
            {t('roles.roleName')} (AR)
          </label>
          <input
            id="role-nameAr"
            dir="rtl"
            className="input"
            value={form.nameAr}
            onChange={(event) => setForm((current) => ({ ...current, nameAr: event.target.value }))}
          />
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="role-description" className="label">
            {t('common.notes')}
          </label>
          <input
            id="role-description"
            className="input"
            value={form.description}
            onChange={(event) =>
              setForm((current) => ({ ...current, description: event.target.value }))
            }
          />
        </div>
      </div>

      {/* ---------- Permission checkboxes ---------- */}
      <div className="space-y-4">
        {catalogue.map((group) => (
          <fieldset key={group.key}>
            <div className="mb-1.5 flex items-baseline justify-between">
              <legend className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                {L(group, 'label')}
              </legend>
              <button
                type="button"
                className="text-xs text-brand-600 hover:underline"
                onClick={() => toggleGroup(group)}
              >
                {t('common.all')}
              </button>
            </div>

            <div className="grid gap-1 sm:grid-cols-2">
              {group.permissions.map((permission) => (
                <label
                  key={permission.key}
                  className="flex items-start gap-2 rounded-lg border border-surface-border
                             bg-white p-2 text-xs"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border-surface-border text-brand-600"
                    checked={permissions.includes(permission.key)}
                    onChange={() => toggle(permission.key)}
                  />
                  <span className="min-w-0">
                    <span className="block text-stone-800">{L(permission, 'label')}</span>
                    {permission.sensitive && (
                      <span className="block text-[0.6875rem] text-status-warn">
                        {t('roles.sensitiveHelp')}
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
    </Modal>
  );
}
