/**
 * =============================================================================
 *  View one equipment report
 * =============================================================================
 *  Shows the shortages FIRST, then the full answers.
 *
 *  Order matters: a team admin opening this at the start of a shift needs "what
 *  is missing on 472" in the first screenful. Making them scroll past ninety
 *  correct answers to find three problems is how a report stops being read.
 *
 *  The issue list is read from `summary.issues`, computed by the server when
 *  the report was submitted — so it reflects the thresholds AS THEY WERE that
 *  day, even if the super admin has since changed them.
 * =============================================================================
 */

import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { Eye, Printer, CheckCircle2 } from 'lucide-react';

import { get } from '@/lib/api';
import { useAuth } from '@/features/auth/AuthProvider';
import { useLocalised } from '@/hooks/useLocalised';
import { PageHeader } from '@/components/PageHeader';
import { StatusBadge, reportStatusOf } from '@/components/StatusBadge';
import { FullPageSpinner } from '@/components/Spinner';
import { FieldRenderer } from '@/features/reports/FieldRenderer';
import { ReviewAndRestockModal } from '@/features/reports/ReviewAndRestockModal';

export default function ReportViewPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const L = useLocalised();
  const { can } = useAuth();
  const queryClient = useQueryClient();

  const [isReviewOpen, setIsReviewOpen] = useState(false);

  const { data: report, isLoading, error } = useQuery({
    queryKey: ['submission', id],
    queryFn: () => get(`/submissions/${id}`),
  });


  if (isLoading) return <FullPageSpinner />;

  if (error) {
    return (
      <div className="card p-6 text-center text-sm text-status-critical" role="alert">
        {error.message}
      </div>
    );
  }

  const issues = report.summary?.issues ?? [];
  const counts = report.summary?.counts ?? { ok: 0, warn: 0, critical: 0, missing: 0 };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={`${report.vehicle.code} · ${dayjs(report.shiftDate).format('D MMM YYYY')}`}
        description={`${L(report.team)} · ${report.submittedBy?.fullName ?? ''}`}
      >
        <StatusBadge status={reportStatusOf(report)} />

        <button
          type="button"
          className="btn-secondary btn-sm no-print"
          onClick={() => window.print()}
        >
          <Printer className="h-4 w-4" aria-hidden="true" />
        </button>

        {can('submission:review') && report.status === 'SUBMITTED' && (
          <button
            type="button"
            className="btn-primary btn-sm no-print"
            onClick={() => setIsReviewOpen(true)}
          >
            <Eye className="h-4 w-4" aria-hidden="true" />
            {t('reports.review')}
          </button>
        )}
      </PageHeader>

      {/* ---------- Shortages, first ---------- */}
      <section className="card mb-5" aria-labelledby="issues-heading">
        <div className="card-header">
          <h2 id="issues-heading" className="text-sm font-semibold text-stone-800">
            {t('reports.issues')}
          </h2>
          <span className="text-xs text-stone-400 tabular-nums">
            {counts.critical + counts.missing} / {counts.warn} / {counts.ok}
          </span>
        </div>

        <div className="card-body">
          {issues.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-status-ok">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              {t('reports.noIssues')}
            </p>
          ) : (
            <ul className="divide-y divide-surface-border">
              {issues.map((issue) => (
                <li
                  key={`${issue.field}-${issue.row ?? ''}`}
                  className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-stone-800">
                      {L.isArabic && issue.labelAr ? issue.labelAr : issue.label}
                    </p>
                    {issue.section && <p className="text-xs text-stone-400">{issue.section}</p>}
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-sm tabular-nums text-stone-600">
                      {issue.kind === 'NOT_ANSWERED'
                        ? t('reports.notAnswered')
                        : issue.expected !== null && issue.expected !== undefined
                          ? t('reports.expectedShort', {
                              expected: issue.expected,
                              value: issue.value,
                            })
                          : issue.value}
                    </span>
                    <StatusBadge status={issue.severity} iconOnly />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {report.reviewNote && (
        <div className="card mb-5 p-4">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-stone-500">
            {t('reports.reviewNote')}
          </p>
          <p className="text-sm text-stone-700">{report.reviewNote}</p>
          <p className="mt-1 text-xs text-stone-400">
            {report.reviewedBy?.fullName} · {dayjs(report.reviewedAt).format('D MMM YYYY HH:mm')}
          </p>
        </div>
      )}

      {/* ---------- The full answers, read-only ---------- */}
      {report.template.sections.map((section) => (
        <section key={section.id} className="card mb-4">
          <div className="card-header">
            <h2 className="text-sm font-semibold text-stone-800">{L(section, 'title')}</h2>
          </div>
          <div className="card-body space-y-3">
            {section.fields.map((field) => (
              <FieldRenderer
                key={field.id}
                field={field}
                value={report.answers[field.key]}
                onChange={() => {}}
                // A submitted report is a historical record. Editing it would
                // let a shortage the admin has already acted on be quietly
                // "corrected" after the fact.
                readOnly
              />
            ))}
          </div>
        </section>
      ))}

      {/* ---------- Review + restock dialog ---------- */}
      {/*
        Reviewing is where a shortage becomes actual work. The modal lets the
        reviewer tick what should be put right, which raises a job on the
        restock board — see features/reports/ReviewAndRestockModal.jsx.
      */}
      {isReviewOpen && (
        <ReviewAndRestockModal
          report={report}
          isOpen={isReviewOpen}
          onClose={() => setIsReviewOpen(false)}
          onReviewed={() => {
            setIsReviewOpen(false);
            queryClient.invalidateQueries({ queryKey: ['submission', id] });
            queryClient.invalidateQueries({ queryKey: ['restock-board'] });
          }}
        />
      )}
    </div>
  );
}
