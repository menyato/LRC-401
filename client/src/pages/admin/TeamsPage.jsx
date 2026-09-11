/**
 * =============================================================================
 *  Teams — the day squads
 * =============================================================================
 *  Membership matters as much as the team itself: being a TEAM_ADMIN of a team
 *  is what grants the "I can see my team's reports" data scope. So the row
 *  expands to show and edit the roster, which the generic CRUD page cannot do.
 * =============================================================================
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Users, ShieldCheck, X } from 'lucide-react';

import { get, put, del } from '@/lib/api';
import { useAuth } from '@/features/auth/AuthProvider';
import { useLocalised } from '@/hooks/useLocalised';
import { CrudPage } from '@/components/CrudPage';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';

/**
 * Day options, numbered by the JavaScript convention the database stores
 * (0 = Sunday … 6 = Saturday).
 *
 * The station runs Monday–Friday, so the working week is listed first and the
 * weekend after a separator — present but not the default expectation. The
 * weekend days stay selectable on purpose: teams are data, and the station may
 * add a weekend crew without anyone touching this file.
 *
 * "—" means the team is not tied to a weekday at all, which is how a training
 * cohort or a special-event crew is modelled. `dayOfWeek` is nullable for
 * exactly that reason.
 */
const DAYS = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 0, label: 'Sunday' },
  { value: '', label: '— No fixed day —' },
];

export default function TeamsPage() {
  const { t } = useTranslation();
  const L = useLocalised();
  const { can } = useAuth();

  const [membersTeam, setMembersTeam] = useState(null);

  const columns = [
    { key: 'nameEn', header: t('roles.roleName'), primary: true, render: (row) => L(row) },
    {
      key: 'dayOfWeek',
      header: 'Day',
      render: (row) =>
        row.dayOfWeek === null || row.dayOfWeek === undefined ? (
          <span className="text-stone-300">—</span>
        ) : (
          DAYS.find((day) => day.value === row.dayOfWeek)?.label
        ),
    },
    {
      key: 'members',
      header: t('people.users'),
      align: 'end',
      render: (row) => (
        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={(event) => {
            event.stopPropagation();
            setMembersTeam(row);
          }}
        >
          <Users className="h-4 w-4" aria-hidden="true" />
          {row._count?.memberships ?? 0}
        </button>
      ),
    },
  ];

  return (
    <>
      <CrudPage
        title={t('nav.teams')}
        queryKey="teams"
        url="/teams"
        permissions={{ read: 'team:read', manage: 'team:manage' }}
        columns={columns}
        fields={[
          {
            name: 'key',
            label: 'Key',
            required: true,
            immutable: true,
            help: 'Lowercase letters, numbers and underscores.',
          },
          { name: 'nameEn', label: `${t('roles.roleName')} (EN)`, required: true },
          { name: 'nameAr', label: `${t('roles.roleName')} (AR)`, required: true, dir: 'rtl' },
          { name: 'dayOfWeek', label: 'Day of the week', type: 'select', options: DAYS },
        ]}
        transform={(values) => ({
          ...values,
          // An empty <select> yields '' — the API expects null or an integer.
          dayOfWeek: values.dayOfWeek === '' ? null : Number(values.dayOfWeek),
        })}
      />

      <TeamMembersModal
        team={membersTeam}
        onClose={() => setMembersTeam(null)}
        canManage={can('team:manage')}
      />
    </>
  );
}

/** Roster dialog: who is in the team, and who leads it. */
function TeamMembersModal({ team, onClose, canManage }) {
  const { t } = useTranslation();
  const L = useLocalised();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [addUserId, setAddUserId] = useState('');
  const isOpen = Boolean(team);

  const { data: members = [], isLoading } = useQuery({
    queryKey: ['team-members', team?.id],
    queryFn: () => get(`/teams/${team.id}/members`),
    enabled: isOpen,
  });

  // limit is 100 — MAX_LIMIT on the server. Asking for 200 is rejected with a
  // 422, which left this dropdown silently empty (the same bug that broke the
  // shift-assignment crew pickers).
  const { data: users = [] } = useQuery({
    queryKey: ['users', 'picker'],
    queryFn: () => get('/users', { params: { limit: 100, status: 'ACTIVE' } }),
    enabled: isOpen && canManage,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['team-members', team.id] });
    queryClient.invalidateQueries({ queryKey: ['teams'] });
  };

  const setMember = useMutation({
    mutationFn: ({ userId, teamRole }) => put(`/teams/${team.id}/members/${userId}`, { teamRole }),
    onSuccess: () => {
      refresh();
      setAddUserId('');
    },
    onError: (error) => toast.error(error.message),
  });

  const removeMember = useMutation({
    mutationFn: (userId) => del(`/teams/${team.id}/members/${userId}`),
    onSuccess: refresh,
    onError: (error) => toast.error(error.message),
  });

  // Do not offer people who are already on the roster.
  const memberIds = new Set(members.map((member) => member.user.id));
  const available = users.filter((user) => !memberIds.has(user.id));

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={team ? L(team) : ''} size="lg">
      {canManage && (
        <div className="mb-4 flex gap-2">
          <select
            className="input"
            value={addUserId}
            onChange={(event) => setAddUserId(event.target.value)}
            aria-label={t('common.add')}
          >
            <option value="">—</option>
            {available.map((user) => (
              <option key={user.id} value={user.id}>
                {user.fullName}
              </option>
            ))}
          </select>

          <button
            type="button"
            className="btn-primary shrink-0"
            disabled={!addUserId || setMember.isPending}
            onClick={() => setMember.mutate({ userId: addUserId, teamRole: 'MEMBER' })}
          >
            {t('common.add')}
          </button>
        </div>
      )}

      {isLoading ? (
        <p className="py-6 text-center text-sm text-stone-500">{t('common.loading')}</p>
      ) : members.length === 0 ? (
        <p className="py-6 text-center text-sm text-stone-500">{t('common.noResults')}</p>
      ) : (
        <ul className="divide-y divide-surface-border">
          {members.map((member) => (
            <li key={member.user.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-stone-800">
                  {member.user.fullName}
                </p>
                <p className="truncate text-xs text-stone-400">{member.user.email}</p>
              </div>

              {canManage ? (
                <select
                  className="input w-auto text-xs"
                  value={member.teamRole}
                  onChange={(event) =>
                    setMember.mutate({ userId: member.user.id, teamRole: event.target.value })
                  }
                  aria-label={t('people.role')}
                >
                  <option value="MEMBER">{t('people.member')}</option>
                  <option value="TEAM_ADMIN">{t('people.teamAdmin')}</option>
                </select>
              ) : (
                <span className="text-xs text-stone-500">
                  {member.teamRole === 'TEAM_ADMIN' ? t('people.teamAdmin') : t('people.member')}
                </span>
              )}

              {member.teamRole === 'TEAM_ADMIN' && (
                <ShieldCheck
                  className="h-4 w-4 shrink-0 text-brand-600"
                  aria-label={t('people.teamAdmin')}
                />
              )}

              {canManage && (
                <button
                  type="button"
                  className="btn-ghost btn-sm text-status-critical"
                  onClick={() => removeMember.mutate(member.user.id)}
                  aria-label={t('common.delete')}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
