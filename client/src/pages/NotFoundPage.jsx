/**
 * =============================================================================
 *  404
 * =============================================================================
 *  Rendered inside the app layout, so the navigation stays available — a dead
 *  end with no way back is the worst version of this page.
 * =============================================================================
 */

import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MapPinOff } from 'lucide-react';

export default function NotFoundPage() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
      <MapPinOff className="h-10 w-10 text-stone-300" aria-hidden="true" />

      <div>
        <h1 className="text-lg font-semibold text-stone-900">{t('errors.notFound')}</h1>
        <p className="mt-1 text-sm text-stone-500">
          The page you were looking for does not exist.
        </p>
      </div>

      <Link to="/" className="btn-primary">
        {t('nav.dashboard')}
      </Link>
    </div>
  );
}
