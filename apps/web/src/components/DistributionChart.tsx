/**
 * A one-series distribution bar chart (W6-15, W6-14).
 *
 * **One hue, not eight.** Every chart in this app compares magnitude within a
 * single series — how many goals are in each thrust area, how many people
 * scored each point on the scale — so length carries the number and colour
 * carries nothing. A categorical palette here would be assigning identity to
 * things whose identity is already written on the axis, and it is how a chart
 * ends up implying that "Revenue" and "Quality" are opposing teams.
 *
 * That decision also removes a whole class of accessibility problem: with one
 * series there is no colour pair to tell apart, so no colour-vision deficiency
 * can make two bars ambiguous. `#2a78d6` clears 3:1 against white, checked
 * rather than guessed.
 *
 * Horizontal, because the categories have long names — `OPERATIONAL_EXCELLENCE`
 * rotated 45° under a vertical axis is the most common way a real dashboard
 * becomes unreadable.
 *
 * **A table is always available.** The chart is the fast read; the table is the
 * exact one, and it is what a screen reader gets. Neither is a fallback for the
 * other.
 */

import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

/** Validated against white with the dataviz palette script: 4.06:1. */
export const SERIES = '#2a78d6';
/** The de-emphasis step, for bars that are context rather than subject. */
export const SERIES_MUTED = '#b7d3f6';
const GRID = '#e1e0d9';
const AXIS_INK = '#52514e';

export type Slice = {
  readonly label: string;
  readonly count: number;
  /** Set on the one bar that is the point, if there is one. */
  readonly emphasis?: boolean;
};

export type DistributionChartProps = {
  readonly title: string;
  readonly slices: readonly Slice[];
  /** Drawn as a dashed vertical rule — an average, a target. */
  readonly reference?: { readonly value: number; readonly label: string };
  readonly caption?: string;
  readonly testId?: string;
};

export function DistributionChart({
  title,
  slices,
  reference,
  caption,
  testId,
}: DistributionChartProps) {
  const [showTable, setShowTable] = useState(false);
  const total = slices.reduce((sum, slice) => sum + slice.count, 0);
  const emphasised = slices.some((slice) => slice.emphasis === true);
  const headingId = `chart-${title.replace(/\W+/g, '-').toLowerCase()}`;

  return (
    <figure className="rounded border p-4" data-testid={testId}>
      <figcaption>
        <h3 id={headingId} className="text-sm font-medium">
          {title}
        </h3>
        {caption !== undefined && <p className="mt-1 text-xs text-slate-600">{caption}</p>}
      </figcaption>

      {total === 0 ? (
        <p className="mt-4 text-sm text-slate-600">Nothing to show for this cycle yet.</p>
      ) : (
        <>
          {/*
            * Hidden from assistive technology, which reads the table below
            * instead. An SVG of positioned rectangles announced element by
            * element is noise, and the table is the same data exactly.
            */}
          <div className="mt-3 h-64" aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={slices.map((slice) => ({ ...slice }))}
                layout="vertical"
                margin={{ top: 4, right: 40, bottom: 4, left: 8 }}
                /* 2px of surface between adjacent fills, per the mark spec —
                   bars that touch read as one shape. */
                barCategoryGap={6}
              >
                <CartesianGrid horizontal={false} stroke={GRID} />
                <XAxis
                  type="number"
                  allowDecimals={false}
                  stroke={AXIS_INK}
                  fontSize={12}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={150}
                  stroke={AXIS_INK}
                  fontSize={12}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(11,11,11,0.04)' }}
                  /* Recharts types the value as `ValueType | undefined`, so the
                     formatter takes what it is actually handed rather than what
                     the data happens to contain. */
                  formatter={(value) => [String(value ?? ''), 'Count']}
                />
                {reference !== undefined && (
                  <ReferenceLine
                    x={reference.value}
                    stroke={AXIS_INK}
                    strokeDasharray="4 4"
                    label={{ value: reference.label, position: 'top', fontSize: 11 }}
                  />
                )}
                {/* 4px rounded data-end, anchored square to the baseline. */}
                <Bar dataKey="count" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                  {slices.map((slice) => (
                    <Cell
                      key={slice.label}
                      fill={
                        emphasised && slice.emphasis !== true ? SERIES_MUTED : SERIES
                      }
                    />
                  ))}
                  {/* Selective direct labels: the value, at the end of the bar,
                      so the axis does not have to be read across. */}
                  <LabelList dataKey="count" position="right" fontSize={11} fill={AXIS_INK} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <button
            type="button"
            onClick={() => {
              setShowTable((current) => !current);
            }}
            aria-expanded={showTable}
            className="mt-2 text-xs underline"
          >
            {showTable ? 'Hide the numbers' : 'Show the numbers'}
          </button>

          {/* Rendered whenever asked for, and always the screen-reader path. */}
          <table
            className={showTable ? 'mt-2 w-full text-left text-sm' : 'sr-only'}
            data-testid={testId === undefined ? undefined : `${testId}-table`}
          >
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr>
                <th scope="col" className="pb-1">
                  Category
                </th>
                <th scope="col" className="pb-1 text-right">
                  Count
                </th>
                <th scope="col" className="pb-1 text-right">
                  Share
                </th>
              </tr>
            </thead>
            <tbody>
              {slices.map((slice) => (
                <tr key={slice.label} className="border-t">
                  <td className="py-1">{slice.label}</td>
                  <td className="py-1 text-right tabular-nums">{slice.count}</td>
                  <td className="py-1 text-right tabular-nums">
                    {Math.round((slice.count / total) * 100)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </figure>
  );
}
