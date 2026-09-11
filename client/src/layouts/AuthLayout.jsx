/**
 * =============================================================================
 *  Auth layout — login, invitation, password reset
 * =============================================================================
 *  A centred card on a plain background. No navigation: these pages are for
 *  people who are not signed in (or who must change their password first), and
 *  showing menu items they cannot use is only confusing.
 * =============================================================================
 */

import { Outlet } from 'react-router-dom';
import { LanguageToggle } from '@/components/LanguageToggle';
import { LrcLogo } from '@/components/LrcLogo';
import { useTranslation } from 'react-i18next';

export default function AuthLayout() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-screen flex-col bg-surface-muted">
      {/*
        The language toggle must be reachable BEFORE signing in: a volunteer who
        reads only Arabic has to be able to switch before reading the form.
      */}
      <div className="flex justify-end p-4">
        <LanguageToggle />
      </div>

      <main className="flex flex-1 items-start justify-center px-4 pb-12 sm:items-center sm:pb-24">
        <div className="w-full max-w-md">
          <div className="mb-6 flex flex-col items-center gap-3 text-center">
            <LrcLogo className="h-14 w-14" />

            <div>
              <h1 className="text-lg font-semibold text-stone-900">{t('common.appName')}</h1>
              <p className="text-sm text-stone-500">Lebanese Red Cross · الصليب الأحمر اللبناني</p>
            </div>
          </div>

          <div className="card p-6">
            <Outlet />
          </div>

          <p className="mt-6 text-center text-xs text-stone-400">
            {/* No year interpolation: a hard-coded year silently goes stale. */}
            {new Date().getFullYear()} · Saida 401
          </p>
        </div>
      </main>
    </div>
  );
}
