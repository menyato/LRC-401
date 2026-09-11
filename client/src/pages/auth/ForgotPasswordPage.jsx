/**
 * =============================================================================
 *  Forgot password
 * =============================================================================
 *  Always shows the SAME confirmation, whether or not the address is
 *  registered. Saying "no account with that email" would turn this page into a
 *  free tool for discovering who is a member of the station — an account
 *  enumeration leak, and for a volunteer roster also a privacy one.
 * =============================================================================
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Mail, CheckCircle2 } from 'lucide-react';

import { post } from '@/lib/api';
import { Spinner } from '@/components/Spinner';

export default function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [isSent, setIsSent] = useState(false);
  const [formError, setFormError] = useState(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ defaultValues: { email: '' } });

  const onSubmit = async (values) => {
    setFormError(null);

    try {
      await post('/auth/forgot-password', values);
      setIsSent(true);
    } catch (error) {
      // The only realistic failures here are the rate limiter and a network
      // problem — both worth showing, neither revealing anything about accounts.
      setFormError(error.message);
    }
  };

  if (isSent) {
    return (
      <div className="text-center">
        <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-status-ok" aria-hidden="true" />
        <h2 className="mb-2 text-lg font-semibold text-stone-900">
          {t('auth.resetPasswordTitle')}
        </h2>
        <p className="mb-5 text-sm text-stone-600">{t('auth.resetPasswordSent')}</p>
        <Link to="/login" className="btn-secondary">
          {t('auth.signIn')}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <h2 className="mb-1 text-lg font-semibold text-stone-900">{t('auth.resetPasswordTitle')}</h2>
      <p className="mb-5 text-sm text-stone-500">
        Enter your email address and we will send you a link to choose a new password.
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
        <label htmlFor="email" className="label">
          {t('auth.email')}
        </label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          autoFocus
          className={`input ${errors.email ? 'input-error' : ''}`}
          {...register('email', { required: t('common.required') })}
          aria-invalid={Boolean(errors.email)}
        />
        {errors.email && <p className="form-error">{errors.email.message}</p>}
      </div>

      <button type="submit" className="btn-primary mb-3 w-full" disabled={isSubmitting}>
        {isSubmitting ? <Spinner size="sm" /> : <Mail className="h-4 w-4" />}
        Send reset link
      </button>

      <Link to="/login" className="block text-center text-xs text-stone-500 hover:underline">
        {t('common.back')}
      </Link>
    </form>
  );
}
