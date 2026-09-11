/**
 * =============================================================================
 *  Change password
 * =============================================================================
 *  Reached two ways:
 *    • voluntarily, from the account page
 *    • forced, when an admin has reset the password (`mustChangePassword`)
 *
 *  In the forced case the server BLOCKS every other endpoint until it is done
 *  (see middleware/auth.js) — this page is not merely a prompt the user could
 *  navigate around.
 * =============================================================================
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { KeyRound, AlertTriangle } from 'lucide-react';

import { post } from '@/lib/api';
import { useAuth } from '@/features/auth/AuthProvider';
import { PasswordField } from '@/components/PasswordField';
import { Spinner } from '@/components/Spinner';
import { useToast } from '@/components/Toast';
import { applyServerErrors } from '@/lib/formErrors';

export default function ChangePasswordPage() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const [formError, setFormError] = useState(null);

  const {
    register,
    handleSubmit,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({ defaultValues: { currentPassword: '', newPassword: '' } });

  const newPasswordValue = watch('newPassword');

  const onSubmit = async (values) => {
    setFormError(null);

    try {
      await post('/auth/change-password', values);

      toast.success(t('auth.passwordChanged'));

      // The server revokes EVERY session on a password change, including this
      // one — so the only correct next step is a fresh sign-in. Clearing local
      // state first avoids a burst of 401s from background queries.
      await logout();
      navigate('/login', { replace: true });
    } catch (error) {
      // Puts the real reason on the offending input ("must be at least 10
      // characters") instead of only saying "check the highlighted fields"
      // while highlighting nothing.
      applyServerErrors(error, setError, setFormError, ['currentPassword', 'newPassword']);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <h2 className="mb-1 text-lg font-semibold text-stone-900">{t('auth.changePassword')}</h2>

      {user?.mustChangePassword ? (
        <div
          className="mb-5 mt-3 flex items-start gap-2 rounded-lg border border-status-warn/20
                     bg-status-warnBg p-3 text-sm text-status-warn"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>{t('auth.mustChangePassword')}</p>
        </div>
      ) : (
        <p className="mb-5 text-sm text-stone-500">
          You will be signed out on all devices after changing your password.
        </p>
      )}

      {formError && (
        <div
          className="mb-4 rounded-lg border border-status-critical/20 bg-status-criticalBg p-3
                     text-sm text-status-critical"
          role="alert"
        >
          {formError}
        </div>
      )}

      <div className="mb-4">
        <PasswordField
          id="currentPassword"
          label={t('auth.currentPassword')}
          autoComplete="current-password"
          error={errors.currentPassword?.message}
          registration={register('currentPassword', { required: t('common.required') })}
        />
      </div>

      <div className="mb-5">
        <PasswordField
          id="newPassword"
          label={t('auth.newPassword')}
          value={newPasswordValue}
          showStrength
          error={errors.newPassword?.message}
          registration={register('newPassword', { required: t('common.required') })}
        />
      </div>

      <button type="submit" className="btn-primary w-full" disabled={isSubmitting}>
        {isSubmitting ? <Spinner size="sm" /> : <KeyRound className="h-4 w-4" />}
        {t('auth.changePassword')}
      </button>
    </form>
  );
}
