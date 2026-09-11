/**
 * =============================================================================
 *  Status badge
 * =============================================================================
 *  Renders the severity of an equipment report, a stock level or an account.
 *
 *  ACCESSIBILITY: every badge carries an ICON and TEXT, never colour alone.
 *  About 1 in 12 men has some degree of red-green colour blindness, and this
 *  badge is what tells a team admin whether an ambulance is short of equipment.
 *  Encoding that in hue only would make the most important signal in the app
 *  invisible to a meaningful share of its users.
 * =============================================================================
 */

import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  CircleDashed,
  FileEdit,
  Send,
  Eye,
  UserCheck,
  UserX,
  Mail,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * One entry per status the app can display.
 * `className` maps to the badge component classes in styles/index.css.
 */
const STATUS_CONFIG = {
  // Report severity
  OK: { icon: CheckCircle2, className: 'badge-ok', labelKey: 'status.ok' },
  WARN: { icon: AlertTriangle, className: 'badge-warn', labelKey: 'status.warn' },
  CRITICAL: { icon: XCircle, className: 'badge-critical', labelKey: 'status.critical' },
  MISSING: { icon: CircleDashed, className: 'badge-missing', labelKey: 'status.missing' },

  // Submission lifecycle
  DRAFT: { icon: FileEdit, className: 'badge-missing', labelKey: 'status.draft' },
  SUBMITTED: { icon: Send, className: 'badge-ok', labelKey: 'status.submitted' },
  REVIEWED: { icon: Eye, className: 'badge-ok', labelKey: 'status.reviewed' },

  // Account status
  ACTIVE: { icon: UserCheck, className: 'badge-ok', labelKey: 'status.active' },
  SUSPENDED: { icon: UserX, className: 'badge-critical', labelKey: 'status.suspended' },
  INVITED: { icon: Mail, className: 'badge-warn', labelKey: 'status.invited' },
};

/**
 * @param {object} props
 * @param {keyof STATUS_CONFIG} props.status
 * @param {string}  [props.label]      Overrides the translated label.
 * @param {number}  [props.count]      Appended in brackets, e.g. "Critical (3)".
 * @param {boolean} [props.iconOnly]   Hides the text on very narrow screens.
 */
export function StatusBadge({ status, label, count, iconOnly = false }) {
  const { t } = useTranslation();

  // An unknown status should still render something readable rather than
  // crashing — data can arrive from a newer API than this build knows about.
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.MISSING;
  const Icon = config.icon;
  const text = label ?? t(config.labelKey);

  return (
    <span className={config.className}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />

      {/*
        When iconOnly, the text is still in the DOM for screen readers — it is
        only visually hidden. Removing it would leave an unlabelled icon.
      */}
      <span className={iconOnly ? 'sr-only' : ''}>
        {text}
        {count !== undefined && ` (${count})`}
      </span>
    </span>
  );
}

/**
 * Derives the badge for a report row.
 * Kept here so the list, the board and the detail page cannot disagree about
 * what "critical" looks like.
 */
export function reportStatusOf(submission) {
  if (!submission) return 'MISSING';
  if (submission.status === 'DRAFT') return 'DRAFT';
  if (submission.criticalCount > 0) return 'CRITICAL';
  if (submission.warnCount > 0) return 'WARN';
  return 'OK';
}

export default StatusBadge;
