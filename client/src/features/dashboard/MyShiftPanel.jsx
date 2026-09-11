/**
 * =============================================================================
 *  "My shift" — the responder's dashboard
 * =============================================================================
 *  What an EMT or first responder sees instead of station statistics: the
 *  vehicle they are rostered on, whether its report is done, and what was
 *  short on it.
 *
 *  Report counts, shortage league tables and trend charts are management
 *  information. They are not sent to this role at all (the API gates them on
 *  `stats:view`), so there is nothing here to hide — only this to show.
 *
 *  The shortages ARE shown, deliberately. Knowing "Airways — Red: 0 of 1" is
 *  what lets the crew chase it before they go out, and it is the only part of
 *  the report that matters once it has been filed.
 * =============================================================================
 */

import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { Truck, CalendarDays, CheckCircle2, FileEdit, ClipboardList } from 'lucide-react';

import { useLocalised } from '@/hooks/useLocalised';
import { StatusBadge } from '@/components/StatusBadge';

export function MyShiftPanel({ shift }) {
  const { t } = useTranslation();
  const L = useLocalised();

  // --- Not rostered on anything ---------------------------------------------
  if (!shift.hasAnyAssignment) {
    return (
      <section className="card mb-8 p-6 text-center" aria-labelledby="my-shift-heading">
        <CalendarDays className="mx-auto mb-3 h-8 w-8 text-stone-300" aria-hidden="true" />
        <h2 id="my-shift-heading" className="text-sm font-semibold text-stone-800">
          {t('nav.assignments')}
        </h2>
        <p className="mt-1 text-sm text-stone-500">
          You are not rostered on a vehicle at the moment.
        </p>
        <p className="mt-1 text-xs text-stone-400">
          Your team admin assigns crews. Once you are on one, its equipment report appears here.
        </p>
      </section>
    );
  }

  return (
    <section className="mb-8" aria-labelledby="my-shift-heading">
      <h2 id="my-shift-heading" className="mb-3 text-sm font-semibold text-stone-700">
        {t('nav.assignments')}
      </h2>

      <div className="grid gap-3 md:grid-cols-2">
        {shift.assignments.map((assignment) => {
          const report = assignment.report;

          /**
           * Real shortages only — something was counted and came up short.
           *
           * `NOT_ANSWERED` entries are excluded: they mean "this question has no
           * answer yet", which is progress information, not a missing item. A
           * submitted report cannot contain them (the API refuses a submission
           * with required questions blank), so this filter only ever affects
           * drafts — but it keeps the two concepts from being conflated.
           */
          const shortages = (report?.issues ?? []).filter(
            (issue) => issue.kind !== 'NOT_ANSWERED',
          );

          // MISSING until a report exists, then its severity.
          const status = !report
            ? 'MISSING'
            : report.status === 'DRAFT'
              ? 'DRAFT'
              : report.criticalCount > 0
                ? 'CRITICAL'
                : report.warnCount > 0
                  ? 'WARN'
                  : 'OK';

          return (
            <article
              key={assignment.id}
              className={`card p-4 ${
                // Today's shift is the one that matters right now, so it is
                // outlined. A week of identical cards buries it otherwise.
                assignment.isToday ? 'ring-2 ring-brand-600 ring-offset-2' : ''
              }`}
            >
              <header className="mb-2 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 font-semibold text-stone-900">
                    <Truck className="h-4 w-4 shrink-0 text-stone-400" aria-hidden="true" />
                    {assignment.vehicle.code} · {L(assignment.vehicle)}
                  </p>
                  <p className="text-xs text-stone-500">
                    {dayjs(assignment.shiftDate).format('ddd D MMM YYYY')}
                    {assignment.isToday && (
                      <span className="ms-1.5 font-medium text-brand-600">· Today</span>
                    )}
                  </p>
                </div>

                <StatusBadge status={status} />
              </header>

              {/* Who else is on the crew. */}
              <p className="mb-3 text-xs text-stone-500">
                {[assignment.firstPerson?.fullName, assignment.secondPerson?.fullName]
                  .filter(Boolean)
                  .join(' · ') || '—'}
              </p>

              {/*
                A DRAFT is judged on PROGRESS, not on shortages.

                The threshold engine flags every unanswered required question as
                critical, which is right for a submitted report but useless on a
                half-filled one: a form that is 5% done would list eighty
                "issues" that only mean "you have not got there yet". So a draft
                shows how far along it is, and the shortages appear once it has
                actually been submitted.
              */}
              {report?.status === 'DRAFT' && (
                <div className="mb-3">
                  <div className="mb-1 flex items-baseline justify-between text-xs">
                    <span className="text-stone-500">
                      {t('reports.completeness', { percent: report.completeness })}
                    </span>
                  </div>
                  <div
                    className="h-1.5 overflow-hidden rounded-full bg-stone-100"
                    role="progressbar"
                    aria-valuenow={report.completeness}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div
                      className="h-full rounded-full bg-brand-600 transition-all"
                      style={{ width: `${report.completeness}%` }}
                    />
                  </div>
                </div>
              )}

              {/* --- What a SUBMITTED report found --- */}
              {report && report.status !== 'DRAFT' && (
                shortages.length === 0 ? (
                  <p className="flex items-center gap-1.5 text-sm text-status-ok">
                    <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {t('reports.noIssues')}
                  </p>
                ) : (
                  <>
                    <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-stone-500">
                      {t('reports.issues')}
                    </p>

                    <ul className="mb-3 space-y-1">
                      {/* The top few only — the full list is on the report. */}
                      {shortages.slice(0, 6).map((issue) => (
                        <li
                          key={`${issue.field}-${issue.row ?? ''}`}
                          className="flex items-baseline justify-between gap-2 text-xs"
                        >
                          <span className="min-w-0 truncate text-stone-700">
                            {L.isArabic && issue.labelAr ? issue.labelAr : issue.label}
                          </span>
                          <span
                            className={`shrink-0 tabular-nums ${
                              issue.severity === 'CRITICAL'
                                ? 'text-status-critical'
                                : 'text-status-warn'
                            }`}
                          >
                            {/*
                              "0 / 2" reads as found-of-expected. Both halves are
                              omitted when absent rather than printing "null",
                              which is what an earlier version did.
                            */}
                            {issue.value ?? '—'}
                            {issue.expected !== null && issue.expected !== undefined
                              ? ` / ${issue.expected}`
                              : ''}
                          </span>
                        </li>
                      ))}
                    </ul>

                    {shortages.length > 6 && (
                      <p className="mb-2 text-xs text-stone-400">
                        +{shortages.length - 6} more
                      </p>
                    )}
                  </>
                )
              )}

              {/* --- What to do next --- */}
              {!report && (
                <Link to="/reports/new" className="btn-primary btn-sm w-full">
                  <ClipboardList className="h-4 w-4" aria-hidden="true" />
                  {t('nav.fillReport')}
                </Link>
              )}

              {report?.status === 'DRAFT' && (
                <Link to="/reports/new" className="btn-secondary btn-sm w-full">
                  <FileEdit className="h-4 w-4" aria-hidden="true" />
                  {t('reports.continueDraft')}
                </Link>
              )}

              {report && report.status !== 'DRAFT' && (
                <Link
                  to={`/reports/${report.id}`}
                  className="text-xs font-medium text-brand-600 hover:underline"
                >
                  {t('common.view')} →
                </Link>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

export default MyShiftPanel;
