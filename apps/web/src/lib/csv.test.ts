import { describe, expect, it } from 'vitest';

import { MissingColumnsError, mapRows, parseCsv } from './csv.js';

/** W6-13 — reading the spreadsheet (PRD US-205). */

const HEADER = 'name,email,role,managerEmail,teamName';

describe('parseCsv', () => {
  it('reads a plain file', () => {
    const table = parseCsv(`${HEADER}\nPriya,priya@example.com,EMPLOYEE,,`);

    expect(table.headers).toEqual(['name', 'email', 'role', 'manageremail', 'teamname']);
    expect(table.rows[0]?.cells).toEqual(['Priya', 'priya@example.com', 'EMPLOYEE', '', '']);
  });

  it('numbers data rows from 2, because row 1 is the header', () => {
    const table = parseCsv(`${HEADER}\nA,a@example.com,EMPLOYEE,,\nB,b@example.com,EMPLOYEE,,`);

    // Reporting "row 3" for something somebody sees on line 4 is a small
    // cruelty in a file of three hundred.
    expect(table.rows.map((row) => row.line)).toEqual([2, 3]);
  });

  it('keeps a comma inside a quoted field', () => {
    const table = parseCsv(`${HEADER}\n"Sharma, Priya",priya@example.com,EMPLOYEE,,`);

    // `split(',')` turns this into six columns and shifts every field after
    // it, producing an import that succeeds and is wrong.
    expect(table.rows[0]?.cells[0]).toBe('Sharma, Priya');
    expect(table.rows[0]?.cells[1]).toBe('priya@example.com');
  });

  it('keeps a newline inside a quoted field', () => {
    const table = parseCsv(`${HEADER}\n"Priya\nSharma",priya@example.com,EMPLOYEE,,`);

    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]?.cells[0]).toBe('Priya\nSharma');
  });

  it('reads a doubled quote as one literal quote', () => {
    const table = parseCsv(`${HEADER}\n"Priya ""Pri"" Sharma",priya@example.com,EMPLOYEE,,`);

    expect(table.rows[0]?.cells[0]).toBe('Priya "Pri" Sharma');
  });

  it('handles CRLF line endings, which is what Excel writes', () => {
    const table = parseCsv(`${HEADER}\r\nPriya,priya@example.com,EMPLOYEE,,\r\n`);

    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]?.cells[2]).toBe('EMPLOYEE');
  });

  it('ignores blank lines, including a trailing one', () => {
    const table = parseCsv(`${HEADER}\n\nPriya,priya@example.com,EMPLOYEE,,\n\n`);

    expect(table.rows).toHaveLength(1);
  });

  it('returns nothing useful for an empty file rather than throwing', () => {
    expect(parseCsv('')).toEqual({ headers: [], rows: [] });
  });
});

describe('mapRows', () => {
  const map = (body: string) => mapRows(parseCsv(`${HEADER}\n${body}`));

  it('maps the columns a file must have', () => {
    const mapping = map('Priya,priya@example.com,employee,marcus@example.com,Platform');

    expect(mapping.rows[0]).toMatchObject({
      line: 2,
      name: 'Priya',
      email: 'priya@example.com',
      // Upper-cased for the enum; the server still decides whether it is real.
      role: 'EMPLOYEE',
      managerEmail: 'marcus@example.com',
      teamName: 'Platform',
    });
  });

  it('finds columns by name, not by position', () => {
    const mapping = mapRows(
      parseCsv('role,email,name\nEMPLOYEE,priya@example.com,Priya'),
    );

    // A file exported with its columns in another order, or with extra ones,
    // works without anybody rearranging it.
    expect(mapping.rows[0]).toMatchObject({ name: 'Priya', email: 'priya@example.com' });
  });

  it('reads empty optional columns as absent rather than as blank strings', () => {
    const mapping = map('Priya,priya@example.com,EMPLOYEE,,');

    expect(mapping.rows[0]).toMatchObject({ managerEmail: null, teamName: null });
  });

  it('reports a line with no email, and keeps going', () => {
    const mapping = map('Priya,,EMPLOYEE,,\nMarcus,marcus@example.com,MANAGER,,');

    expect(mapping.problems).toEqual([{ line: 2, message: 'No email address on this line.' }]);
    expect(mapping.rows).toHaveLength(1);
  });

  it('reports a line with no name', () => {
    const mapping = map(',priya@example.com,EMPLOYEE,,');

    expect(mapping.problems[0]?.message).toContain('No name');
  });

  it('refuses a file whose header is missing a required column, saying which', () => {
    expect(() => mapRows(parseCsv('name,email\nPriya,priya@example.com'))).toThrow(
      MissingColumnsError,
    );

    try {
      mapRows(parseCsv('name,email\nPriya,priya@example.com'));
    } catch (error) {
      expect((error as MissingColumnsError).missing).toEqual(['role']);
      expect((error as Error).message).toContain('role');
    }
  });

  it('does not judge whether the role is real', () => {
    const mapping = map('Priya,priya@example.com,SUPREME_LEADER,,');

    // The contract schema decides that, server-side. A browser that knew the
    // enum would be the prototype's arrangement in a new costume (F-04).
    expect(mapping.rows[0]?.role).toBe('SUPREME_LEADER');
    expect(mapping.problems).toEqual([]);
  });
});
