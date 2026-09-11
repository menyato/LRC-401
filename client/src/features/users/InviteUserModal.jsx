/**
 * =============================================================================
 *  Invite a user
 * =============================================================================
 *  The admin chooses the email, the role and the teams. The API creates an
 *  Invitation (not a User) and emails a one-time link; the account itself is
 *  created only when the person accepts and sets their own password.
 *
 *  In development the API also returns the token, and we show the link here so
 *  the flow can be tested without an email account.
 * =============================================================================
 */

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Copy, Check } from 'lucide-react';

import { get, post } from '@/lib/api';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/features/auth/AuthProvider';
import { useLocalised } from '@/hooks/useLocalised';

export function InviteUserModal({ isOpen, onClose }) {
  const { t } = useTranslation();
  const L = useLocalised();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { isSuperAdmin } = useAuth();

  /** Set after a successful invite when the API returned a dev token. */
  const [devLink, setDevLink] = useState(null);
  const [copied, setCopied] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm();

  useEffect(() => {
    if (isOpen) {
      reset({ email: '', fullName: '', roleId: '', isSuperAdmin: false, teamIds: [] });
      setDevLink(null);
      setCopied(false);
    }
  }, [isOpen, reset]);

  const { data: roles = [] } = useQuery({
    queryKey: ['roles'],
    queryFn: () => get('/roles'),
    enabled: isOpen,
  });

  const { data: teams = [] } = useQuery({
    queryKey: ['teams', 'all'],
    queryFn: () => get('/teams', { params: { limit: 50 } }),
    enabled: isOpen,
  });

  const invite = useMutation({
    mutationFn: (values) =>
      post('/users/invitations', {
        email: values.email,
        fullName: values.fullName,
        roleId: values.roleId || null,
        isSuperAdmin: Boolean(values.isSuperAdmin),
        // A single checkbox yields a string; several yield an array. Normalise.
        teamIds: [].concat(values.teamIds ?? []).filter(Boolean),
        extraPermissions: [],
      }),
    onSuccess: (invitation) => {
      toast.success(t('people.invitationSent', { email: invitation.email }));
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['invitations'] });

      if (invitation.devInviteToken) {
        // Development only — the API omits this in production.
        setDevLink(
          `${window.location.origin}/accept-invitation?token=${invitation.devInviteToken}`,
        );
      } else {
        onClose();
      }
    },
    onError: (error) => toast.error(error.message),
  });

  const wantsSuperAdmin = watch('isSuperAdmin');

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('people.inviteUser')}
      footer={
        devLink ? (
          <button type="button" className="btn-primary" onClick={onClose}>
            {t('common.close')}
          </button>
        ) : (
          <>
            <button type="button" className="btn-secondary" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              form="invite-form"
              className="btn-primary"
              disabled={invite.isPending}
            >
              {t('people.inviteUser')}
            </button>
          </>
        )
      }
    >
      {devLink ? (
        // Development helper: no email account needed to test the whole flow.
        <div>
          <p className="mb-2 text-sm text-stone-600">
            Email sending is set to <code className="rounded bg-stone-100 px-1">console</code>, so
            no email was delivered. Use this link to accept the invitation:
          </p>

          <div className="flex items-center gap-2">
            <input readOnly className="input font-mono text-xs" value={devLink} />
            <button
              type="button"
              className="btn-secondary shrink-0"
              onClick={() => {
                navigator.clipboard.writeText(devLink);
                setCopied(true);
              }}
              aria-label="Copy link"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
        </div>
      ) : (
        <form id="invite-form" onSubmit={handleSubmit((values) => invite.mutate(values))} noValidate>
          <div className="mb-4">
            <label htmlFor="invite-email" className="label">
              {t('auth.email')} <span className="text-status-critical">*</span>
            </label>
            <input
              id="invite-email"
              type="email"
              className={`input ${errors.email ? 'input-error' : ''}`}
              {...register('email', { required: t('common.required') })}
            />
            {errors.email && <p className="form-error">{errors.email.message}</p>}
          </div>

          <div className="mb-4">
            <label htmlFor="invite-name" className="label">
              {t('people.fullName')} <span className="text-status-critical">*</span>
            </label>
            <input
              id="invite-name"
              className={`input ${errors.fullName ? 'input-error' : ''}`}
              {...register('fullName', { required: t('common.required') })}
            />
            {errors.fullName && <p className="form-error">{errors.fullName.message}</p>}
          </div>

          <div className="mb-4">
            <label htmlFor="invite-role" className="label">
              {t('people.role')}
            </label>
            <select id="invite-role" className="input" {...register('roleId')}>
              <option value="">—</option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {L(role)}
                </option>
              ))}
            </select>
          </div>

          <fieldset className="mb-4">
            <legend className="label">{t('people.teams')}</legend>
            <div className="grid grid-cols-2 gap-1.5">
              {teams.map((team) => (
                <label key={team.id} className="flex items-center gap-2 text-sm text-stone-700">
                  <input
                    type="checkbox"
                    value={team.id}
                    className="h-4 w-4 rounded border-surface-border text-brand-600"
                    {...register('teamIds')}
                  />
                  {L(team)}
                </label>
              ))}
            </div>
          </fieldset>

          {/* Only a super admin may create another — the API enforces this too. */}
          {isSuperAdmin && (
            <div className="rounded-lg border border-status-warn/30 bg-status-warnBg p-3">
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-surface-border text-brand-600"
                  {...register('isSuperAdmin')}
                />
                <span className="text-sm font-medium text-status-warn">
                  {t('people.superAdmin')}
                </span>
              </label>

              {wantsSuperAdmin && (
                <p className="mt-2 text-xs text-status-warn">{t('people.superAdminWarning')}</p>
              )}
            </div>
          )}
        </form>
      )}
    </Modal>
  );
}

export default InviteUserModal;
