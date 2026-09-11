/**
 * =============================================================================
 *  Statistics
 * =============================================================================
 *  FORM: change over time -> a line chart. Three series, one shared y-axis
 *  (all three are counts of reports, so they belong on the same scale).
 *
 *  NO DUAL AXIS. It is the most common charting mistake: two y-scales let the
 *  author place any two lines wherever they like, and the reader has no way to
 *  know the crossing points are meaningless. If a second measure with a
 *  different unit is ever needed here, it gets its own chart beneath this one.
 * =============================================================================
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { Table2, LineChart as LineChartIcon } from 'lucide-react';
import dayjs from 'dayjs';

import { get } from '@/lib/api';
import { PageHeader, StatTile } from '@/components/PageHeader';
import { FullPageSpinner } from '@/components/Spinner';
import {
  CHART_COLORS,
  CHART_CHROME,
  CHART_MARKS,
  gridProps,
  axisProps,
  tooltipProps,
} from '@/lib/chartTheme';

/** Selectable windows. Kept short — nobody reads a 180-day line on a phone. */
const RANGES = [
  { days: 14, label: '14d' },
  { days: 30, label: '30d' },
  { days: 90, label: '90d' },
];

export default function StatisticsPage() {
  const { t } = useTranslation();
  const [days, setDays] = useState(30);
  const [showTable, setShowTable] = useState(false);

  const { data = [], isLoading } = useQuery({
    queryKey: ['report-trend', days],
    queryFn: () => get('/dashboard/report-trend', { params: { days } }),
  });

  if (isLoading) return <FullPageSpinner />;

  // Totals for the stat tiles. Computed here so the tiles and the chart can
  // never disagree — they are literally the same array.
  const totals = data.reduce(
    (accumulator, day) => ({
      reports: accumulator.reports + day.reports,
      critical: accumulator.critical + day.critical,
      warn: accumulator.warn + day.warn,
    }),
    { reports: 0, critical: 0, warn: 0 },
  );

  const series = [
    { key: 'reports', label: t('dashboard.reportsFiled'), color: CHART_COLORS.primary },
    { key: 'critical', label: t('status.critical'), color: CHART_COLORS.critical },
    { key: 'warn', label: t('status.warn'), color: CHART_COLORS.warn },
  ];

  return (
    <div>
      <PageHeader title={t('nav.statistics')} description={t('dashboard.lastDays', { days })} />

      {/* Filters in one row above the chart. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div
          className="inline-flex rounded-lg border border-surface-border bg-white p-0.5"
          role="group"
          aria-label="Time range"
        >
          {RANGES.map((range) => (
            <button
              key={range.days}
              type="button"
              onClick={() => setDays(range.days)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                days === range.days ? 'bg-brand-600 text-white' : 'text-stone-600 hover:bg-stone-100'
              }`}
              aria-pressed={days === range.days}
            >
              {range.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setShowTable((current) => !current)}
          className="btn-secondary btn-sm ms-auto"
          aria-pressed={showTable}
        >
          {showTable ? (
            <>
              <LineChartIcon className="h-4 w-4" aria-hidden="true" /> Chart
            </>
          ) : (
            <>
              <Table2 className="h-4 w-4" aria-hidden="true" /> Table
            </>
          )}
        </button>
      </div>

      <div className="mb-5 grid grid-cols-3 gap-3">
        <StatTile label={t('dashboard.reportsFiled')} value={totals.reports} />
        <StatTile
          label={t('status.critical')}
          value={totals.critical}
          tone={totals.critical > 0 ? 'critical' : 'default'}
        />
        <StatTile
          label={t('status.warn')}
          value={totals.warn}
          tone={totals.warn > 0 ? 'warn' : 'default'}
        />
      </div>

      <div className="card">
        <div className="card-body">
          {showTable ? (
            <div className="table-wrap">
              <table className="table">
                <caption className="sr-only">{t('nav.statistics')}</caption>
                <thead>
                  <tr>
                    <th>{t('common.date')}</th>
                    {series.map((entry) => (
                      <th key={entry.key} className="text-end">
                        {entry.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.map((day) => (
                    <tr key={day.date}>
                      <td className="tabular-nums">{day.date}</td>
                      {series.map((entry) => (
                        <td key={entry.key} className="text-end tabular-nums">
                          {day[entry.key]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -16 }}>
                  <CartesianGrid {...gridProps} />

                  <XAxis
                    dataKey="date"
                    {...axisProps}
                    // Thin the labels so they never collide: show roughly six
                    // ticks whatever the range length.
                    interval={Math.max(0, Math.floor(data.length / 6) - 1)}
                    tickFormatter={(value) => dayjs(value).format('D MMM')}
                  />

                  {/* ONE y-axis, shared by all three series. */}
                  <YAxis {...axisProps} allowDecimals={false} width={40} />

                  <Tooltip
                    {...tooltipProps}
                    labelFormatter={(value) => dayjs(value).format('ddd D MMM YYYY')}
                    // A crosshair, not a filled band — it points at the value
                    // without hiding the marks underneath.
                    cursor={{ stroke: CHART_CHROME.axis, strokeWidth: 1 }}
                  />

                  <Legend
                    wrapperStyle={{ fontSize: '0.75rem', color: CHART_CHROME.label }}
                    iconType="circle"
                    iconSize={8}
                  />

                  {series.map((entry) => (
                    <Line
                      key={entry.key}
                      type="monotone"
                      dataKey={entry.key}
                      name={entry.label}
                      stroke={entry.color}
                      strokeWidth={CHART_MARKS.lineWidth}
                      // No dot on every point — with 90 days that is 270 dots
                      // and the lines disappear underneath them.
                      dot={false}
                      // On hover the point is drawn large enough to be a real
                      // touch target, with a surface ring so overlapping series
                      // stay separable.
                      activeDot={{
                        r: CHART_MARKS.dotRadius + 1,
                        strokeWidth: 2,
                        stroke: CHART_CHROME.surface,
                      }}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
