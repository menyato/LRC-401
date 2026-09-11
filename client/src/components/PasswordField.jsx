/**
 * =============================================================================
 *  Password field
 * =============================================================================
 *  A password input with a show/hide toggle and a live strength meter.
 *
 *  The rules shown here MIRROR the server's `passwordSchema`
 *  (server/src/utils/password.js). They are guidance only — the server is the
 *  authority and rejects anything that fails, regardless of what this component
 *  displayed. Showing them live simply stops the user from submitting three
 *  times to discover them one at a time.
 * =============================================================================
 */

import { useState } from 'react';
import { Eye, EyeOff, Check, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** The same rules as the server's passwordSchema. */
const RULES = [
  { key: 'length', test: (value) => value.length >= 10, label: 'At least 10 characters' },
  { key: 'lower', test: (value) => /[a-z]/.test(value), label: 'A lowercase letter' },
  { key: 'upper', test: (value) => /[A-Z]/.test(value), label: 'An uppercase letter' },
  { key: 'digit', test: (value) => /[0-9]/.test(value), label: 'A number' },
];

/**
 * @param {object} props
 * @param {string}  props.id
 * @param {string}  props.label
 * @param {string}  props.value            Controlled — needed for the live meter.
 * @param {object}  props.registration     react-hook-form's register(...) result.
 * @param {string}  [props.error]
 * @param {boolean} [props.showStrength]   Show the rule checklist.
 * @param {string}  [props.autoComplete]
 */
export function PasswordField({
  id,
  label,
  value = '',
  registration,
  error,
  showStrength = false,
  autoComplete = 'new-password',
}) {
  const { t } = useTranslation();
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>

      <div className="relative">
        <input
          id={id}
          type={isVisible ? 'text' : 'password'}
          autoComplete={autoComplete}
          className={`input pe-11 ${error ? 'input-error' : ''}`}
          aria-invalid={Boolean(error)}
          aria-describedby={showStrength ? `${id}-rules` : undefined}
          {...registration}
        />

        <button
          type="button"
          onClick={() => setIsVisible((current) => !current)}
          className="absolute end-1 top-1/2 -translate-y-1/2 rounded p-2 text-stone-400 hover:text-stone-600"
          // The label describes the ACTION, not the state — "Show password" is
          // what happens when you press it.
          aria-label={isVisible ? 'Hide password' : 'Show password'}
          // Excluded from tab order: sighted users can click it, and keyboard
          // users tabbing through a form do not want a stop between every field.
          tabIndex={-1}
        >
          {isVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>

      {error && <p className="form-error">{error}</p>}

      {showStrength && (
        <ul id={`${id}-rules`} className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
          {RULES.map((rule) => {
            const passed = rule.test(value);

            return (
              <li
                key={rule.key}
                className={`flex items-center gap-1.5 text-xs ${
                  passed ? 'text-status-ok' : 'text-stone-400'
                }`}
              >
                {/*
                  A tick or a cross, not just colour — the same reasoning as the
                  status badges.
                */}
                {passed ? (
                  <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                ) : (
                  <X className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                )}
                <span>{rule.label}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default PasswordField;
