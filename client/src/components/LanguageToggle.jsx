/**
 * =============================================================================
 *  Language toggle
 * =============================================================================
 *  Two languages, so a toggle rather than a dropdown — one tap instead of
 *  three, which matters when the person reaching for it currently cannot read
 *  the interface.
 *
 *  Each option is labelled in ITS OWN language ("English" / "العربية"), never
 *  translated. Someone looking for Arabic is scanning for Arabic script; a
 *  button reading "Arabic" in English is exactly what they cannot read.
 * =============================================================================
 */

import { useTranslation } from 'react-i18next';
import { Languages } from 'lucide-react';

export function LanguageToggle({ compact = false }) {
  const { i18n, t } = useTranslation();

  const languages = [
    { code: 'en', label: 'English' },
    { code: 'ar', label: 'العربية' },
  ];

  return (
    <div
      className="inline-flex items-center gap-1 rounded-lg border border-surface-border bg-white p-0.5"
      role="group"
      aria-label={t('common.language')}
    >
      {compact && (
        <Languages className="ms-1.5 h-4 w-4 text-stone-400" aria-hidden="true" />
      )}

      {languages.map((language) => {
        const isActive = i18n.language === language.code;

        return (
          <button
            key={language.code}
            type="button"
            // changeLanguage triggers the 'languageChanged' listener in
            // lib/i18n.js, which sets <html dir> and flips the whole layout.
            onClick={() => i18n.changeLanguage(language.code)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              isActive ? 'bg-brand-600 text-white' : 'text-stone-600 hover:bg-stone-100'
            }`}
            // Tells a screen reader which one is currently selected.
            aria-pressed={isActive}
            lang={language.code}
          >
            {language.label}
          </button>
        );
      })}
    </div>
  );
}

export default LanguageToggle;
