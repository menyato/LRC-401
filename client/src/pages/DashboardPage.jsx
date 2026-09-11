/**
 * =============================================================================
 *  Dashboard
 * =============================================================================
 *  The landing screen. What it shows depends on the viewer's permissions,
 *  because the API only returns the sections they may see — an EMT gets their
 *  own report figures, an equipment admin also gets stock, the super admin gets
 *  everything.
 *
 *  FORM CHOICES (deliberate):
 *    • Headline counts are STAT TILES, not charts. A single number is read
 *      fastest as a number; drawing one bar to represent "12 reports" adds
 *      decoration and removes precision.
 *    • "Most frequent shortages" IS a chart — it is a ranked magnitude
 *      comparison across many labels, which is exactly what a horizontal bar
 *      chart is for. Horizontal, not vertical, because the labels are long
 *      bilingual phrases ("Airways — Red") that would be unreadable rotated.
 * =============================================================================
 */

import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  ClipboardList,
  AlertTriangle,
  XCircle,
  FileEdit,
  Boxes,
  CalendarClock,
  Users,
  Mail,
  ArrowRight,
} from 'lucide-react';

import { get } from '@/lib/api';
import { useAuth } from '@/features/auth/AuthProvider';
import { PageHeader, StatTile } from '@/components/PageHeader';
import { FullPageSpinner } from '@/components/Spinner';
import { ShortagesChart } from '@/features/dashboard/ShortagesChart';
import { MyShiftPanel } from '@/features/dashboard/MyShiftPanel';
import { FleetStatusPanel } from '@/features/dashboard/FleetStatusPanel';

const PERIOD_DAYS = 7;

export default function DashboardPage() {
  const { t } = useTranslation();
  const { user, can } = useAuth();

  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard', PERIOD_DAYS],
    queryFn: () => get('/dashboard/overview', { params: { days: PERIOD_DAYS } }),
  });

  if (isLoading) return <FullPageSpinner />;

  if (error) {
    return (
      <div className="card p-6 text-center text-sm text-status-critical" role="alert">
        {error.message}
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={t('dashboard.title')}
        description={t('dashboard.welcome', { name: user.fullName })}
      />

      {/* ================= FLEET STATUS ================= */}
      {/*
        First on the page, for everyone who can see vehicles. "Is the fleet
        ready?" is the question this dashboard exists to answer, and it should
        not be below a fold or behind a click.
      */}
      {can('vehicle:read') && <FleetStatusPanel />}

      {/* ================= MY SHIFT (responders) ================= */}
      {/*
        What a responder gets instead of station statistics: the vehicle they
        are on, and what was short on it. The API decides which of the two
        blocks to send based on `stats:view` — this is not a hidden panel, the
        data simply is not returned to them.
      */}
      {data.myShift && <MyShiftPanel shift={data.myShift} />}

      {/* ================= EQUIPMENT REPORTS ================= */}
      {data.reports && (
        <section className="mb-8" aria-labelledby="reports-heading">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 id="reports-heading" className="text-sm font-semibold text-stone-700">
              {t('nav.reports')}
            </h2>
            <span className="text-xs text-stone-400">
              {t('dashboard.lastDays', { days: PERIOD_DAYS })}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              label={t('dashboard.reportsFiled')}
              value={data.reports.submitted}
              icon={ClipboardList}
            />
            <StatTile
              label={t('dashboard.reportsWithCritical')}
              value={data.reports.withCritical}
              icon={XCircle}
              // Only tint the number when there is something to be alarmed
              // about. A permanently red zero trains people to ignore red.
              tone={data.reports.withCritical > 0 ? 'critical' : 'default'}
            />
            <StatTile
              label={t('dashboard.reportsWithWarning')}
              value={data.reports.withWarn}
              icon={AlertTriangle}
              tone={data.reports.withWarn > 0 ? 'warn' : 'default'}
            />
            <StatTile
              label={t('dashboard.draftReports')}
              value={data.reports.drafts}
              icon={FileEdit}
            />
          </div>
        </section>
      )}

      {/* ================= TOP SHORTAGES ================= */}
      {data.topShortages && (
        <section className="mb-8" aria-labelledby="shortages-heading">
          <div className="card">
            <div className="card-header">
              <div>
                <h2 id="shortages-heading" className="text-sm font-semibold text-stone-700">
                  {t('dashboard.topShortages')}
                </h2>
                <p className="text-xs text-stone-400">
                  {t('dashboard.topShortagesHelp', { days: PERIOD_DAYS })}
                </p>
              </div>
            </div>

            <div className="card-body">
              <ShortagesChart data={data.topShortages} />
            </div>
          </div>
        </section>
      )}

      {/* ================= INVENTORY ================= */}
      {data.inventory && (
        <section className="mb-8" aria-labelledby="inventory-heading">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 id="inventory-heading" className="text-sm font-semibold text-stone-700">
              {t('nav.inventory')}
            </h2>
            <Link
              to="/expiring"
              className="flex items-center gap-1 text-xs text-brand-600 hover:underline"
            >
              {t('nav.expiring')}
              <ArrowRight className="h-3 w-3 flip-in-rtl" aria-hidden="true" />
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              label={t('dashboard.itemsTracked')}
              value={data.inventory.totalItems}
              icon={Boxes}
            />
            <StatTile
              label={t('dashboard.unitsInStock')}
              value={data.inventory.totalUnits.toLocaleString()}
              icon={Boxes}
            />
            <StatTile
              label={t('dashboard.expiringSoon')}
              value={data.inventory.expiringSoonLots}
              icon={CalendarClock}
              tone={data.inventory.expiringSoonLots > 0 ? 'warn' : 'default'}
              hint={t('inventory.withinDays', { days: 30 })}
            />
            <StatTile
              label={t('dashboard.expired')}
              value={data.inventory.expiredLots}
              icon={XCircle}
              tone={data.inventory.expiredLots > 0 ? 'critical' : 'default'}
            />
          </div>
        </section>
      )}

      {/* ================= PEOPLE ================= */}
      {data.people && (
        <section aria-labelledby="people-heading">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 id="people-heading" className="text-sm font-semibold text-stone-700">
              {t('nav.people')}
            </h2>
            {can('user:invite') && (
              <Link
                to="/admin/users"
                className="flex items-center gap-1 text-xs text-brand-600 hover:underline"
              >
                {t('people.inviteUser')}
                <ArrowRight className="h-3 w-3 flip-in-rtl" aria-hidden="true" />
              </Link>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              label={t('dashboard.activeUsers')}
              value={data.people.activeUsers}
              icon={Users}
            />
            <StatTile
              label={t('dashboard.pendingInvites')}
              value={data.people.pendingInvites}
              icon={Mail}
            />
          </div>
        </section>
      )}
    </div>
  );
}
