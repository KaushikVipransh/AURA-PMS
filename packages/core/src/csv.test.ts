import { describe, expect, it } from 'vitest';

import {
  CSV_LINE_ENDING,
  FORMULA_GUARD,
  FORMULA_TRIGGERS,
  UTF8_BOM,
  escapeCsvField,
  serializeCsv,
  toCsv,
  toCsvRow,
} from './csv.js';

describe('escapeCsvField · RFC 4180 structure', () => {
  it('quotes every field, including ones that need nothing', () => {
    expect(escapeCsvField('plain')).toBe('"plain"');
  });

  it('keeps an embedded comma inside its field', () => {
    // The prototype joined on commas, so this one value became two columns and
    // shifted every later column on the row.
    expect(escapeCsvField('Reduce cost, improve margin')).toBe('"Reduce cost, improve margin"');
  });

  it('doubles an internal quote', () => {
    expect(escapeCsvField('He said "ship it"')).toBe('"He said ""ship it"""');
  });

  it('doubles every internal quote, not just the first', () => {
    expect(escapeCsvField('"a" and "b"')).toBe('"""a"" and ""b"""');
  });

  it('keeps an embedded newline inside its field', () => {
    expect(escapeCsvField('line one\nline two')).toBe('"line one\nline two"');
  });

  it('keeps an embedded CRLF inside its field', () => {
    expect(escapeCsvField('line one\r\nline two')).toBe('"line one\r\nline two"');
  });

  it('renders an empty string as an empty quoted field', () => {
    expect(escapeCsvField('')).toBe('""');
  });

  it.each([null, undefined])('renders %o as an empty quoted field', (value) => {
    expect(escapeCsvField(value)).toBe('""');
  });
});

describe('escapeCsvField · value types', () => {
  it.each<[number, string]>([
    [0, '"0"'],
    [42, '"42"'],
    [-7.5, '"-7.5"'],
    [99.95, '"99.95"'],
  ])('renders the number %s as %s', (value, expected) => {
    expect(escapeCsvField(value)).toBe(expected);
  });

  it.each<[boolean, string]>([
    [true, '"true"'],
    [false, '"false"'],
  ])('renders the boolean %s as %s', (value, expected) => {
    expect(escapeCsvField(value)).toBe(expected);
  });

  it('renders a date as an unambiguous ISO instant', () => {
    expect(escapeCsvField(new Date('2026-04-16T00:00:00Z'))).toBe('"2026-04-16T00:00:00.000Z"');
  });

  it('refuses an invalid date rather than exporting "Invalid Date"', () => {
    expect(() => escapeCsvField(new Date('nonsense'))).toThrow(RangeError);
  });
});

describe('escapeCsvField · formula injection', () => {
  it.each(FORMULA_TRIGGERS)('neutralises a leading %j', (trigger) => {
    expect(escapeCsvField(`${trigger}danger`)).toBe(`"${FORMULA_GUARD}${trigger}danger"`);
  });

  it('neutralises the classic payloads', () => {
    expect(escapeCsvField('=1+1')).toBe(`"${FORMULA_GUARD}=1+1"`);
    expect(escapeCsvField('=HYPERLINK("http://evil.example","click")')).toBe(
      `"${FORMULA_GUARD}=HYPERLINK(""http://evil.example"",""click"")"`,
    );
    expect(escapeCsvField('@SUM(A1:A9)')).toBe(`"${FORMULA_GUARD}@SUM(A1:A9)"`);
    expect(escapeCsvField('+1+cmd|\' /c calc\'!A0')).toBe(
      `"${FORMULA_GUARD}+1+cmd|' /c calc'!A0"`,
    );
  });

  it('neutralises leading whitespace triggers, which are stripped before evaluation', () => {
    expect(escapeCsvField('\t=1+1')).toBe(`"${FORMULA_GUARD}\t=1+1"`);
    expect(escapeCsvField('\r=1+1')).toBe(`"${FORMULA_GUARD}\r=1+1"`);
  });

  it('leaves a trigger character alone when it is not leading', () => {
    expect(escapeCsvField('Q1=Q2')).toBe('"Q1=Q2"');
    expect(escapeCsvField('cost-reduction')).toBe('"cost-reduction"');
    expect(escapeCsvField('a@b.example')).toBe('"a@b.example"');
  });

  it('does not guard a real negative number, which cannot carry a formula', () => {
    // Guarding it would turn every negative value in an export into text and
    // break the arithmetic the export exists for.
    expect(escapeCsvField(-5)).toBe('"-5"');
    expect(escapeCsvField(-0.25)).toBe('"-0.25"');
  });

  it('does guard the string form of that same number', () => {
    expect(escapeCsvField('-5')).toBe(`"${FORMULA_GUARD}-5"`);
  });

  it('guards a payload disguised as a negative number', () => {
    expect(escapeCsvField('-2+3+cmd|\' /c calc\'!A0')).toBe(
      `"${FORMULA_GUARD}-2+3+cmd|' /c calc'!A0"`,
    );
  });

  it('covers the whole OWASP trigger set and nothing has been dropped', () => {
    expect([...FORMULA_TRIGGERS]).toEqual(['=', '+', '-', '@', '\t', '\r']);
  });
});

describe('escapeCsvField · unicode', () => {
  it.each([
    'Zoë Böhm',
    '目標設定',
    'Прирост выручки',
    'مؤشر الأداء',
    'naïve café',
    'emoji 🎯 target',
  ])('passes %s through unchanged', (value) => {
    expect(escapeCsvField(value)).toBe(`"${value}"`);
  });

  it('handles an astral-plane character without splitting it', () => {
    const value = '𝕲𝖔𝖆𝖑';

    expect(escapeCsvField(value)).toBe(`"${value}"`);
  });

  it('does not treat a full-width equals as a formula trigger', () => {
    // U+FF1D is not what a spreadsheet parses, so guarding it would corrupt
    // legitimate text for no benefit.
    expect(escapeCsvField('＝not a formula')).toBe('"＝not a formula"');
  });
});

describe('toCsvRow', () => {
  it('joins fields with commas', () => {
    expect(toCsvRow(['a', 'b', 'c'])).toBe('"a","b","c"');
  });

  it('keeps column alignment when a value contains a comma', () => {
    const row = toCsvRow(['Reduce cost, improve margin', 30, 'ON_TRACK']);

    expect(row).toBe('"Reduce cost, improve margin","30","ON_TRACK"');
    expect(row.split('","')).toHaveLength(3);
  });

  it('renders an empty row as nothing', () => {
    expect(toCsvRow([])).toBe('');
  });
});

describe('toCsv', () => {
  it('separates records with CRLF', () => {
    expect(toCsv([['a'], ['b']])).toBe(`"a"${CSV_LINE_ENDING}"b"`);
    expect(CSV_LINE_ENDING).toBe('\r\n');
  });

  it('emits no trailing line ending, so a round trip gains no phantom row', () => {
    const document = toCsv([['a'], ['b']]);

    expect(document.endsWith(CSV_LINE_ENDING)).toBe(false);
    expect(document.split(CSV_LINE_ENDING)).toHaveLength(2);
  });

  it('renders an empty document as an empty string', () => {
    expect(toCsv([])).toBe('');
  });

  it('omits the byte order mark by default', () => {
    expect(toCsv([['Zoë']]).startsWith(UTF8_BOM)).toBe(false);
  });

  it('prepends the byte order mark on request, so Excel reads UTF-8', () => {
    const document = toCsv([['Zoë']], { bom: true });

    expect(document.startsWith(UTF8_BOM)).toBe(true);
    expect(document).toBe(`${UTF8_BOM}"Zoë"`);
  });

  it('keeps a field containing CRLF from being read as two records', () => {
    const document = toCsv([['first\r\nsecond'], ['third']]);

    // Three CRLFs in the text, but only one of them is a record separator --
    // which is exactly why every field is quoted.
    expect(document).toBe(`"first\r\nsecond"${CSV_LINE_ENDING}"third"`);
  });
});

describe('serializeCsv', () => {
  type Goal = {
    readonly title: string;
    readonly weightage: number;
    readonly updatedAt: Date;
    readonly note: string | null;
  };

  const columns = [
    { header: 'Title', value: (goal: Goal) => goal.title },
    { header: 'Weightage', value: (goal: Goal) => goal.weightage },
    { header: 'Updated', value: (goal: Goal) => goal.updatedAt },
    { header: 'Note', value: (goal: Goal) => goal.note },
  ];

  const goals: readonly Goal[] = [
    {
      title: 'Reduce cost, improve margin',
      weightage: 40,
      updatedAt: new Date('2026-04-16T00:00:00Z'),
      note: null,
    },
    {
      title: '=HYPERLINK("http://evil.example","payslip")',
      weightage: 60,
      updatedAt: new Date('2026-04-17T09:30:00Z'),
      note: 'He said "fine"',
    },
  ];

  it('writes a header row from the column definitions', () => {
    const [header] = serializeCsv(columns, goals).split(CSV_LINE_ENDING);

    expect(header).toBe('"Title","Weightage","Updated","Note"');
  });

  it('writes one record per row', () => {
    expect(serializeCsv(columns, goals).split(CSV_LINE_ENDING)).toHaveLength(3);
  });

  it('applies escaping and neutralisation to the records', () => {
    const rows = serializeCsv(columns, goals).split(CSV_LINE_ENDING);

    expect(rows[1]).toBe('"Reduce cost, improve margin","40","2026-04-16T00:00:00.000Z",""');
    expect(rows[2]).toBe(
      `"${FORMULA_GUARD}=HYPERLINK(""http://evil.example"",""payslip"")","60","2026-04-17T09:30:00.000Z","He said ""fine"""`,
    );
  });

  it('writes the header alone when there are no records', () => {
    expect(serializeCsv(columns, [])).toBe('"Title","Weightage","Updated","Note"');
  });

  it('honours the byte order mark option', () => {
    expect(serializeCsv(columns, [], { bom: true }).startsWith(UTF8_BOM)).toBe(true);
  });

  it('exports only the declared columns, so adding a field widens nothing', () => {
    const narrow = [{ header: 'Title', value: (goal: Goal) => goal.title }];

    expect(serializeCsv(narrow, goals).split(CSV_LINE_ENDING)[0]).toBe('"Title"');
  });

  it('handles a column list that is empty', () => {
    expect(serializeCsv<Goal>([], goals)).toBe(`${CSV_LINE_ENDING}${CSV_LINE_ENDING}`);
  });
});
