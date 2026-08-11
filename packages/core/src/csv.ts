/**
 * CSV that is safe to open.
 *
 * The prototype built its export by joining values with commas (PLAN.md F-11).
 * Any goal title containing a comma silently shifted every later column on that
 * row, and a title beginning `=` was handed to the spreadsheet as a formula —
 * which is not a formatting bug but a code execution path, since a cell
 * starting `=` can invoke `HYPERLINK`, `WEBSERVICE` or, with DDE enabled, a
 * shell command. The person opening the file is usually HR, on a corporate
 * laptop, having downloaded it from a system they trust.
 *
 * Two separate problems, addressed separately:
 *
 *   - **Structure** — RFC 4180. Every field is quoted, internal quotes are
 *     doubled, and records end with CRLF. Always quoting costs a few bytes and
 *     removes the entire class of "which characters need escaping" bugs.
 *   - **Injection** — a leading `=`, `+`, `-`, `@`, tab or carriage return in a
 *     *text* field is prefixed with an apostrophe, which spreadsheets treat as
 *     "the rest of this is literal text".
 */

export const CSV_LINE_ENDING = '\r\n';

/**
 * The characters that make a spreadsheet treat a cell as an expression.
 *
 * This is the OWASP CSV-injection set. Tab and carriage return are included
 * because leading whitespace is stripped before evaluation, so `\t=1+1` is
 * still a formula.
 */
export const FORMULA_TRIGGERS = ['=', '+', '-', '@', '\t', '\r'] as const;

/**
 * The apostrophe that renders the rest of a cell literal. It is consumed by
 * the spreadsheet on display, so a neutralised value still reads correctly.
 */
export const FORMULA_GUARD = "'";

/**
 * Prepended to a file so Excel reads it as UTF-8 rather than as the local
 * codepage — without it, every non-ASCII name in an export arrives mangled.
 */
export const UTF8_BOM = '﻿';

export type CsvValue = string | number | boolean | Date | null | undefined;

export type CsvColumn<T> = {
  readonly header: string;
  readonly value: (record: T) => CsvValue;
};

export type CsvOptions = {
  /** Prepend {@link UTF8_BOM}. Needed whenever Excel is a likely reader. */
  readonly bom?: boolean;
};

/** Turn a value into the text that will sit in the cell. */
function render(value: CsvValue): string {
  if (value == null) {
    return '';
  }
  if (value instanceof Date) {
    // Throws a RangeError on an invalid date, which is the right outcome: a
    // silent "Invalid Date" in an export is a defect that travels.
    return value.toISOString();
  }
  if (typeof value === 'string') {
    return value;
  }
  return String(value);
}

function isFormulaTrigger(character: string | undefined): boolean {
  return character !== undefined && (FORMULA_TRIGGERS as readonly string[]).includes(character);
}

/**
 * One field, quoted and made safe.
 *
 * Neutralisation applies to **strings only**, and that is deliberate. A real
 * `number` renders as digits with at most a leading `-`, which no spreadsheet
 * can interpret as anything but a negative number; guarding it would turn every
 * negative value in an export into text and quietly break the arithmetic the
 * export exists for. The danger is user-supplied text, and that is exactly what
 * is guarded.
 */
export function escapeCsvField(value: CsvValue): string {
  const rendered = render(value);
  const guarded =
    typeof value === 'string' && isFormulaTrigger(rendered[0])
      ? `${FORMULA_GUARD}${rendered}`
      : rendered;

  return `"${guarded.replaceAll('"', '""')}"`;
}

/** One record, without its line ending. */
export function toCsvRow(fields: readonly CsvValue[]): string {
  return fields.map(escapeCsvField).join(',');
}

/**
 * A whole document.
 *
 * No trailing line ending: RFC 4180 makes the final CRLF optional, and omitting
 * it stops a round trip through a strict parser producing a phantom empty row.
 */
export function toCsv(rows: readonly (readonly CsvValue[])[], options: CsvOptions = {}): string {
  const body = rows.map(toCsvRow).join(CSV_LINE_ENDING);

  return options.bom === true ? `${UTF8_BOM}${body}` : body;
}

/**
 * Serialise records through a column definition, header row included.
 *
 * The column list is the export's contract: adding a field to a model does not
 * silently widen every export, and reordering one is a visible change here
 * rather than a surprise in someone's spreadsheet.
 */
export function serializeCsv<T>(
  columns: readonly CsvColumn<T>[],
  records: readonly T[],
  options: CsvOptions = {},
): string {
  const header = columns.map((column) => column.header);
  const rows = records.map((record) => columns.map((column) => column.value(record)));

  return toCsv([header, ...rows], options);
}
