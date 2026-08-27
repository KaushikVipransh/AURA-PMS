/**
 * Reading the spreadsheet somebody exported (W6-13, PRD US-205).
 *
 * **Written rather than imported**, which is worth defending: a CSV parser is
 * a classic thing to get wrong by hand. But the alternative is a dependency in
 * the browser bundle for a file format this app reads in exactly one place,
 * and the part people actually get wrong — quoted fields containing commas and
 * newlines — is forty lines and is pinned by tests below. `split(',')` is the
 * mistake this file exists to not make: a name like `"Sharma, Priya"` becomes
 * two columns and every field after it shifts by one, silently, producing an
 * import that succeeds and is wrong.
 *
 * Parsing stops at structure. Whether `role` names a real role and whether
 * `email` is an address are the server's questions, asked by the contract
 * schema — the browser deciding it knows would be the prototype's arrangement
 * (PLAN.md F-04) in a new costume.
 */

export type CsvTable = {
  /** Lower-cased, trimmed header names, in file order. */
  readonly headers: readonly string[];
  /** One entry per data row: the raw cells, and the 1-based line it came from. */
  readonly rows: readonly { readonly line: number; readonly cells: readonly string[] }[];
};

/**
 * Split CSV text into cells, honouring quotes.
 *
 * A quoted field may contain commas, newlines and doubled quotes (`""`), which
 * is how every spreadsheet exports a field containing a quote. Everything
 * outside quotes is taken literally.
 */
export function parseCsv(text: string): CsvTable {
  const rows: string[][] = [];
  let cells: string[] = [];
  let field = '';
  let quoted = false;
  let index = 0;

  const endField = (): void => {
    cells.push(field);
    field = '';
  };

  const endRow = (): void => {
    endField();
    rows.push(cells);
    cells = [];
  };

  while (index < text.length) {
    const char = text[index] ?? '';

    if (quoted) {
      if (char === '"') {
        // A doubled quote is one literal quote; a single one closes the field.
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }

    if (char === '"' && field === '') {
      quoted = true;
      index += 1;
      continue;
    }
    if (char === ',') {
      endField();
      index += 1;
      continue;
    }
    if (char === '\r') {
      // CRLF or a bare CR. Either way the row is over and the LF is not data.
      endRow();
      index += text[index + 1] === '\n' ? 2 : 1;
      continue;
    }
    if (char === '\n') {
      endRow();
      index += 1;
      continue;
    }

    field += char;
    index += 1;
  }

  if (field !== '' || cells.length > 0) {
    endRow();
  }

  const meaningful = rows.filter((row) => row.some((cell) => cell.trim() !== ''));
  const [header, ...body] = meaningful;

  return {
    headers: (header ?? []).map((cell) => cell.trim().toLowerCase()),
    rows: body.map((cells_, position) => ({
      /* The line the person will see in their spreadsheet: data rows start at
         2 because row 1 is the header. Reporting "row 3" for something they
         see on line 4 is a small cruelty in a file of three hundred. */
      line: position + 2,
      cells: cells_,
    })),
  };
}

export type MappedRow = {
  readonly line: number;
  readonly name: string;
  readonly email: string;
  readonly role: string;
  readonly managerEmail: string | null;
  readonly teamName: string | null;
};

export type MappingProblem = { readonly line: number; readonly message: string };

export type Mapping = {
  readonly rows: readonly MappedRow[];
  readonly problems: readonly MappingProblem[];
};

/** The columns a file must have, and the two it may. */
export const REQUIRED_COLUMNS = ['name', 'email', 'role'] as const;
export const OPTIONAL_COLUMNS = ['manageremail', 'teamname'] as const;

export class MissingColumnsError extends Error {
  readonly missing: readonly string[];

  constructor(missing: readonly string[]) {
    super(
      `This file has no ${missing.join(' or ')} column. The header row needs ` +
        `${REQUIRED_COLUMNS.join(', ')} and may also have ${OPTIONAL_COLUMNS.join(', ')}.`,
    );
    this.name = 'MissingColumnsError';
    this.missing = missing;
  }
}

/**
 * Turn a parsed table into rows the import endpoint understands.
 *
 * Columns are found **by header name, not by position**, so a file with its
 * columns in a different order — or with extra ones the exporter added — works
 * without anybody rearranging it.
 */
export function mapRows(table: CsvTable): Mapping {
  const missing = REQUIRED_COLUMNS.filter((column) => !table.headers.includes(column));

  if (missing.length > 0) {
    throw new MissingColumnsError(missing);
  }

  const at = (cells: readonly string[], column: string): string =>
    (cells[table.headers.indexOf(column)] ?? '').trim();

  const rows: MappedRow[] = [];
  const problems: MappingProblem[] = [];

  for (const row of table.rows) {
    const email = at(row.cells, 'email');
    const name = at(row.cells, 'name');

    if (email === '' || name === '') {
      problems.push({
        line: row.line,
        message: email === '' ? 'No email address on this line.' : 'No name on this line.',
      });
      continue;
    }

    const managerEmail = at(row.cells, 'manageremail');
    const teamName = at(row.cells, 'teamname');

    rows.push({
      line: row.line,
      name,
      email,
      role: at(row.cells, 'role').toUpperCase(),
      managerEmail: managerEmail === '' ? null : managerEmail,
      teamName: teamName === '' ? null : teamName,
    });
  }

  return { rows, problems };
}
