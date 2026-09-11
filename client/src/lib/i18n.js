/**
 * =============================================================================
 *  Internationalisation (English / Arabic)
 * =============================================================================
 *  The station operates in both languages, and the equipment report itself is
 *  bilingual. Two things follow from that:
 *
 *  1. UI CHROME is translated here — buttons, navigation, validation messages.
 *  2. DOMAIN CONTENT is NOT. Item names, form questions and team names are
 *     stored in the database with `nameEn` / `nameAr` columns, because the
 *     super admin creates them at runtime and no translation file could know
 *     them in advance. Use the `useLocalised()` helper below to pick the right
 *     column for the current language.
 *
 *  Switching to Arabic also sets `dir="rtl"` on <html>, which makes the browser
 *  mirror the whole layout. Combined with Tailwind's logical properties
 *  (`ms-*`, `pe-*`, `text-start`), we get RTL support without a second stylesheet.
 * =============================================================================
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { en } from '@/locales/en';
import { ar } from '@/locales/ar';

/** Remembered per browser so a volunteer does not re-pick their language daily. */
const STORAGE_KEY = 'lrc401.language';

function detectInitialLanguage() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'ar') return saved;
  } catch {
    // Private browsing can throw on localStorage access. Fall through to the
    // browser language rather than crashing the app before it renders.
  }

  return navigator.language?.startsWith('ar') ? 'ar' : 'en';
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ar: { translation: ar },
  },
  lng: detectInitialLanguage(),
  // Show the English string rather than a raw key if an Arabic entry is missing.
  fallbackLng: 'en',
  interpolation: {
    // React already escapes everything it renders; escaping again would turn
    // an apostrophe in a name into "&#39;".
    escapeValue: false,
  },
});

/**
 * Applies the language to the document.
 * `dir` is what actually flips the layout, and `lang` tells the browser which
 * font and hyphenation rules to use.
 */
export function applyLanguage(language) {
  document.documentElement.lang = language;
  document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';

  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Not being able to remember the choice is a minor inconvenience, not an
    // error worth surfacing.
  }
}

// Apply on load, and again whenever the language changes.
applyLanguage(i18n.language);
i18n.on('languageChanged', applyLanguage);

export default i18n;
