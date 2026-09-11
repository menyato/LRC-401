/**
 * =============================================================================
 *  Threshold editor — "how many should be on the vehicle?"
 * =============================================================================
 *  WHAT WAS WRONG BEFORE
 *
 *  The old editor showed three bare number inputs — `expected`, `warnBelow`,
 *  `criticalBelow` — with no indication of how they related. To set a rule you
 *  had to already know that "below warn is amber, below critical is red, and
 *  critical must not exceed warn". That is a puzzle, not a setting, and it made
 *  the single most important thing the form builder does feel difficult.
 *
 *  WHAT THIS DOES INSTEAD
 *
 *  ONE question — "how many are required?" — and a LIVE PREVIEW showing exactly
 *  what each possible answer would produce:
 *
 *      0 red   1 amber   2 green   3 green
 *
 *  The preview is the important half. It turns an abstract rule into something
 *  you can read at a glance and check against what you meant, without saving
 *  the form and filing a test report to find out.
 *
 *  The two fine-tuning numbers still exist, behind "Advanced", for the rare case
 *  that needs them. Most questions never will.
 * =============================================================================
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';

/**
 * Grades a value the same way the server does.
 * Kept identical to `grade()` in server/src/services/threshold.service.js — the
 * preview would be a lie if the two disagreed.
 */
function grade(value, threshold) {
  if (!threshold) return 'OK';

  const { warnBelow, criticalBelow } = threshold;

  if (criticalBelow !== undefined && criticalBelow !== null && value < criticalBelow) {
    return 'CRITICAL';
  }
  if (warnBelow !== undefined && warnBelow !== null && value < warnBelow) return 'WARN';
  return 'OK';
}

const SWATCH = {
  OK: 'bg-status-okBg text-status-ok border-status-ok/30',
  WARN: 'bg-status-warnBg text-status-warn border-status-warn/30',
  CRITICAL: 'bg-status-criticalBg text-status-critical border-status-critical/30',
};

/**
 * @param {object}   props
 * @param {object}   [props.threshold]  { expected, warnBelow, criticalBelow }
 * @param {Function} props.onChange     Receives the new threshold, or undefined
 *                                      when the rule is switched off.
 * @param {Array}    [props.choices]    The answers this question offers, so the
 *                                      preview shows the real options rather
 *                                      than an invented 0–4.
 * @param {string}   [props.label]
 * @param {boolean}  [props.compact]    Tighter layout, for grid rows.
 */
export function ThresholdEditor({ threshold, onChange, choices, label, compact = false }) {
  const { t } = useTranslation();
  const [showAdvanced, setShowAdvanced] = useState(false);

  const isOn = Boolean(threshold);
  const expected = threshold?.expected ?? '';

  /**
   * Setting "required" drives the other two automatically.
   *
   * The rule almost everyone wants is "N is fine, fewer than N is a warning,
   * none at all is critical". Deriving it means one number does the job, and
   * the advanced fields exist only to depart from that default.
   */
  const setExpected = (raw) => {
    if (raw === '') {
      onChange(undefined);
      return;
    }

    const value = Math.max(0, Number(raw) || 0);

    onChange({
      expected: value,
      // Anything below the required count is at least a warning.
      warnBelow: value,
      // Nothing at all is critical. For a question that only ever expects one,
      // "below 1" and "below expected" coincide, which is correct.
      criticalBelow: Math.min(1, value),
    });
  };

  const patch = (changes) => onChange({ ...(threshold ?? {}), ...changes });

  /** The answers to preview. Falls back to 0–3 for a free-number question. */
  const previewValues = (choices?.length ? choices : [0, 1, 2, 3])
    .map((choice) =>
      typeof choice === 'number' ? choice : Number.parseInt(String(choice).replace('+', ''), 10),
    )
    .filter((value) => Number.isFinite(value))
    .slice(0, 8);

  return (
    <div className={compact ? '' : 'rounded-lg bg-stone-50 p-2.5'}>
      {label && <p className="mb-1.5 text-xs font-medium text-stone-600">{label}</p>}

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label text-xs">{t('forms.requiredCount')}</label>
          <input
            type="number"
            min="0"
            className="input w-24"
            placeholder={t('forms.noRule')}
            value={expected}
            onChange={(event) => setExpected(event.target.value)}
          />
        </div>

        {/* --- Live preview: what each answer would produce --- */}
        {isOn && (
          <div className="min-w-0">
            <p className="label text-xs">{t('forms.preview')}</p>
            <div className="flex flex-wrap gap-1">
              {previewValues.map((value) => {
                const verdict = grade(value, threshold);

                return (
                  <span
                    key={value}
                    className={`rounded border px-2 py-1 text-xs tabular-nums ${SWATCH[verdict]}`}
                    title={t(`status.${verdict.toLowerCase()}`)}
                  >
                    {value}
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {isOn && (
        <>
          {/* Says the rule in words, so it can be checked without decoding colours. */}
          <p className="mt-2 text-xs text-stone-500">
            {t('forms.ruleSummary', {
              expected: threshold.expected ?? 0,
              warn: threshold.warnBelow ?? 0,
              critical: threshold.criticalBelow ?? 0,
            })}
          </p>

          <button
            type="button"
            className="mt-1.5 flex items-center gap-1 text-xs text-brand-600 hover:underline"
            onClick={() => setShowAdvanced((open) => !open)}
          >
            {showAdvanced ? (
              <ChevronDown className="h-3 w-3" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-3 w-3 flip-in-rtl" aria-hidden="true" />
            )}
            {t('forms.advancedThreshold')}
          </button>

          {showAdvanced && (
            <div className="mt-2 grid grid-cols-2 gap-2 border-s-2 border-stone-200 ps-3">
              <div>
                <label className="label text-xs">{t('forms.warnBelow')}</label>
                <input
                  type="number"
                  min="0"
                  className="input"
                  value={threshold.warnBelow ?? ''}
                  onChange={(event) =>
                    patch({
                      warnBelow:
                        event.target.value === '' ? undefined : Number(event.target.value),
                    })
                  }
                />
              </div>
              <div>
                <label className="label text-xs">{t('forms.criticalBelow')}</label>
                <input
                  type="number"
                  min="0"
                  className="input"
                  value={threshold.criticalBelow ?? ''}
                  onChange={(event) =>
                    patch({
                      criticalBelow:
                        event.target.value === '' ? undefined : Number(event.target.value),
                    })
                  }
                />
              </div>

              {/*
                The server rejects this combination (it would make the amber band
                unreachable), so warn here rather than letting them discover it
                on save.
              */}
              {threshold.criticalBelow > threshold.warnBelow && (
                <p className="col-span-2 text-xs text-status-critical">
                  {t('forms.criticalAboveWarn')}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default ThresholdEditor;
