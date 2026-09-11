/**
 * =============================================================================
 *  Accept invitation
 * =============================================================================
 *  The page an emailed invitation link opens.
 *
 *  Three states:
 *    1. checking the token
 *    2. token invalid / expired / already used  -> explain what to do
 *    3. valid -> the person chooses their OWN password and is signed straight in
 *
 *  We never email a password. A password sent by email lives in an inbox
 *  forever, is frequently reused elsewhere, and cannot be revoked. Letting the
 *  person set their own on a page reached by a single-use token avoids all of
 *  that.
 * =============================================================================
 */

import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { UserPlus, AlertCircle } from 'lucide-react';

import { get, post } from '@/lib/api';
import { useAuth } from '@/features/auth/AuthProvider';
import { PasswordField } from '@/components/PasswordField';
import { Spinner, FullPageSpinner } from '@/components/Spinner';
import { applyServerErrors } from '@/lib/formErrors';

export default function AcceptInvitationPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { applyDirectSession } = useAuth();

  const token = searchParams.get('token');

  const [invitation, setInvitation] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [isChecking, setIsChecking] = useState(true);
  const [formError, setFormError] = useState(null);

  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm({ defaultValues: { password: '', fullName: '', phone: '', locale: 'en' } });

  // Watched so the strength meter updates as the user types.
  const passwordValue = watch('password');

  // --- Validate the token before showing the form ---------------------------
  useEffect(() => {
    if (!token) {
      setLoadError(new Error('This link is missing its invitation code.'));
      setIsChecking(false);
      return;
    }

    (async () => {
      try {
        setInvitation(await get('/auth/invitation', { params: { token } }));
      } catch (error) {
        setLoadError(error);
      } finally {
        setIsChecking(false);
      }
    })();
  }, [token]);

  const onSubmit = async (values) => {
    setFormError(null);

    try {
      const session = await post('/auth/accept-invitation', { token, ...values });

      // The API signs them in as part of accepting — asking someone to type the
      // password they chose one second ago adds friction and no security.
      await applyDirectSession(session.accessToken);
      navigate('/', { replace: true });
    } catch (error) {
      applyServerErrors(error, setError, setFormError, ['fullName', 'phone', 'password', 'locale']);
    }
  };

  if (isChecking) return <FullPageSpinner />;

  // --- Invalid, expired or already used -------------------------------------
  if (loadError) {
    return (
      <div className="text-center">
        <AlertCircle className="mx-auto mb-3 h-10 w-10 text-status-critical" aria-hidden="true" />
        <h2 className="mb-2 text-lg font-semibold text-stone-900">Invitation not valid</h2>
        <p className="mb-5 text-sm text-stone-600">{loadError.message}</p>
        <Link to="/login" className="btn-secondary">
          {t('auth.signIn')}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <h2 className="mb-1 text-lg font-semibold text-stone-900">
        {t('auth.invitationFor', { name: invitation.fullName })}
      </h2>
      <p className="mb-5 text-sm text-stone-500">
        {t('auth.invitationRole', { role: invitation.roleName })} · {invitation.email}
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

      <div className="mb-4">
        <label htmlFor="fullName" className="label">
          {t('people.fullName')}
        </label>
        <input
          id="fullName"
          className="input"
          // Pre-filled from the invitation, but editable: the admin may have
          // typed a nickname or misspelled it.
          defaultValue={invitation.fullName}
          {...register('fullName', { required: t('common.required') })}
        />
        {errors.fullName && <p className="form-error">{errors.fullName.message}</p>}
      </div>

      <div className="mb-4">
        <label htmlFor="phone" className="label">
          {t('people.phone')} <span className="text-stone-400">({t('common.optional')})</span>
        </label>
        <input id="phone" type="tel" className="input" {...register('phone')} />
      </div>

      <div className="mb-5">
        <PasswordField
          id="password"
          label={t('auth.setPasswordTitle')}
          value={passwordValue}
          showStrength
          error={errors.password?.message}
          registration={register('password', { required: t('common.required') })}
        />
      </div>

      <div className="mb-5">
        <label htmlFor="locale" className="label">
          {t('common.language')}
        </label>
        <select id="locale" className="input" {...register('locale')}>
          <option value="en">English</option>
          <option value="ar">العربية</option>
        </select>
      </div>

      <button type="submit" className="btn-primary w-full" disabled={isSubmitting}>
        {isSubmitting ? <Spinner size="sm" /> : <UserPlus className="h-4 w-4" />}
        {t('auth.acceptInvitation')}
      </button>
    </form>
  );
}
