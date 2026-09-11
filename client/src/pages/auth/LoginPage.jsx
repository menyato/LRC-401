/**
 * =============================================================================
 *  Login
 * =============================================================================
 *  Two steps in one page:
 *    1. email + password
 *    2. the 6-digit code, only when the account has 2FA enabled
 *
 *  The second step is rendered from local state rather than being a separate
 *  route, because the `mfaToken` must not survive a page reload — it is a
 *  short-lived credential, and putting it in the URL would leak it into browser
 *  history and any shared link.
 * =============================================================================
 */

import { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { KeyRound, ShieldCheck } from 'lucide-react';

import { useAuth } from '@/features/auth/AuthProvider';
import { Spinner } from '@/components/Spinner';

export default function LoginPage() {
  const { t } = useTranslation();
  const { login, verifyTwoFactor } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  /** Set once the password step succeeds and 2FA is required. */
  const [mfaToken, setMfaToken] = useState(null);

  /** Where to go after signing in — set by <Protected> on a deep link. */
  const redirectTo = location.state?.from?.pathname ?? '/';

  if (mfaToken) {
    return (
      <TwoFactorStep
        mfaToken={mfaToken}
        onVerified={() => navigate(redirectTo, { replace: true })}
        onCancel={() => setMfaToken(null)}
        verifyTwoFactor={verifyTwoFactor}
      />
    );
  }

  return (
    <PasswordStep
      login={login}
      onNeedsTwoFactor={setMfaToken}
      onSignedIn={() => navigate(redirectTo, { replace: true })}
    />
  );
}

// -----------------------------------------------------------------------------
//  Step 1 — email and password
// -----------------------------------------------------------------------------
function PasswordStep({ login, onNeedsTwoFactor, onSignedIn }) {
  const { t } = useTranslation();
  const [formError, setFormError] = useState(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ defaultValues: { email: '', password: '' } });

  const onSubmit = async (values) => {
    setFormError(null);

    try {
      const result = await login(values);

      if (result.requiresTwoFactor) {
        onNeedsTwoFactor(result.mfaToken);
      } else {
        onSignedIn();
      }
    } catch (error) {
      // The server returns ONE message for every credential failure, on purpose
      // (see auth.service.js) — we show it verbatim rather than guessing.
      setFormError(error.message);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <h2 className="mb-1 text-lg font-semibold text-stone-900">{t('auth.signIn')}</h2>
      <p className="mb-5 text-sm text-stone-500">{t('auth.signInSubtitle')}</p>

      {formError && (
        <div
          className="mb-4 rounded-lg border border-status-critical/20 bg-status-criticalBg p-3
                     text-sm text-status-critical"
          // `alert` makes a screen reader announce it immediately.
          role="alert"
        >
          {formError}
        </div>
      )}

      <div className="mb-4">
        <label htmlFor="email" className="label">
          {t('auth.email')}
        </label>
        <input
          id="email"
          type="email"
          // Helps password managers and mobile keyboards.
          autoComplete="username"
          // The first field on the page people came here to use.
          autoFocus
          className={`input ${errors.email ? 'input-error' : ''}`}
          {...register('email', { required: t('common.required') })}
          aria-invalid={Boolean(errors.email)}
        />
        {errors.email && <p className="form-error">{errors.email.message}</p>}
      </div>

      <div className="mb-5">
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <label htmlFor="password" className="label mb-0">
            {t('auth.password')}
          </label>
          <Link to="/forgot-password" className="text-xs text-brand-600 hover:underline">
            {t('auth.forgotPassword')}
          </Link>
        </div>

        <input
          id="password"
          type="password"
          autoComplete="current-password"
          className={`input ${errors.password ? 'input-error' : ''}`}
          {...register('password', { required: t('common.required') })}
          aria-invalid={Boolean(errors.password)}
        />
        {errors.password && <p className="form-error">{errors.password.message}</p>}
      </div>

      <button type="submit" className="btn-primary w-full" disabled={isSubmitting}>
        {isSubmitting ? <Spinner size="sm" /> : <KeyRound className="h-4 w-4" />}
        {t('auth.signIn')}
      </button>
    </form>
  );
}

// -----------------------------------------------------------------------------
//  Step 2 — the authenticator code
// -----------------------------------------------------------------------------
function TwoFactorStep({ mfaToken, onVerified, onCancel, verifyTwoFactor }) {
  const { t } = useTranslation();
  const [formError, setFormError] = useState(null);
  const [useBackup, setUseBackup] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({ defaultValues: { code: '' } });

  const onSubmit = async (values) => {
    setFormError(null);

    try {
      await verifyTwoFactor({ mfaToken, code: values.code, isBackupCode: useBackup });
      onVerified();
    } catch (error) {
      setFormError(error.message);

      // Clear the field: the next attempt is a new code, and leaving the failed
      // one in place means the user must select and delete it first.
      reset({ code: '' });

      // The mfaToken expires after 5 minutes. When it does, the only way
      // forward is to re-enter the password.
      if (error.code === 'TOKEN_EXPIRED' || error.code === 'MFA_INVALID') {
        onCancel();
      }
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <div className="mb-4 flex items-center gap-3">
        <div className="rounded-full bg-brand-subtle p-2">
          <ShieldCheck className="h-5 w-5 text-brand-600" aria-hidden="true" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-stone-900">{t('auth.twoFactorTitle')}</h2>
          <p className="text-sm text-stone-500">
            {useBackup ? t('auth.backupCode') : t('auth.twoFactorPrompt')}
          </p>
        </div>
      </div>

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
        <label htmlFor="code" className="label">
          {useBackup ? t('auth.backupCode') : t('auth.twoFactorCode')}
        </label>

        <input
          id="code"
          type="text"
          autoFocus
          // `one-time-code` lets iOS and Android offer the code from the
          // clipboard or an SMS/app suggestion.
          autoComplete="one-time-code"
          // `numeric` shows a digit keypad for the 6-digit case; backup codes
          // contain letters, so only apply it for the TOTP case.
          inputMode={useBackup ? 'text' : 'numeric'}
          className={`input text-center text-lg tracking-[0.3em] ${errors.code ? 'input-error' : ''}`}
          placeholder={useBackup ? 'XXXX-XXXX' : '000000'}
          maxLength={useBackup ? 9 : 6}
          {...register('code', { required: t('common.required') })}
          aria-invalid={Boolean(errors.code)}
        />
        {errors.code && <p className="form-error">{errors.code.message}</p>}
      </div>

      <button type="submit" className="btn-primary mb-3 w-full" disabled={isSubmitting}>
        {isSubmitting && <Spinner size="sm" />}
        {t('auth.verify')}
      </button>

      <div className="flex items-center justify-between text-xs">
        <button
          type="button"
          className="text-brand-600 hover:underline"
          onClick={() => {
            setUseBackup((current) => !current);
            setFormError(null);
            reset({ code: '' });
          }}
        >
          {useBackup ? t('auth.useAuthenticator') : t('auth.useBackupCode')}
        </button>

        <button type="button" className="text-stone-500 hover:underline" onClick={onCancel}>
          {t('common.back')}
        </button>
      </div>
    </form>
  );
}
