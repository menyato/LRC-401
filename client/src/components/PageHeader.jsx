/**
 * =============================================================================
 *  Page header
 * =============================================================================
 *  Title, optional description, and a slot for the page's primary action.
 *  Used on every screen so headings, spacing and the action position are
 *  identical throughout — the kind of consistency that is easy to lose when
 *  each page writes its own <h1>.
 * =============================================================================
 */

export function PageHeader({ title, description, children }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        {/*
          One <h1> per page. Screen-reader users navigate by heading, and a page
          with none (or three) is genuinely hard to move around.
        */}
        <h1 className="truncate text-xl font-semibold text-stone-900 sm:text-2xl">{title}</h1>

        {description && <p className="mt-1 text-sm text-stone-500">{description}</p>}
      </div>

      {/*
        Actions come second in the DOM so keyboard and screen-reader users reach
        the heading first, but `sm:flex-row` puts them on the right visually.
        On mobile they stack full-width beneath the title, which keeps them
        comfortably tappable.
      */}
      {children && <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

/**
 * A labelled statistic — the dashboard's building block.
 *
 * @param {object} props
 * @param {string} props.label
 * @param {string|number} props.value
 * @param {React.ComponentType} [props.icon]
 * @param {string} [props.hint]   Small text under the value.
 * @param {'default'|'ok'|'warn'|'critical'} [props.tone]
 */
export function StatTile({ label, value, icon: Icon, hint, tone = 'default' }) {
  const tones = {
    default: 'text-stone-900',
    ok: 'text-status-ok',
    warn: 'text-status-warn',
    critical: 'text-status-critical',
  };

  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</p>
        {Icon && <Icon className="h-4 w-4 shrink-0 text-stone-300" aria-hidden="true" />}
      </div>

      {/*
        `tabular-nums` keeps digits the same width, so a row of tiles does not
        jitter when a value changes from 9 to 10.
      */}
      <p className={`mt-2 text-2xl font-semibold tabular-nums ${tones[tone]}`}>{value}</p>

      {hint && <p className="mt-1 text-xs text-stone-400">{hint}</p>}
    </div>
  );
}

export default PageHeader;
