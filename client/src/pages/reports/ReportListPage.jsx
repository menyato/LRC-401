/**
 * =============================================================================
 *  Equipment report list
 * =============================================================================
 *  One screen for three audiences. The API applies the caller's data scope, so
 *  an EMT sees their own reports, a team admin sees their teams', and a
 *  station-wide auditor sees everything — from the same request.
 * =============================================================================
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, Link } from 'react-router-dom';
import dayjs from 'dayjs';
import { Plus } from 'lucide-react';

import { usePaginatedQuery } from '@/hooks/usePaginatedQuery';
import { useAuth } from '@/features/auth/AuthProvider';
import { useLocalised } from '@/hooks/useLocalised';
import { PageHeader } from '@/components/PageHeader';
import { DataTable } from '@/components/DataTable';
import { StatusBadge, reportStatusOf } from '@/components/StatusBadge';

export default function ReportListPage() {
  const { t } = useTranslation();
  const L = useLocalised();
  const navigate = useNavigate();
  const { can } = useAuth();

  const [status, setStatus] = useState('');
  const [criticalOnly, setCriticalOnly] = useState(false);

  const list = usePaginatedQuery({
    key: 'submissions',
    url: '/submissions',
    filters: { status, criticalOnly: criticalOnly ? 'true' : undefined },
  });

  const columns = [
    {
      key: 'shiftDate',
      header: t('reports.shiftDate'),
      primary: true,
      render: (row) => (
        <span className="tabular-nums">{dayjs(row.shiftDate).format('D MMM YYYY')}</span>
      ),
    },
    {
      key: 'vehicle',
      header: t('reports.vehicle'),
      render: (row) => `${row.vehicle.code} · ${L(row.vehicle)}`,
    },
    { key: 'team', header: t('reports.team'), render: (row) => L(row.team), hideOnMobile: true },
    {
      key: 'status',
      header: t('reports.status'),
      render: (row) => <StatusBadge status={reportStatusOf(row)} />,
    },
    {
      key: 'issues',
      header: t('reports.issues'),
      align: 'end',
      render: (row) =>
        row.criticalCount + row.warnCount === 0 ? (
          <span className="text-stone-400">—</span>
        ) : (
          <span className="tabular-nums">
            {row.criticalCount > 0 && (
              <span className="font-medium text-status-critical">{row.criticalCount}</span>
            )}
            {row.criticalCount > 0 && row.warnCount > 0 && <span className="text-stone-300"> / </span>}
            {row.warnCount > 0 && <span className="text-status-warn">{row.warnCount}</span>}
          </span>
        ),
    },
    {
      key: 'submittedBy',
      header: t('reports.submittedBy'),
      render: (row) => row.submittedBy?.fullName ?? '—',
      hideOnMobile: true,
    },
  ];

  return (
    <div>
      <PageHeader title={t('reports.title')}>
        {can('submission:create') && (
          <Link to="/reports/new" className="btn-primary">
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t('reports.newReport')}
          </Link>
        )}
      </PageHeader>

      <div className="card">
        <div className="card-header flex-wrap gap-2">
          <select
            className="input w-auto"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            aria-label={t('reports.status')}
          >
            <option value="">{t('common.all')}</option>
            <option value="DRAFT">{t('status.draft')}</option>
            <option value="SUBMITTED">{t('status.submitted')}</option>
            <option value="REVIEWED">{t('status.reviewed')}</option>
          </select>

          <label className="flex items-center gap-2 text-sm text-stone-600">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-surface-border text-brand-600"
              checked={criticalOnly}
              onChange={(event) => setCriticalOnly(event.target.checked)}
            />
            {t('status.critical')}
          </label>
        </div>

        <DataTable
          columns={columns}
          rows={list.rows}
          meta={list.meta}
          isLoading={list.isLoading}
          error={list.error}
          onPageChange={list.setPage}
          onRowClick={(row) => navigate(`/reports/${row.id}`)}
        />
      </div>
    </div>
  );
}
