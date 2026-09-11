/**
 * =============================================================================
 *  Dynamic field renderer
 * =============================================================================
 *  Renders one question of an equipment report from its database definition.
 *  The super admin creates these in the form builder; this component is what
 *  makes them appear on a phone with no code change.
 *
 *  DESIGN DECISION — big tap targets, not dropdowns.
 *  A count question is rendered as a ROW OF BUTTONS ("0 1 2 3 4"), not a
 *  <select>. A dropdown costs three interactions (open, scroll, choose) and
 *  hides the options; a button row is one tap and the whole range is visible.
 *  Over ~90 questions, on a phone, with gloves on, that difference is the
 *  entire usability of the form.
 *
 *  Every option button is at least 44px — the accessible touch-target minimum.
 * =============================================================================
 */

import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { useLocalised } from '@/hooks/useLocalised';

/**
 * @param {object} props
 * @param {object}   props.field     FormField row from the API.
 * @param {*}        props.value     Current answer.
 * @param {Function} props.onChange  (newValue) => void
 * @param {string}   [props.error]
 * @param {boolean}  [props.readOnly]
 */
export function FieldRenderer({ field, value, onChange, error, readOnly = false }) {
  const { t } = useTranslation();
  const L = useLocalised();

  const label = L(field, 'label');
  const help = L(field, 'help');

  // A note carries no answer — render it as prose, not as a form control.
  if (field.type === 'SECTION_NOTE') {
    return (
      <div className="rounded-lg bg-stone-50 p-3 text-sm text-stone-600">
        <p className="font-medium">{label}</p>
        {help && <p className="mt-1 text-xs">{help}</p>}
      </div>
    );
  }

  return (
    <fieldset
      className={`rounded-lg border p-3 ${
        error ? 'border-status-critical bg-status-criticalBg' : 'border-surface-border bg-white'
      }`}
    >
      <legend className="px-1 text-sm font-medium text-stone-800">
        {label}
        {field.isRequired && (
          <span className="ms-1 text-status-critical" aria-label={t('common.required')}>
            *
          </span>
        )}
      </legend>

      {help && <p className="mb-2 text-xs text-stone-500">{help}</p>}

      <FieldControl
        field={field}
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        label={label}
      />

      {error && (
        <p className="mt-2 flex items-center gap-1 text-xs text-status-critical" role="alert">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
          {error}
        </p>
      )}
    </fieldset>
  );
}

/** Dispatches on field type. Each branch is a small, self-contained control. */
function FieldControl({ field, value, onChange, readOnly, label }) {
  const L = useLocalised();
  const config = field.config ?? {};

  switch (field.type) {
    // -------------------------------------------------------------------------
    //  GRID — the matrix question. Most of the paper form uses this shape.
    // -------------------------------------------------------------------------
    case 'GRID': {
      const rows = config.rows ?? [];
      const answers = typeof value === 'object' && value !== null ? value : {};

      return (
        <div className="space-y-2">
          {rows.map((row) => {
            const rowValue = answers[row.key];
            const expected = row.threshold?.expected;

            // Live feedback while filling in: a responder sees immediately that
            // this row is short, rather than discovering it after submitting.
            const isShort =
              expected !== undefined && rowValue !== undefined && Number(rowValue) < expected;

            return (
              <div
                key={row.key}
                className="flex flex-col gap-1.5 border-b border-surface-border pb-2 last:border-0 last:pb-0
                           sm:flex-row sm:items-center sm:justify-between sm:gap-3"
              >
                <div className="min-w-0 flex-1">
                  <span className="text-sm text-stone-700">{L(row, 'label')}</span>
                  {expected !== undefined && (
                    <span
                      className={`ms-2 text-xs ${isShort ? 'text-status-critical' : 'text-stone-400'}`}
                    >
                      / {expected}
                    </span>
                  )}
                </div>

                <ChoiceButtons
                  choices={config.choices ?? [0, 1, 2]}
                  value={rowValue}
                  onChange={(next) => onChange({ ...answers, [row.key]: next })}
                  readOnly={readOnly}
                  ariaLabel={`${label} — ${L(row, 'label')}`}
                />
              </div>
            );
          })}
        </div>
      );
    }

    // -------------------------------------------------------------------------
    //  NUMBER_CHOICE — "pick one of 0 / 1 / 2 / 5+"
    // -------------------------------------------------------------------------
    case 'NUMBER_CHOICE': {
      const expected = config.threshold?.expected;
      const isShort = expected !== undefined && value !== undefined && Number(value) < expected;

      return (
        <div className="flex items-center justify-between gap-3">
          {expected !== undefined && (
            <span className={`text-xs ${isShort ? 'text-status-critical' : 'text-stone-400'}`}>
              / {expected}
            </span>
          )}

          <ChoiceButtons
            choices={config.choices ?? [0, 1]}
            value={value}
            onChange={onChange}
            readOnly={readOnly}
            ariaLabel={label}
          />
        </div>
      );
    }

    // -------------------------------------------------------------------------
    //  SINGLE_SELECT — qualitative choice, may carry its own severity
    // -------------------------------------------------------------------------
    case 'SINGLE_SELECT': {
      const options = config.options ?? [];

      return (
        <div className="flex flex-wrap gap-2">
          {options.map((option) => {
            const isSelected = value === option.value;

            // A chosen option that is itself a problem (e.g. "Betadine: empty
            // to quarter") is tinted so the responder sees the consequence of
            // their own answer.
            const severityClass =
              isSelected && option.severity === 'CRITICAL'
                ? 'border-status-critical bg-status-criticalBg text-status-critical'
                : isSelected && option.severity === 'WARN'
                  ? 'border-status-warn bg-status-warnBg text-status-warn'
                  : isSelected
                    ? 'border-brand-600 bg-brand-subtle text-brand-strong'
                    : 'border-surface-border bg-white text-stone-700 hover:bg-stone-50';

            return (
              <button
                key={option.value}
                type="button"
                disabled={readOnly}
                onClick={() => onChange(option.value)}
                className={`min-h-[2.75rem] rounded-lg border px-3 text-sm ${severityClass}
                            disabled:opacity-60`}
                aria-pressed={isSelected}
              >
                {L(option, 'label')}
              </button>
            );
          })}
        </div>
      );
    }

    // -------------------------------------------------------------------------
    //  NUMBER — free entry, e.g. oxygen pressure
    // -------------------------------------------------------------------------
    case 'NUMBER':
      return (
        <div className="flex items-center gap-2">
          <input
            type="number"
            className="input max-w-[8rem]"
            value={value ?? ''}
            min={config.min}
            max={config.max}
            disabled={readOnly}
            // Shows the numeric keypad on a phone.
            inputMode="numeric"
            onChange={(event) =>
              onChange(event.target.value === '' ? undefined : Number(event.target.value))
            }
            aria-label={label}
          />
          {config.unit && <span className="text-sm text-stone-500">{config.unit}</span>}
          {config.threshold?.expected !== undefined && (
            <span className="text-xs text-stone-400">/ {config.threshold.expected}</span>
          )}
        </div>
      );

    // -------------------------------------------------------------------------
    case 'BOOLEAN':
      return (
        <ChoiceButtons
          choices={[
            { value: true, label: 'Yes' },
            { value: false, label: 'No' },
          ]}
          value={value}
          onChange={onChange}
          readOnly={readOnly}
          ariaLabel={label}
        />
      );

    // -------------------------------------------------------------------------
    case 'DATE':
      return (
        <input
          type="date"
          className="input max-w-[12rem]"
          value={value ?? ''}
          disabled={readOnly}
          onChange={(event) => onChange(event.target.value)}
          aria-label={label}
        />
      );

    // -------------------------------------------------------------------------
    case 'MULTI_SELECT': {
      const options = config.options ?? [];
      const selected = Array.isArray(value) ? value : [];

      return (
        <div className="flex flex-wrap gap-2">
          {options.map((option) => {
            const isSelected = selected.includes(option.value);

            return (
              <button
                key={option.value}
                type="button"
                disabled={readOnly}
                onClick={() =>
                  onChange(
                    isSelected
                      ? selected.filter((entry) => entry !== option.value)
                      : [...selected, option.value],
                  )
                }
                className={`min-h-[2.75rem] rounded-lg border px-3 text-sm ${
                  isSelected
                    ? 'border-brand-600 bg-brand-subtle text-brand-strong'
                    : 'border-surface-border bg-white text-stone-700 hover:bg-stone-50'
                } disabled:opacity-60`}
                aria-pressed={isSelected}
              >
                {L(option, 'label')}
              </button>
            );
          })}
        </div>
      );
    }

    // -------------------------------------------------------------------------
    case 'TEXT':
    default:
      return (
        <input
          type="text"
          className="input"
          value={value ?? ''}
          disabled={readOnly}
          onChange={(event) => onChange(event.target.value)}
          aria-label={label}
        />
      );
  }
}

/**
 * The row of count buttons.
 *
 * Rendered as a radiogroup rather than N independent buttons so a screen reader
 * announces "2 of 5 selected" instead of reading five unrelated buttons.
 */
function ChoiceButtons({ choices, value, onChange, readOnly, ariaLabel }) {
  // Accepts both plain values ([0,1,2]) and {value,label} objects.
  const normalised = choices.map((choice) =>
    typeof choice === 'object' ? choice : { value: choice, label: String(choice) },
  );

  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={ariaLabel}>
      {normalised.map((choice) => {
        const isSelected = value === choice.value;

        return (
          <button
            key={String(choice.value)}
            type="button"
            role="radio"
            aria-checked={isSelected}
            disabled={readOnly}
            // Tapping the selected value again clears it, which is the only way
            // to un-answer an optional question without reloading the form.
            onClick={() => onChange(isSelected ? undefined : choice.value)}
            className={`min-h-[2.75rem] min-w-[2.75rem] rounded-lg border px-3 text-sm font-medium
                        transition-colors disabled:opacity-60 ${
                          isSelected
                            ? 'border-brand-600 bg-brand-600 text-pure-white'
                            : 'border-surface-border bg-white text-stone-700 hover:bg-stone-50'
                        }`}
          >
            {choice.label}
          </button>
        );
      })}
    </div>
  );
}

export default FieldRenderer;
