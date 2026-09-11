/**
 * =============================================================================
 *  My account
 * =============================================================================
 *  Profile, language, and two-factor authentication.
 *
 *  The 2FA enrolment is a three-step flow and the middle step matters: the
 *  secret is stored but NOT enabled until the user proves they can generate a
 *  valid code. Enabling first would lock out anyone whose scan silently failed.
 * =============================================================================
 */

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ShieldCheck, ShieldOff, KeyRound, Copy, Check } from 'lucide-react';

import { post, patch } from '@/lib/api';
import { useAuth } from '@/features/auth/AuthProvider';
import { PageHeader } from '@/components/PageHeader';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { Spinner } from '@/components/Spinner';

export default function AccountPage() {
  const { t, i18n } = useTranslation();
  const { user, refreshUser } = useAuth();
  const toast = useToast();

  const [enrollment, setEnrollment] = useState(null);
  const [backupCodes, setBackupCodes] = useState(null);
  const [isDisableOpen, setIsDisableOpen] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm({
    defaultValues: { fullName: user.fullName, phone: user.phone ?? '', locale: user.locale },
  });

  const saveProfile = useMutation({
    mutationFn: (values) => patch('/auth/profile', values),
    onSuccess: async (_result, values) => {
      toast.success(t('common.save'));
      // Switch the interface immediately, rather than on the next page load.
      if (values.locale !== i18n.language) i18n.changeLanguage(values.locale);
      await refreshUser();
    },
    onError: (error) => toast.error(error.message),
  });

  const startTwoFactor = useMutation({
    mutationFn: () => post('/auth/2fa/setup'),
    onSuccess: (result) => setEnrollment(result),
    onError: (error) => toast.error(error.message),
  });

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={t('nav.myAccount')} description={user.email} />

      {/* ---------- Profile ---------- */}
      <section className="card mb-5">
        <div className="card-header">
          <h2 className="text-sm font-semibold text-stone-800">{t('nav.myAccount')}</h2>
        </div>

        <form
          className="card-body grid gap-4 sm:grid-cols-2"
          onSubmit={handleSubmit((values) => saveProfile.mutate(values))}
        >
          <div>
            <label htmlFor="fullName" className="label">
              {t('people.fullName')}
            </label>
            <input id="fullName" className="input" {...register('fullName')} />
          </div>

          <div>
            <label htmlFor="phone" className="label">
              {t('people.phone')}
            </label>
            <input id="phone" type="tel" className="input" {...register('phone')} />
          </div>

          <div>
            <label htmlFor="locale" className="label">
              {t('common.language')}
            </label>
            <select id="locale" className="input" {...register('locale')}>
              <option value="en">English</option>
              <option value="ar">العربية</option>
            </select>
          </div>

          <div className="flex items-end sm:col-span-2">
            <button type="submit" className="btn-primary" disabled={isSubmitting}>
              {t('common.save')}
            </button>
          </div>
        </form>
      </section>

      {/* ---------- Password ---------- */}
      <section className="card mb-5">
        <div className="card-header">
          <h2 className="text-sm font-semibold text-stone-800">{t('auth.changePassword')}</h2>
          <Link to="/change-password" className="btn-secondary btn-sm">
            <KeyRound className="h-4 w-4" aria-hidden="true" />
            {t('auth.changePassword')}
          </Link>
        </div>
      </section>

      {/* ---------- Two-factor ---------- */}
      <section className="card">
        <div className="card-header">
          <div>
            <h2 className="text-sm font-semibold text-stone-800">{t('twoFactor.title')}</h2>
            <p className="text-xs text-stone-500">
              {user.twoFactorEnabled ? t('twoFactor.enabled') : t('twoFactor.disabled')}
            </p>
          </div>

          {user.twoFactorEnabled ? (
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => setIsDisableOpen(true)}
            >
              <ShieldOff className="h-4 w-4" aria-hidden="true" />
              {t('twoFactor.disable')}
            </button>
          ) : (
            <button
              type="button"
              className="btn-primary btn-sm"
              onClick={() => startTwoFactor.mutate()}
              disabled={startTwoFactor.isPending}
            >
              {startTwoFactor.isPending ? (
                <Spinner size="sm" />
              ) : (
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              )}
              {t('twoFactor.enable')}
            </button>
          )}
        </div>

        <div className="card-body">
          <p className="text-sm text-stone-600">{t('twoFactor.description')}</p>
        </div>
      </section>

      <EnrollmentModal
        enrollment={enrollment}
        onClose={() => setEnrollment(null)}
        onConfirmed={async (codes) => {
          setEnrollment(null);
          setBackupCodes(codes);
          await refreshUser();
        }}
      />

      <BackupCodesModal codes={backupCodes} onClose={() => setBackupCodes(null)} />

      <DisableModal
        isOpen={isDisableOpen}
        onClose={() => setIsDisableOpen(false)}
        onDisabled={async () => {
          setIsDisableOpen(false);
          await refreshUser();
        }}
      />
    </div>
  );
}

/** Step 1 + 2: scan the QR code, then prove it works. */
function EnrollmentModal({ enrollment, onClose, onConfirmed }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);

  const confirm = useMutation({
    mutationFn: () => post('/auth/2fa/confirm', { code }),
    onSuccess: (result) => onConfirmed(result.backupCodes),
    onError: (error) => toast.error(error.message),
  });

  return (
    <Modal
      isOpen={Boolean(enrollment)}
      onClose={onClose}
      title={t('twoFactor.scanTitle')}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => confirm.mutate()}
            disabled={code.length < 6 || confirm.isPending}
          >
            {t('auth.verify')}
          </button>
        </>
      }
    >
      {enrollment && (
        <div className="text-center">
          <p className="mb-3 text-sm text-stone-600">{t('twoFactor.scanHelp')}</p>

          {/* Data URL from the server — no extra request, no stored image. */}
          <img
            src={enrollment.qrCodeDataUrl}
            alt="Two-factor QR code"
            className="mx-auto mb-3 rounded-lg border border-surface-border"
            width={240}
            height={240}
          />

          <p className="mb-1 text-xs text-stone-500">{t('twoFactor.manualEntry')}</p>

          <div className="mb-4 flex items-center justify-center gap-2">
            <code className="break-all rounded bg-stone-100 px-2 py-1 font-mono text-xs">
              {enrollment.secret}
            </code>
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => {
                navigator.clipboard.writeText(enrollment.secret);
                setCopied(true);
              }}
              aria-label="Copy key"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>

          <label htmlFor="confirm-code" className="label text-start">
            {t('twoFactor.confirmPrompt')}
          </label>
          <input
            id="confirm-code"
            className="input text-center text-lg tracking-[0.3em]"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
            placeholder="000000"
          />
        </div>
      )}
    </Modal>
  );
}

/** Step 3: the recovery codes, shown exactly once. */
function BackupCodesModal({ codes, onClose }) {
  const { t } = useTranslation();

  return (
    <Modal
      isOpen={Boolean(codes)}
      onClose={onClose}
      title={t('twoFactor.backupTitle')}
      size="sm"
      footer={
        <button type="button" className="btn-primary" onClick={onClose}>
          {t('twoFactor.backupConfirm')}
        </button>
      }
    >
      <p className="mb-3 text-sm text-stone-600">{t('twoFactor.backupHelp')}</p>

      <ul className="grid grid-cols-2 gap-2">
        {(codes ?? []).map((code) => (
          <li
            key={code}
            className="rounded bg-stone-100 px-2 py-1.5 text-center font-mono text-sm"
          >
            {code}
          </li>
        ))}
      </ul>
    </Modal>
  );
}

/** Turning 2FA off requires the password — a briefly unlocked laptop is not enough. */
function DisableModal({ isOpen, onClose, onDisabled }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [password, setPassword] = useState('');

  const disable = useMutation({
    mutationFn: () => post('/auth/2fa/disable', { password }),
    onSuccess: () => {
      toast.success(t('twoFactor.disabled'));
      setPassword('');
      onDisabled();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('twoFactor.disable')}
      size="sm"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn-danger"
            onClick={() => disable.mutate()}
            disabled={!password || disable.isPending}
          >
            {t('twoFactor.disable')}
          </button>
        </>
      }
    >
      <label htmlFor="disable-password" className="label">
        {t('auth.password')}
      </label>
      <input
        id="disable-password"
        type="password"
        autoComplete="current-password"
        className="input"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
    </Modal>
  );
}
