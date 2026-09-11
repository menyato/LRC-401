/**
 * =============================================================================
 *  Manage one person's access
 * =============================================================================
 *  Three layers, shown as three sections so the admin can see exactly where a
 *  given ability comes from:
 *
 *      ROLE      the bundle they inherit
 *      GRANTED   extra permissions on top, just for this person
 *      REMOVED   permissions taken away, even if the role includes them
 *
 *  Effective = role ∪ granted − removed, and DENY ALWAYS WINS. The preview at
 *  the bottom shows the result, so the admin never has to work it out in their
 *  head — which is where access-control mistakes come from.
 * =============================================================================
 */

import { useEffect, useState, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, Minus } from 'lucide-react';

import { get, patch } from '@/lib/api';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/features/auth/AuthProvider';
import { useLocalised } from '@/hooks/useLocalised';

export function UserAccessModal({ isOpen, onClose, userId }) {
  const { t } = useTranslation();
  const L = useLocalised();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { permissionCatalogue, isSuperAdmin, user: currentUser } = useAuth();

  const [roleId, setRoleId] = useState('');
  const [granted, setGranted] = useState([]);
  const [removed, setRemoved] = useState([]);

  const { data: user } = useQuery({
    queryKey: ['user', userId],
    queryFn: () => get(`/users/${userId}`),
    enabled: isOpen && Boolean(userId),
  });

  const { data: roles = [] } = useQuery({
    queryKey: ['roles'],
    queryFn: () => get('/roles'),
    enabled: isOpen,
  });

  useEffect(() => {
    if (!user) return;

    setRoleId(user.role?.id ?? '');
    setGranted(user.extraPermissions ?? []);
    setRemoved(user.deniedPermissions ?? []);
  }, [user]);

  /** The permission list of whichever role is currently selected. */
  const rolePermissions = useMemo(
    () => roles.find((role) => role.id === roleId)?.permissions ?? [],
    [roles, roleId],
  );

  /** Live preview of the result — the same formula the server applies. */
  const effective = useMemo(() => {
    const set = new Set([...rolePermissions, ...granted]);
    for (const permission of removed) set.delete(permission);
    return set;
  }, [rolePermissions, granted, removed]);

  const save = useMutation({
    mutationFn: () =>
      patch(`/users/${userId}/access`, {
        roleId: roleId || null,
        extraPermissions: granted,
        deniedPermissions: removed,
      }),
    onSuccess: () => {
      toast.success(t('common.save'));
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['user', userId] });
      onClose();
    },
    onError: (error) => toast.error(error.message),
  });

  /**
   * Cycles a permission through three states as the admin clicks it:
   *     inherited/off  ->  granted  ->  removed  ->  inherited/off
   * One control instead of two checkboxes, and the three states are mutually
   * exclusive by construction, so "granted AND removed" cannot be expressed.
   */
  const cycle = (key) => {
    if (granted.includes(key)) {
      setGranted((current) => current.filter((entry) => entry !== key));
      setRemoved((current) => [...current, key]);
    } else if (removed.includes(key)) {
      setRemoved((current) => current.filter((entry) => entry !== key));
    } else {
      setGranted((current) => [...current, key]);
    }
  };

  // The server blocks self-modification; mirroring it here explains WHY the
  // form is disabled instead of letting the user hit a 403.
  const isSelf = currentUser?.id === userId;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('people.manageAccess')}
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
            disabled={save.isPending || isSelf}
          >
            {t('common.save')}
          </button>
        </>
      }
    >
      {isSelf && (
        <div
          className="mb-4 flex items-start gap-2 rounded-lg border border-status-warn/30
                     bg-status-warnBg p-3 text-sm text-status-warn"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {t('people.selfAccessBlocked')}
        </div>
      )}

      {user && (
        <>
          <p className="mb-4 text-sm text-stone-600">
            <strong>{user.fullName}</strong> · {user.email}
          </p>

          {/* ---------- Role ---------- */}
          <div className="mb-5">
            <label htmlFor="access-role" className="label">
              {t('people.role')}
            </label>
            <select
              id="access-role"
              className="input"
              value={roleId}
              disabled={isSelf}
              onChange={(event) => setRoleId(event.target.value)}
            >
              <option value="">—</option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {L(role)} ({role.permissions.length})
                </option>
              ))}
            </select>
          </div>

          {/* ---------- Per-permission overrides ---------- */}
          <p className="mb-2 text-xs text-stone-500">
            Click a permission to grant it, click again to remove it, click once more to leave it
            to the role.
          </p>

          <div className="space-y-4">
            {permissionCatalogue.map((group) => (
              <fieldset key={group.key}>
                <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500">
                  {L(group, 'label')}
                </legend>

                <div className="grid gap-1 sm:grid-cols-2">
                  {group.permissions.map((permission) => {
                    const fromRole = rolePermissions.includes(permission.key);
                    const isGranted = granted.includes(permission.key);
                    const isRemoved = removed.includes(permission.key);
                    const isEffective = effective.has(permission.key);

                    return (
                      <button
                        key={permission.key}
                        type="button"
                        disabled={isSelf}
                        onClick={() => cycle(permission.key)}
                        className={`flex items-start gap-2 rounded-lg border p-2 text-start text-xs
                                    transition-colors disabled:opacity-60 ${
                                      isRemoved
                                        ? 'border-status-critical/30 bg-status-criticalBg'
                                        : isGranted
                                          ? 'border-status-ok/30 bg-status-okBg'
                                          : fromRole
                                            ? 'border-surface-border bg-stone-50'
                                            : 'border-surface-border bg-white'
                                    }`}
                      >
                        {/* State icon — never colour alone. */}
                        <span className="mt-0.5 shrink-0">
                          {isRemoved ? (
                            <Minus className="h-3.5 w-3.5 text-status-critical" aria-hidden="true" />
                          ) : isEffective ? (
                            <Check className="h-3.5 w-3.5 text-status-ok" aria-hidden="true" />
                          ) : (
                            <span className="block h-3.5 w-3.5 rounded border border-stone-300" />
                          )}
                        </span>

                        <span className="min-w-0">
                          <span className="block text-stone-800">{L(permission, 'label')}</span>

                          <span className="block text-[0.6875rem] text-stone-400">
                            {isRemoved
                              ? t('people.deniedPermissions')
                              : isGranted
                                ? t('people.extraPermissions')
                                : fromRole
                                  ? t('people.role')
                                  : '—'}
                          </span>

                          {permission.sensitive && (
                            <span className="mt-0.5 block text-[0.6875rem] text-status-warn">
                              {t('roles.sensitiveHelp')}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </div>

          <p className="mt-4 rounded-lg bg-stone-50 p-3 text-xs text-stone-600">
            {t('people.effectivePermissions')}: <strong>{effective.size}</strong>
          </p>
        </>
      )}
    </Modal>
  );
}

export default UserAccessModal;
