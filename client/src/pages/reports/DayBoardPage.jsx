/**
 * =============================================================================
 *  Day board — "the summary of the car status for that day"
 * =============================================================================
 *  The team admin's main screen. One card per vehicle, coloured by severity,
 *  with the shortages listed directly on the card.
 *
 *  THE KEY DESIGN POINT: vehicles with NO report are shown too, marked
 *  "missing". The question this screen exists to answer is "which vehicles have
 *  not been checked?" — a list of only the reports that were filed cannot
 *  answer it, and that is the failure mode of a paper process.
 * =============================================================================
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';

import { get } from '@/lib/api';
import { useAuth } from '@/features/auth/AuthProvider';
import { useLocalised } from '@/hooks/useLocalised';
import { PageHeader, StatTile } from '@/components/PageHeader';
import { StatusBadge } from '@/components/StatusBadge';
import { FullPageSpinner } from '@/components/Spinner';

/** Card border colour per status — the at-a-glance signal. */
const CARD_TONE = {
  CRITICAL: 'border-status-critical/40 bg-status-criticalBg',
  WARN: 'border-status-warn/40 bg-status-warnBg',
  OK: 'border-status-ok/30 bg-status-okBg',
  DRAFT: 'border-surface-border bg-white',
  MISSING: 'border-dashed border-stone-300 bg-stone-50',
};

export default function DayBoardPage() {
  const { t } = useTranslation();
  const L = useLocalised();
  const { teams } = useAuth();

  const [date, setDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [teamId, setTeamId] = useState(teams.adminOf[0] ?? '');

  const { data: allTeams = [] } = useQuery({
    queryKey: ['teams', 'all'],
    queryFn: () => get('/teams', { params: { limit: 50 } }),
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ['day-board', teamId, date],
    queryFn: () => get('/submissions/board', { params: { teamId: teamId || undefined, date } }),
  });

  /** Steps the date by whole days. */
  const shiftDate = (days) => setDate(dayjs(date).add(days, 'day').format('YYYY-MM-DD'));

  return (
    <div>
      <PageHeader
        title={t('reports.boardTitle')}
        description={t('reports.boardSubtitle', { date: dayjs(date).format('ddd D MMM YYYY') })}
      />

      {/* ---------- Filters, in one row above the content ---------- */}
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="board-team" className="label">
            {t('reports.team')}
          </label>
          <select
            id="board-team"
            className="input min-w-[12rem]"
            value={teamId}
            onChange={(event) => setTeamId(event.target.value)}
          >
            <option value="">{t('common.all')}</option>
            {allTeams.map((team) => (
              <option key={team.id} value={team.id}>
                {L(team)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="board-date" className="label">
            {t('common.date')}
          </label>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => shiftDate(-1)}
              aria-label="Previous day"
            >
              <ChevronLeft className="h-4 w-4 flip-in-rtl" aria-hidden="true" />
            </button>

            <input
              id="board-date"
              type="date"
              className="input w-auto"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />

            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => shiftDate(1)}
              aria-label="Next day"
            >
              <ChevronRight className="h-4 w-4 flip-in-rtl" aria-hidden="true" />
            </button>
          </div>
        </div>

        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={() => setDate(dayjs().format('YYYY-MM-DD'))}
        >
          <Calendar className="h-4 w-4" aria-hidden="true" />
          Today
        </button>
      </div>

      {isLoading && <FullPageSpinner />}

      {error && (
        <div className="card p-6 text-center text-sm text-status-critical" role="alert">
          {error.message}
        </div>
      )}

      {data && (
        <>
          {/* Totals across the whole day. */}
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label={t('status.ok')} value={data.totals.ok} tone="ok" />
            <StatTile
              label={t('status.warn')}
              value={data.totals.warn}
              tone={data.totals.warn > 0 ? 'warn' : 'default'}
            />
            <StatTile
              label={t('status.critical')}
              value={data.totals.critical}
              tone={data.totals.critical > 0 ? 'critical' : 'default'}
            />
            <StatTile
              label={t('reports.noReportYet')}
              value={data.totals.missing}
              tone={data.totals.missing > 0 ? 'warn' : 'default'}
            />
          </div>

          {/* One card per vehicle. */}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data.rows.map((row) => (
              <article
                key={row.vehicle.id}
                className={`rounded-card border p-4 ${CARD_TONE[row.status]}`}
              >
                <header className="mb-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="font-semibold text-stone-900">{row.vehicle.code}</h2>
                    <p className="truncate text-xs text-stone-500">{L(row.vehicle)}</p>
                  </div>

                  <StatusBadge status={row.status} />
                </header>

                {/* Who was on it. */}
                {row.assignment && (
                  <p className="mb-2 text-xs text-stone-600">
                    {[row.assignment.firstPerson?.fullName, row.assignment.secondPerson?.fullName]
                      .filter(Boolean)
                      .join(' · ') || '—'}
                  </p>
                )}

                {/* The shortages, pre-computed by the server at submit time. */}
                {row.topIssues.length > 0 && (
                  <ul className="mb-3 space-y-1">
                    {row.topIssues.map((issue) => (
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
                          {issue.value ?? '—'}
                          {issue.expected !== null && issue.expected !== undefined
                            ? ` / ${issue.expected}`
                            : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {row.submission ? (
                  <Link
                    to={`/reports/${row.submission.id}`}
                    className="text-xs font-medium text-brand-600 hover:underline"
                  >
                    {t('common.edit')} →
                  </Link>
                ) : (
                  <p className="text-xs text-stone-400">{t('reports.noReportYet')}</p>
                )}
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
