/**
 * =============================================================================
 *  Fleet status — always on the dashboard
 * =============================================================================
 *  The one question worth answering at a glance, at any hour: IS THE FLEET
 *  READY? Every vehicle, one tile each, colour-coded.
 *
 *  DESIGN NOTES
 *
 *  • NOT CHECKED is treated as the worst state, ahead of "checked and short".
 *    A vehicle nobody has looked at today is an unknown; a vehicle that was
 *    checked and found one item short is a known, smaller problem. Ranking them
 *    the other way round would quietly reward not filing a report.
 *
 *  • Tiles, not a table. There are six or seven vehicles and the reader wants a
 *    shape they can take in without reading — a table of seven rows makes you
 *    scan text to find the red one.
 *
 *  • Colour is never the only signal. Each tile carries a word and an icon, so
 *    it still works for a colour-blind reader and in bright sun on a phone.
 * =============================================================================
 */

import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import {
  Truck,
  Building2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  PackageCheck,
} from 'lucide-react';

import { get } from '@/lib/api';
import { useLocalised } from '@/hooks/useLocalised';

/** Visual treatment per state. `rank` decides the display order. */
const STATE = {
  NOT_CHECKED: {
    rank: 0,
    icon: HelpCircle,
    tile: 'border-stone-300 bg-stone-50',
    text: 'text-stone-600',
  },
  CRITICAL: {
    rank: 1,
    icon: XCircle,
    tile: 'border-status-critical/40 bg-status-criticalBg',
    text: 'text-status-critical',
  },
  WARN: {
    rank: 2,
    icon: AlertTriangle,
    tile: 'border-status-warn/40 bg-status-warnBg',
    text: 'text-status-warn',
  },
  OK: {
    rank: 3,
    icon: CheckCircle2,
    tile: 'border-status-ok/40 bg-status-okBg',
    text: 'text-status-ok',
  },
};

export function FleetStatusPanel() {
  const { t } = useTranslation();
  const L = useLocalised();

  const { data, isLoading, error } = useQuery({
    queryKey: ['fleet-status'],
    queryFn: () => get('/dashboard/fleet'),
    // "At all times" means it must not go stale while it sits on screen.
    refetchInterval: 60_000,
  });

  if (isLoading || error || !data) return null;

  const { rows, totals } = data;

  // Worst first: the point of the panel is that a problem finds you, rather
  // than you having to look for it.
  const ordered = [...rows].sort(
    (a, b) => STATE[a.status].rank - STATE[b.status].rank || a.vehicle.code.localeCompare(b.vehicle.code),
  );

  return (
    <section className="mb-8" aria-labelledby="fleet-heading">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="fleet-heading" className="text-sm font-semibold text-stone-700">
          {t('fleet.title')}
        </h2>

        <p className="text-xs text-stone-500">
          {t('fleet.checkedToday', { done: totals.checkedToday, total: totals.vehicles })}
          {totals.awaitingCollection > 0 && (
            <span className="ms-2 text-brand-600">
              · {t('fleet.awaitingCollection', { count: totals.awaitingCollection })}
            </span>
          )}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        {ordered.map((row) => {
          const state = STATE[row.status];
          const VehicleIcon = row.vehicle.kind === 'ER_ROOM' ? Building2 : Truck;

          return (
            <Link
              key={row.vehicle.id}
              to={`/reports?vehicleId=${row.vehicle.id}`}
              className={`rounded-lg border p-2.5 transition-shadow hover:shadow-sm ${state.tile}`}
            >
              <div className="mb-1 flex items-center gap-1.5">
                <VehicleIcon className="h-3.5 w-3.5 shrink-0 text-stone-400" aria-hidden="true" />
                <span className="truncate text-sm font-semibold text-stone-900">
                  {row.vehicle.code}
                </span>
                <state.icon className={`ms-auto h-4 w-4 shrink-0 ${state.text}`} aria-hidden="true" />
              </div>

              {/* The word, not just the colour. */}
              <p className={`text-xs font-medium ${state.text}`}>
                {t(`fleet.state.${row.status}`)}
              </p>

              {/* The detail that makes the state actionable. */}
              <p className="mt-0.5 truncate text-[11px] text-stone-500">
                {row.status === 'NOT_CHECKED'
                  ? row.lastReport
                    ? t('fleet.lastChecked', {
                        when: dayjs(row.lastReport.shiftDate).format('D MMM'),
                      })
                    : t('fleet.neverChecked')
                  : t('fleet.shortCount', {
                      count: (row.lastReport?.criticalCount ?? 0) + (row.lastReport?.warnCount ?? 0),
                    })}
              </p>

              {/* Something is already on its way — a different situation from
                  simply being short, and worth saying. */}
              {row.restocksReadyToCollect > 0 && (
                <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-brand-600">
                  <PackageCheck className="h-3 w-3 shrink-0" aria-hidden="true" />
                  {t('fleet.readyToCollect')}
                </p>
              )}

              {row.ruleExceptions > 0 && (
                <p className="mt-0.5 text-[11px] text-stone-400" title={t('fleet.exceptionsHint')}>
                  {t('fleet.exceptions', { count: row.ruleExceptions })}
                </p>
              )}
            </Link>
          );
        })}
      </div>
    </section>
  );
}

export default FleetStatusPanel;
