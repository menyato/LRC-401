/**
 * =============================================================================
 *  Reset password — the page the emailed reset link opens
 * =============================================================================
 */

import { useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { KeyRound, AlertCircle } from 'lucide-react';

import { post } from '@/lib/api';
import { PasswordField } from '@/components/PasswordField';
import { Spinner } from '@/components/Spinner';
import { useToast } from '@/components/Toast';
import { applyServerErrors } from '@/lib/formErrors';

export default function ResetPasswordPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();

  const token = searchParams.get('token');
  const [formError, setFormError] = useState(null);

  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm({ defaultValues: { password: '' } });

  const passwordValue = watch('password');

  const onSubmit = async (values) => {
    setFormError(null);

    try {
      await post('/auth/reset-password', { token, password: values.password });

      toast.success(t('auth.passwordChanged'));
      // Straight to login rather than signing them in: the reset endpoint
      // revokes every session on purpose, so there is nothing to sign in with.
      navigate('/login', { replace: true });
    } catch (error) {
      applyServerErrors(error, setError, setFormError, ['password']);
    }
  };

  if (!token) {
    return (
      <div className="text-center">
        <AlertCircle className="mx-auto mb-3 h-10 w-10 text-status-critical" aria-hidden="true" />
        <h2 className="mb-2 text-lg font-semibold text-stone-900">Link not valid</h2>
        <p className="mb-5 text-sm text-stone-600">
          This reset link is missing its code. Please request a new one.
        </p>
        <Link to="/forgot-password" className="btn-secondary">
          {t('auth.forgotPassword')}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <h2 className="mb-1 text-lg font-semibold text-stone-900">{t('auth.setPasswordTitle')}</h2>
      <p className="mb-5 text-sm text-stone-500">
        Choose a new password for your account. You will be signed out everywhere else.
      </p>

      {formError && (
        <div
          className="mb-4 rounded-lg border border-status-critical/20 bg-status-criticalBg p-3
                     text-sm text-status-critical"
          role="alert"
        >
          {formError}
        </div>
      )}

      <div className="mb-5">
        <PasswordField
          id="password"
          label={t('auth.newPassword')}
          value={passwordValue}
          showStrength
          error={errors.password?.message}
          registration={register('password', { required: t('common.required') })}
        />
      </div>

      <button type="submit" className="btn-primary w-full" disabled={isSubmitting}>
        {isSubmitting ? <Spinner size="sm" /> : <KeyRound className="h-4 w-4" />}
        {t('common.save')}
      </button>
    </form>
  );
}
