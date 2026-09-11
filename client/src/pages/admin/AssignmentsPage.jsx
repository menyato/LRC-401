/**
 * =============================================================================
 *  Shift assignments — "who is on which vehicle, on which day"
 * =============================================================================
 *  Load-bearing, despite being a simple screen: an assignment is what
 *  AUTHORISES a normal EMT to file the equipment report for a vehicle. Without
 *  one the API refuses the submission (see canSubmitForAssignment).
 * =============================================================================
 */

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { Plus, Trash2 } from 'lucide-react';

import { get, post, del } from '@/lib/api';
import { usePaginatedQuery } from '@/hooks/usePaginatedQuery';
import { useAuth } from '@/features/auth/AuthProvider';
import { useLocalised } from '@/hooks/useLocalised';
import { PageHeader } from '@/components/PageHeader';
import { DataTable } from '@/components/DataTable';
import { Modal, ConfirmDialog } from '@/components/Modal';
import { useToast } from '@/components/Toast';

export default function AssignmentsPage() {
  const { t } = useTranslation();
  const L = useLocalised();
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [deleting, setDeleting] = useState(null);
  // Default to the coming week — the roster people actually care about.
  const [dateFrom, setDateFrom] = useState(dayjs().format('YYYY-MM-DD'));
  const [dateTo, setDateTo] = useState(dayjs().add(7, 'day').format('YYYY-MM-DD'));

  const list = usePaginatedQuery({
    key: 'assignments',
    url: '/assignments',
    filters: { dateFrom, dateTo },
  });

  const remove = useMutation({
    mutationFn: (id) => del(`/assignments/${id}`),
    onSuccess: () => {
      toast.success(t('common.delete'));
      setDeleting(null);
      queryClient.invalidateQueries({ queryKey: ['assignments'] });
    },
    onError: (error) => toast.error(error.message),
  });

  const columns = [
    {
      key: 'shiftDate',
      header: t('reports.shiftDate'),
      primary: true,
      render: (row) => (
        <span className="tabular-nums">{dayjs(row.shiftDate).format('ddd D MMM')}</span>
      ),
    },
    {
      key: 'vehicle',
      header: t('reports.vehicle'),
      render: (row) => `${row.vehicle.code} · ${L(row.vehicle)}`,
    },
    { key: 'team', header: t('reports.team'), render: (row) => L(row.team), hideOnMobile: true },
    {
      key: 'crew',
      header: 'Crew',
      render: (row) =>
        [row.firstPerson?.fullName, row.secondPerson?.fullName].filter(Boolean).join(' · ') || (
          <span className="text-stone-300">—</span>
        ),
    },
    ...(can('assignment:manage')
      ? [
          {
            key: 'actions',
            header: '',
            align: 'end',
            render: (row) => (
              <button
                type="button"
                className="btn-ghost btn-sm text-status-critical"
                onClick={() => setDeleting(row)}
                aria-label={t('common.delete')}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            ),
          },
        ]
      : []),
  ];

  return (
    <div>
      <PageHeader title={t('nav.assignments')}>
        {can('assignment:manage') && (
          <button type="button" className="btn-primary" onClick={() => setIsFormOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t('common.add')}
          </button>
        )}
      </PageHeader>

      <div className="card">
        <div className="card-header flex-wrap gap-2">
          <input
            type="date"
            className="input w-auto"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
            aria-label="From"
          />
          <input
            type="date"
            className="input w-auto"
            value={dateTo}
            onChange={(event) => setDateTo(event.target.value)}
            aria-label="To"
          />
        </div>

        <DataTable
          columns={columns}
          rows={list.rows}
          meta={list.meta}
          isLoading={list.isLoading}
          error={list.error}
          onPageChange={list.setPage}
        />
      </div>

      <AssignmentFormModal isOpen={isFormOpen} onClose={() => setIsFormOpen(false)} />

      <ConfirmDialog
        isOpen={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => remove.mutate(deleting.id)}
        title={t('common.delete')}
        message="Delete this shift assignment?"
        isPending={remove.isPending}
      />
    </div>
  );
}

function AssignmentFormModal({ isOpen, onClose }) {
  const { t } = useTranslation();
  const L = useLocalised();
  const toast = useToast();
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm();

  useEffect(() => {
    if (isOpen) {
      reset({
        shiftDate: dayjs().format('YYYY-MM-DD'),
        teamId: '',
        vehicleId: '',
        firstPersonId: '',
        secondPersonId: '',
        notes: '',
      });
    }
  }, [isOpen, reset]);

  /** Drives which people can be rostered — see the members query below. */
  const selectedTeamId = watch('teamId');

  const { data: teams = [] } = useQuery({
    queryKey: ['teams', 'all'],
    queryFn: () => get('/teams', { params: { limit: 50 } }),
    enabled: isOpen,
  });

  const { data: vehicles = [] } = useQuery({
    queryKey: ['vehicles', 'active'],
    queryFn: () => get('/vehicles', { params: { limit: 100 } }),
    enabled: isOpen,
  });

  /**
   * The crew pickers list the SELECTED TEAM'S MEMBERS, not every user.
   *
   * This replaced a `GET /users?limit=200` that was broken twice over:
   *
   *   1. The API caps `limit` at 100, so 200 was rejected with 422. The query
   *      failed, `users` stayed an empty array, and BOTH crew dropdowns were
   *      silently empty for everyone — including the super admin. With nobody
   *      selectable, no assignment could name a person; with no assignment
   *      naming them, an EMT's report was refused with NOT_ASSIGNED. That is
   *      the "he does not show in assign vehicle, so the report is not saved"
   *      chain, end to end.
   *
   *   2. `/users` requires `user:read`, which the built-in Team Admin role does
   *      not have — rostering is their job, but the endpoint was not theirs to
   *      call. Even with the limit fixed they would have got a 403.
   *
   * `/teams/:id/members` needs only `team:read`, which they do have, and it is
   * the better list anyway: you cannot accidentally roster somebody from
   * another team onto your shift.
   */
  const { data: members = [], isLoading: isLoadingMembers } = useQuery({
    queryKey: ['team-members', selectedTeamId],
    queryFn: () => get(`/teams/${selectedTeamId}/members`),
    enabled: isOpen && Boolean(selectedTeamId),
  });

  /** Only people who can actually sign in and file a report. */
  const crew = members
    .map((membership) => membership.user)
    .filter((user) => user.status === 'ACTIVE');

  const save = useMutation({
    mutationFn: (values) =>
      post('/assignments', {
        ...values,
        // Empty <select> values are '' — the API wants null.
        firstPersonId: values.firstPersonId || null,
        secondPersonId: values.secondPersonId || null,
        notes: values.notes?.trim() || null,
      }),
    onSuccess: () => {
      toast.success(t('common.save'));
      queryClient.invalidateQueries({ queryKey: ['assignments'] });
      onClose();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('nav.assignments')}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            form="assignment-form"
            className="btn-primary"
            disabled={save.isPending}
          >
            {t('common.save')}
          </button>
        </>
      }
    >
      <form
        id="assignment-form"
        onSubmit={handleSubmit((values) => save.mutate(values))}
        noValidate
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="a-date" className="label">
              {t('reports.shiftDate')} <span className="text-status-critical">*</span>
            </label>
            <input
              id="a-date"
              type="date"
              className="input"
              {...register('shiftDate', { required: t('common.required') })}
            />
            {errors.shiftDate && <p className="form-error">{errors.shiftDate.message}</p>}
          </div>

          <div>
            <label htmlFor="a-team" className="label">
              {t('reports.team')} <span className="text-status-critical">*</span>
            </label>
            <select
              id="a-team"
              className="input"
              {...register('teamId', { required: t('common.required') })}
            >
              <option value="">—</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {L(team)}
                </option>
              ))}
            </select>
            {errors.teamId && <p className="form-error">{errors.teamId.message}</p>}
          </div>

          <div>
            <label htmlFor="a-vehicle" className="label">
              {t('reports.vehicle')} <span className="text-status-critical">*</span>
            </label>
            <select
              id="a-vehicle"
              className="input"
              {...register('vehicleId', { required: t('common.required') })}
            >
              <option value="">—</option>
              {vehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.code} · {L(vehicle)}
                </option>
              ))}
            </select>
            {errors.vehicleId && <p className="form-error">{errors.vehicleId.message}</p>}
          </div>

          {/*
            Both crew pickers are disabled until a team is chosen, and say why.
            Previously they were simply empty, which looked like "there are no
            users" rather than "pick a team first".
          */}
          <div>
            <label htmlFor="a-first" className="label">
              {t('reports.firstPerson')}
            </label>
            <select
              id="a-first"
              className="input"
              disabled={!selectedTeamId || isLoadingMembers}
              {...register('firstPersonId')}
            >
              <option value="">—</option>
              {crew.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.fullName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="a-second" className="label">
              {t('reports.secondPerson')}
            </label>
            <select
              id="a-second"
              className="input"
              disabled={!selectedTeamId || isLoadingMembers}
              {...register('secondPersonId')}
            >
              <option value="">—</option>
              {crew.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.fullName}
                </option>
              ))}
            </select>
          </div>

          {/*
            An empty team is the most likely reason someone cannot find the
            person they expect, so say so explicitly and point at the fix.
          */}
          {selectedTeamId && !isLoadingMembers && crew.length === 0 && (
            <p className="sm:col-span-2 rounded-lg bg-status-warnBg p-3 text-xs text-status-warn">
              This team has no active members yet. Add them under{' '}
              <strong>{t('nav.teams')}</strong> first — only a team&apos;s own members can be
              rostered on its shifts.
            </p>
          )}

          <div className="sm:col-span-2">
            <label htmlFor="a-notes" className="label">
              {t('common.notes')}
            </label>
            <input id="a-notes" className="input" {...register('notes')} />
          </div>
        </div>
      </form>
    </Modal>
  );
}
