/**
 * =============================================================================
 *  useLocalised — picking the right language column for DATABASE content
 * =============================================================================
 *  UI chrome is translated by i18next from locales/en.js and ar.js.
 *
 *  Domain content is different: item names, form questions, team names and
 *  vehicle names are created by the super admin at runtime and stored in the
 *  database as `nameEn` / `nameAr` (or `titleEn` / `labelAr`, …). No translation
 *  file can contain them.
 *
 *  This hook is how every component reads those pairs, so the fallback rule is
 *  written once:
 *
 *      Arabic requested and present  ->  Arabic
 *      otherwise                     ->  English
 *
 *  The fallback matters: most item names have an English value and only some
 *  have Arabic. Falling back keeps the interface usable rather than showing
 *  blanks where a name should be.
 * =============================================================================
 */

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

export function useLocalised() {
  const { i18n } = useTranslation();
  const isArabic = i18n.language === 'ar';

  /**
   * @param {object} record   Any object with `<base>En` / `<base>Ar` fields.
   * @param {string} [base]   Field prefix — 'name', 'title', 'label', …
   * @returns {string}
   *
   * @example
   *   const L = useLocalised();
   *   L(item)                  // item.nameAr  ?? item.nameEn
   *   L(section, 'title')      // section.titleAr ?? section.titleEn
   */
  const localise = useCallback(
    (record, base = 'name') => {
      if (!record) return '';

      const arabic = record[`${base}Ar`];
      const english = record[`${base}En`];

      return (isArabic && arabic) || english || '';
    },
    [isArabic],
  );

  return Object.assign(localise, { isArabic, language: i18n.language });
}

export default useLocalised;
