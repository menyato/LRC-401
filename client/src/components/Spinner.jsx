/**
 * =============================================================================
 *  Loading indicators
 * =============================================================================
 */

import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * Inline spinner, for use inside a button or beside a label.
 * @param {{size?: 'sm'|'md'|'lg', className?: string}} props
 */
export function Spinner({ size = 'md', className = '' }) {
  const sizes = { sm: 'h-4 w-4', md: 'h-5 w-5', lg: 'h-8 w-8' };

  return (
    <Loader2
      className={`animate-spin ${sizes[size]} ${className}`}
      // Decorative: the surrounding element carries the accessible label, so a
      // screen reader should not announce "image".
      aria-hidden="true"
    />
  );
}

/** Fills the viewport. Used as the Suspense fallback for lazy routes. */
export function FullPageSpinner() {
  const { t } = useTranslation();

  return (
    <div
      className="flex min-h-[60vh] w-full items-center justify-center"
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col items-center gap-3 text-stone-400">
        <Spinner size="lg" />
        <span className="text-sm">{t('common.loading')}</span>
      </div>
    </div>
  );
}

/**
 * A grey block roughly the shape of the content that is loading.
 *
 * Preferred over a spinner for lists and cards: the page does not jump when the
 * real content arrives, because the space was already reserved. That matters on
 * a phone, where a shifting layout causes mis-taps.
 */
export function Skeleton({ className = '' }) {
  return <div className={`animate-pulse rounded bg-stone-200 ${className}`} aria-hidden="true" />;
}

/** Placeholder rows matching the shape of a data table. */
export function TableSkeleton({ rows = 5, columns = 4 }) {
  return (
    <div className="space-y-2 p-4" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex gap-3">
          {Array.from({ length: columns }).map((_, columnIndex) => (
            <Skeleton
              key={columnIndex}
              // The first column is usually a name and is wider — matching that
              // makes the placeholder read as the table rather than as stripes.
              className={`h-8 ${columnIndex === 0 ? 'w-1/3' : 'flex-1'}`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export default Spinner;
