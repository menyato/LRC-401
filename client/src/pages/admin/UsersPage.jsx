/**
 * =============================================================================
 *  Users
 * =============================================================================
 *  The super admin's people screen: invite, manage access, suspend.
 *
 *  There is NO DELETE. Users are suspended instead, because audit entries,
 *  stock movements and submitted reports all point at them — a history that
 *  says "a deleted user issued 40 tourniquets" is not a history.
 * =============================================================================
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { UserPlus, ShieldCheck, Ban, RotateCcw, KeyRound, Mail } from 'lucide-react';

import { get, patch, post, del } from '@/lib/api';
import { usePaginatedQuery } from '@/hooks/usePaginatedQuery';
import { useAuth } from '@/features/auth/AuthProvider';
import { PageHeader } from '@/components/PageHeader';
import { DataTable, SearchInput } from '@/components/DataTable';
import { StatusBadge } from '@/components/StatusBadge';
import { ConfirmDialog, Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { InviteUserModal } from '@/features/users/InviteUserModal';
import { UserAccessModal } from '@/features/users/UserAccessModal';

export default function UsersPage() {
  const { t } = useTranslation();
  const { can, isSuperAdmin } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [status, setStatus] = useState('');
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [accessUserId, setAccessUserId] = useState(null);
  const [suspendTarget, setSuspendTarget] = useState(null);
  const [resetTarget, setResetTarget] = useState(null);
  const [temporaryPassword, setTemporaryPassword] = useState(null);
  const [showInvitations, setShowInvitations] = useState(false);

  const list = usePaginatedQuery({ key: 'users', url: '/users', filters: { status } });

  const invitations = useQuery({
    queryKey: ['invitations'],
    queryFn: () => get('/users/invitations', { params: { limit: 50 } }),
    enabled: showInvitations && can('user:invite'),
  });

  const refreshUsers = () => queryClient.invalidateQueries({ queryKey: ['users'] });

  const setStatusMutation = useMutation({
    mutationFn: ({ id, nextStatus }) => patch(`/users/${id}/status`, { status: nextStatus }),
    onSuccess: () => {
      toast.success(t('common.save'));
      setSuspendTarget(null);
      refreshUsers();
    },
    onError: (error) => toast.error(error.message),
  });

  const resetPasswordMutation = useMutation({
    mutationFn: (id) => post(`/users/${id}/reset-password`, { notifyByEmail: true }),
    onSuccess: (result) => {
      // Shown once, so the admin can read it to the person in the station.
      setTemporaryPassword(result.temporaryPassword);
      setResetTarget(null);
      refreshUsers();
    },
    onError: (error) => toast.error(error.message),
  });

  const revokeInvitation = useMutation({
    mutationFn: (id) => del(`/users/invitations/${id}`),
    onSuccess: () => {
      toast.success(t('common.save'));
      queryClient.invalidateQueries({ queryKey: ['invitations'] });
    },
    onError: (error) => toast.error(error.message),
  });

  const columns = [
    {
      key: 'fullName',
      header: t('people.fullName'),
      primary: true,
      render: (row) => (
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 truncate font-medium text-stone-900">
            {row.fullName}
            {row.isSuperAdmin && (
              <ShieldCheck
                className="h-3.5 w-3.5 shrink-0 text-brand-600"
                aria-label={t('people.superAdmin')}
              />
            )}
          </p>
          <p className="truncate text-xs text-stone-400">{row.email}</p>
        </div>
      ),
    },
    {
      key: 'role',
      header: t('people.role'),
      render: (row) => row.role?.nameEn ?? <span className="text-stone-300">—</span>,
    },
    {
      key: 'status',
      header: t('people.status'),
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'twoFactorEnabled',
      header: '2FA',
      hideOnMobile: true,
      render: (row) =>
        row.twoFactorEnabled ? (
          <StatusBadge status="OK" label="On" />
        ) : (
          <span className="text-xs text-stone-400">Off</span>
        ),
    },
    {
      key: 'lastLoginAt',
      header: t('people.lastLogin'),
      hideOnMobile: true,
      render: (row) =>
        row.lastLoginAt ? (
          <span className="tabular-nums text-xs">{dayjs(row.lastLoginAt).format('D MMM HH:mm')}</span>
        ) : (
          <span className="text-stone-300">—</span>
        ),
    },
    {
      key: 'actions',
      header: t('common.actions'),
      align: 'end',
      render: (row) => (
        <div className="flex justify-end gap-1">
          {can('user:manage_access') && (
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => setAccessUserId(row.id)}
              title={t('people.manageAccess')}
            >
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            </button>
          )}

          {isSuperAdmin && (
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => setResetTarget(row)}
              title={t('people.resetPassword')}
            >
              <KeyRound className="h-4 w-4" aria-hidden="true" />
            </button>
          )}

          {can('user:suspend') && (
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => setSuspendTarget(row)}
              title={row.status === 'SUSPENDED' ? t('people.reactivate') : t('people.suspend')}
            >
              {row.status === 'SUSPENDED' ? (
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Ban className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title={t('people.users')}>
        {can('user:invite') && (
          <>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setShowInvitations((current) => !current)}
              aria-pressed={showInvitations}
            >
              <Mail className="h-4 w-4" aria-hidden="true" />
              {t('people.pendingInvitations')}
            </button>

            <button type="button" className="btn-primary" onClick={() => setIsInviteOpen(true)}>
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              {t('people.inviteUser')}
            </button>
          </>
        )}
      </PageHeader>

      {/* ---------- Pending invitations ---------- */}
      {showInvitations && (
        <div className="card mb-5">
          <div className="card-header">
            <h2 className="text-sm font-semibold text-stone-800">
              {t('people.pendingInvitations')}
            </h2>
          </div>

          <DataTable
            columns={[
              { key: 'fullName', header: t('people.fullName'), primary: true },
              { key: 'email', header: t('auth.email') },
              {
                key: 'expiresAt',
                header: 'Expires',
                render: (row) => dayjs(row.expiresAt).format('D MMM HH:mm'),
              },
              {
                key: 'actions',
                header: '',
                align: 'end',
                render: (row) => (
                  <button
                    type="button"
                    className="btn-ghost btn-sm text-status-critical"
                    onClick={() => revokeInvitation.mutate(row.id)}
                  >
                    {t('people.revokeInvitation')}
                  </button>
                ),
              },
            ]}
            rows={invitations.data?.data ?? []}
            isLoading={invitations.isLoading}
            emptyMessage={t('common.noResults')}
          />
        </div>
      )}

      {/* ---------- Users ---------- */}
      <div className="card">
        <div className="card-header flex-wrap gap-2">
          <SearchInput value={list.search} onChange={list.setSearch} />

          <select
            className="input w-auto"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            aria-label={t('people.status')}
          >
            <option value="">{t('common.all')}</option>
            <option value="ACTIVE">{t('status.active')}</option>
            <option value="INVITED">{t('status.invited')}</option>
            <option value="SUSPENDED">{t('status.suspended')}</option>
          </select>
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

      {/* ---------- Dialogs ---------- */}
      <InviteUserModal isOpen={isInviteOpen} onClose={() => setIsInviteOpen(false)} />

      <UserAccessModal
        isOpen={Boolean(accessUserId)}
        onClose={() => setAccessUserId(null)}
        userId={accessUserId}
      />

      <ConfirmDialog
        isOpen={Boolean(suspendTarget)}
        onClose={() => setSuspendTarget(null)}
        onConfirm={() =>
          setStatusMutation.mutate({
            id: suspendTarget.id,
            nextStatus: suspendTarget.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED',
          })
        }
        title={
          suspendTarget?.status === 'SUSPENDED' ? t('people.reactivate') : t('people.suspend')
        }
        message={
          suspendTarget?.status === 'SUSPENDED'
            ? `Reactivate ${suspendTarget?.fullName}? They will be able to sign in again.`
            : `Suspend ${suspendTarget?.fullName}? They will be signed out immediately and cannot sign in until reactivated.`
        }
        isDanger={suspendTarget?.status !== 'SUSPENDED'}
        isPending={setStatusMutation.isPending}
      />

      <ConfirmDialog
        isOpen={Boolean(resetTarget)}
        onClose={() => setResetTarget(null)}
        onConfirm={() => resetPasswordMutation.mutate(resetTarget.id)}
        title={t('people.resetPassword')}
        message={`Generate a temporary password for ${resetTarget?.fullName}? They will be signed out everywhere and must choose a new password at their next sign-in.`}
        isPending={resetPasswordMutation.isPending}
      />

      {/* The temporary password, shown once. */}
      <Modal
        isOpen={Boolean(temporaryPassword)}
        onClose={() => setTemporaryPassword(null)}
        title={t('people.resetPassword')}
        size="sm"
        footer={
          <button
            type="button"
            className="btn-primary"
            onClick={() => setTemporaryPassword(null)}
          >
            {t('common.close')}
          </button>
        }
      >
        <p className="mb-3 text-sm text-stone-600">
          Give this password to the user. It is shown only now, and they must change it at their
          next sign-in.
        </p>
        <code className="block break-all rounded-lg bg-stone-100 p-3 font-mono text-sm">
          {temporaryPassword}
        </code>
      </Modal>
    </div>
  );
}
