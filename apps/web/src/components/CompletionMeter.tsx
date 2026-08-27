/**
 * One ratio against a limit (W6-16).
 *
 * A meter rather than a chart, and that is the form decision rather than a
 * styling one: "142 of 180 sheets submitted" is a single ratio, and a one-bar
 * bar chart with an axis is more furniture than the number deserves. The
 * prototype rendered these as a key-value list, which is the opposite mistake —
 * `142` next to `180` makes the reader do the division.
 *
 * **The number is always written out.** The bar is the glance; the fraction and
 * the percentage are the answer. A meter whose only output is a length cannot
 * be read precisely by anyone, and cannot be read at all by a screen reader
 * without the ARIA values that are on it here.
 */

const TRACK = '#e1e0d9';
const FILL = '#2a78d6';

export type CompletionMeterProps = {
  readonly label: string;
  readonly done: number;
  readonly total: number;
  readonly testId?: string;
};

export function CompletionMeter({ label, done, total, testId }: CompletionMeterProps) {
  /* Zero of zero is 0%, not NaN%. It happens on the first day of a cycle, and
     `NaN%` on a compliance dashboard is the kind of thing people screenshot. */
  const fraction = total === 0 ? 0 : done / total;
  const percent = Math.round(fraction * 100);

  return (
    <div className="rounded border p-4" data-testid={testId}>
      <p className="text-sm text-slate-600">{label}</p>

      <p className="mt-1 text-2xl font-semibold tabular-nums">
        {percent}%
        <span className="ml-2 text-sm font-normal text-slate-600">
          {done} of {total}
        </span>
      </p>

      <div
        role="meter"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        className="mt-2 h-2 w-full overflow-hidden rounded"
        style={{ backgroundColor: TRACK }}
      >
        <div
          className="h-full rounded"
          style={{ width: `${String(percent)}%`, backgroundColor: FILL }}
        />
      </div>
    </div>
  );
}
