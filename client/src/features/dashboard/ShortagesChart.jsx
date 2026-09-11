/**
 * =============================================================================
 *  "Most frequent shortages" — ranked horizontal bar chart
 * =============================================================================
 *  FORM: ranked magnitude across many long labels. A horizontal bar chart is
 *  the right answer — the labels ("Airways — Red", "Sam Chest Seal") are long
 *  bilingual phrases that would have to be rotated 45° on a vertical chart and
 *  become unreadable.
 *
 *  ENCODING: stacked by severity, using the RESERVED status colours (critical
 *  red, warning amber) from lib/chartTheme.js. Those two hues were validated
 *  for colour-vision-deficiency separation — see the note in that file about
 *  the first attempt failing.
 *
 *  ACCESSIBILITY:
 *    • A legend is present (two series) and every bar is directly labelled with
 *      its total, so identity and value are never colour-alone.
 *    • A table view is available beneath the chart. Screen-reader users and
 *      anyone who prefers exact numbers get the same data, and it prints.
 *    • A 2px surface gap separates the stacked segments so the boundary is
 *      visible without relying on the hue change.
 * =============================================================================
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LabelList,
} from 'recharts';
import { Table2, BarChart3 } from 'lucide-react';

import { CHART_COLORS, CHART_CHROME, gridProps, axisProps, tooltipProps } from '@/lib/chartTheme';
import { useLocalised } from '@/hooks/useLocalised';

export function ShortagesChart({ data = [] }) {
  const { t } = useTranslation();
  const L = useLocalised();
  const [showTable, setShowTable] = useState(false);

  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-stone-500">{t('dashboard.noShortages')}</p>;
  }

  // Recharts renders the first row at the BOTTOM of a horizontal chart, so we
  // reverse to put the worst offender at the top where it will be read first.
  const rows = [...data]
    .slice(0, 8)
    .reverse()
    .map((entry) => ({
      ...entry,
      name: L.isArabic && entry.labelAr ? entry.labelAr : entry.label,
    }));

  return (
    <div>
      {/* Toggle between the chart and the equivalent table. */}
      <div className="mb-3 flex justify-end">
        <button
          type="button"
          onClick={() => setShowTable((current) => !current)}
          className="btn-ghost btn-sm"
          aria-pressed={showTable}
        >
          {showTable ? (
            <>
              <BarChart3 className="h-4 w-4" aria-hidden="true" /> Chart
            </>
          ) : (
            <>
              <Table2 className="h-4 w-4" aria-hidden="true" /> Table
            </>
          )}
        </button>
      </div>

      {showTable ? (
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">{t('dashboard.topShortages')}</caption>
            <thead>
              <tr>
                <th>{t('reports.issues')}</th>
                <th className="text-end">{t('status.critical')}</th>
                <th className="text-end">{t('status.warn')}</th>
                <th className="text-end">{t('common.of')}</th>
              </tr>
            </thead>
            <tbody>
              {/* Un-reversed: a table reads top-down, worst first. */}
              {[...rows].reverse().map((row) => (
                <tr key={row.key}>
                  <td>{row.name}</td>
                  <td className="text-end tabular-nums">{row.critical}</td>
                  <td className="text-end tabular-nums">{row.warn}</td>
                  <td className="text-end font-medium tabular-nums">{row.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        // Height scales with the row count so bars keep a usable thickness
        // whether there are three shortages or eight.
        <div style={{ height: Math.max(220, rows.length * 42) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={rows}
              layout="vertical"
              margin={{ top: 4, right: 44, bottom: 4, left: 4 }}
              barCategoryGap="28%"
            >
              <CartesianGrid {...gridProps} horizontal={false} vertical />

              {/* ONE axis. The value axis is x; the category axis is y. */}
              <XAxis type="number" {...axisProps} allowDecimals={false} />
              <YAxis
                type="category"
                dataKey="name"
                {...axisProps}
                width={150}
                // Long bilingual labels: truncate rather than let them push the
                // plot area to nothing. The tooltip and table give the full text.
                tickFormatter={(value) => (value.length > 24 ? `${value.slice(0, 23)}…` : value)}
              />

              <Tooltip
                {...tooltipProps}
                cursor={{ fill: '#00000008' }}
                formatter={(value, name) => [value, name]}
              />

              <Legend
                wrapperStyle={{ fontSize: '0.75rem', color: CHART_CHROME.label }}
                iconType="circle"
                iconSize={8}
              />

              <Bar
                dataKey="critical"
                name={t('status.critical')}
                stackId="severity"
                fill={CHART_COLORS.critical}
                // 2px surface-coloured stroke = the gap between stacked
                // segments, so the boundary is visible without relying on hue.
                stroke={CHART_CHROME.surface}
                strokeWidth={2}
              />

              <Bar
                dataKey="warn"
                name={t('status.warn')}
                stackId="severity"
                fill={CHART_COLORS.warn}
                stroke={CHART_CHROME.surface}
                strokeWidth={2}
                // Rounded far end on the LAST segment only, so the stack reads
                // as one bar with a single rounded cap.
                radius={[0, 4, 4, 0]}
              >
                {/* Direct label: the exact total, in ink — never in a series colour. */}
                <LabelList
                  dataKey="total"
                  position="right"
                  style={{ fill: CHART_CHROME.label, fontSize: 11, fontWeight: 600 }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

export default ShortagesChart;
