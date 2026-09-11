/**
 * =============================================================================
 *  Report forms
 * =============================================================================
 *  Lists every template and version. Versions matter here and are shown
 *  explicitly: a submission records which version it was filled against, so
 *  "v2 published, v3 draft" is real, load-bearing information rather than
 *  bookkeeping.
 * =============================================================================
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { Plus, Upload } from 'lucide-react';

import { post } from '@/lib/api';
import { usePaginatedQuery } from '@/hooks/usePaginatedQuery';
import { useAuth } from '@/features/auth/AuthProvider';
import { useLocalised } from '@/hooks/useLocalised';
import { PageHeader } from '@/components/PageHeader';
import { DataTable } from '@/components/DataTable';
import { useToast } from '@/components/Toast';

const STATUS_STYLES = {
  PUBLISHED: 'badge-ok',
  DRAFT: 'badge-warn',
  ARCHIVED: 'badge-missing',
};

export default function FormBuilderListPage() {
  const { t } = useTranslation();
  const L = useLocalised();
  const navigate = useNavigate();
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  const list = usePaginatedQuery({ key: 'templates', url: '/forms/templates' });

  const publish = useMutation({
    mutationFn: (id) => post(`/forms/templates/${id}/publish`),
    onSuccess: () => {
      toast.success(t('forms.published'));
      queryClient.invalidateQueries({ queryKey: ['templates'] });
    },
    onError: (error) => toast.error(error.message),
  });

  const create = useMutation({
    mutationFn: () =>
      post('/forms/templates', {
        // A minimal starting point; everything is renamed in the builder.
        key: `form_${Date.now()}`,
        titleEn: 'New report form',
        titleAr: 'نموذج تقرير جديد',
        scope: 'AMBULANCE',
        sections: [],
      }),
    onSuccess: (template) => navigate(`/forms/${template.id}`),
    onError: (error) => toast.error(error.message),
  });

  const columns = [
    {
      key: 'title',
      header: t('forms.templates'),
      primary: true,
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-stone-900">{L(row, 'title')}</p>
          <p className="text-xs text-stone-400">
            {row.key} · {t('forms.version', { version: row.version })}
          </p>
        </div>
      ),
    },
    { key: 'scope', header: 'Scope' },
    {
      key: 'status',
      header: t('reports.status'),
      render: (row) => (
        <span className={STATUS_STYLES[row.status]}>{t(`forms.${row.status.toLowerCase()}`)}</span>
      ),
    },
    {
      key: 'submissions',
      header: t('nav.reports'),
      align: 'end',
      hideOnMobile: true,
      render: (row) => <span className="tabular-nums">{row._count?.submissions ?? 0}</span>,
    },
    {
      key: 'updatedAt',
      header: 'Updated',
      hideOnMobile: true,
      render: (row) => dayjs(row.updatedAt).format('D MMM YYYY'),
    },
    ...(can('form.template:manage')
      ? [
          {
            key: 'actions',
            header: '',
            align: 'end',
            render: (row) =>
              row.status === 'DRAFT' ? (
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={(event) => {
                    event.stopPropagation();
                    publish.mutate(row.id);
                  }}
                  disabled={publish.isPending}
                >
                  <Upload className="h-4 w-4" aria-hidden="true" />
                  {t('forms.publish')}
                </button>
              ) : null,
          },
        ]
      : []),
  ];

  return (
    <div>
      <PageHeader title={t('forms.templates')}>
        {can('form.template:manage') && (
          <button
            type="button"
            className="btn-primary"
            onClick={() => create.mutate()}
            disabled={create.isPending}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t('forms.newTemplate')}
          </button>
        )}
      </PageHeader>

      <div className="card">
        <DataTable
          columns={columns}
          rows={list.rows}
          meta={list.meta}
          isLoading={list.isLoading}
          error={list.error}
          onPageChange={list.setPage}
          onRowClick={
            can('form.template:manage') ? (row) => navigate(`/forms/${row.id}`) : undefined
          }
        />
      </div>
    </div>
  );
}
