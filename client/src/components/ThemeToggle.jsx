/**
 * =============================================================================
 *  Theme toggle
 * =============================================================================
 *  One button that cycles light → dark → follow-device.
 *
 *  A single cycling button rather than three radio options: the header has very
 *  little room on a phone, and this is not a setting anyone changes often enough
 *  to deserve a segmented control. The icon shows the CURRENT state, and the
 *  tooltip/aria-label says what pressing it will do next — so the button is
 *  never ambiguous even though it has three states.
 * =============================================================================
 */

import { useTranslation } from 'react-i18next';
import { Sun, Moon, MonitorSmartphone } from 'lucide-react';

import { useTheme } from '@/features/theme/ThemeProvider';

const ICONS = { light: Sun, dark: Moon, system: MonitorSmartphone };

/** What the button will switch to — used for the label, so it is honest. */
const NEXT = { light: 'dark', dark: 'system', system: 'light' };

export function ThemeToggle({ className = '' }) {
  const { t } = useTranslation();
  const { theme, cycleTheme } = useTheme();

  const Icon = ICONS[theme];

  return (
    <button
      type="button"
      onClick={cycleTheme}
      className={`rounded-lg p-2 transition-colors hover:bg-brand-700/60 ${className}`}
      // Names the current state AND the next one, so a screen-reader user knows
      // both where they are and what will happen.
      aria-label={`${t(`theme.${theme}`)} — ${t('theme.switchTo', { next: t(`theme.${NEXT[theme]}`) })}`}
      title={`${t(`theme.${theme}`)} — ${t('theme.switchTo', { next: t(`theme.${NEXT[theme]}`) })}`}
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}

export default ThemeToggle;
