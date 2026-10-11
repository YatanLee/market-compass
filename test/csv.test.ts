import assert from 'node:assert/strict';
import test from 'node:test';

interface CsvPrice {
  date: string;
  close: number;
}

interface CsvModule {
  parsePriceCsv(text: string): CsvPrice[];
}

const csvModuleSpecifier: string = '../client/src/csv.ts';
const { parsePriceCsv } = await import(csvModuleSpecifier) as unknown as CsvModule;

function makeCsvRows(count = 100): string[] {
  const start = new Date('2020-01-01T00:00:00.000Z');
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(start.getTime() + index * 86_400_000).toISOString().slice(0, 10);
    return `${date},${100 + index / 10}`;
  });
}

test('accepts a BOM-prefixed exact header and CRLF rows', () => {
  const rows = parsePriceCsv(`\uFEFFdate,close\r\n${makeCsvRows().join('\r\n')}\r\n`);
  assert.equal(rows.length, 100);
  assert.deepEqual(rows[0], { date: '2020-01-01', close: 100 });
  assert.equal(rows.at(-1)?.date, '2020-04-09');
});

test('requires the exact CSV header and a valid calendar date', () => {
  assert.throws(() => parsePriceCsv(`Date,close\n${makeCsvRows().join('\n')}`), /date,close/);
  const rows = makeCsvRows();
  rows[10] = '2020-02-30,100';
  assert.throws(() => parsePriceCsv(`date,close\n${rows.join('\n')}`), /有效日期/);
});

test('rejects duplicates and out-of-order dates', () => {
  const duplicate = makeCsvRows();
  duplicate[10] = duplicate[9]!;
  assert.throws(() => parsePriceCsv(`date,close\n${duplicate.join('\n')}`), /重複或未依日期遞增/);

  const outOfOrder = makeCsvRows();
  [outOfOrder[10], outOfOrder[11]] = [outOfOrder[11]!, outOfOrder[10]!];
  assert.throws(() => parsePriceCsv(`date,close\n${outOfOrder.join('\n')}`), /重複或未依日期遞增/);
});

test('rejects NaN, Infinity, empty, zero, and negative closes', () => {
  for (const value of ['NaN', 'Infinity', '', '0', '-1']) {
    const rows = makeCsvRows();
    rows[7] = `2020-01-08,${value}`;
    assert.throws(() => parsePriceCsv(`date,close\n${rows.join('\n')}`), /有限數字/);
  }
});

test('accepts 5,000 rows and rejects larger imports', () => {
  assert.equal(parsePriceCsv(`date,close\n${makeCsvRows(5000).join('\n')}`).length, 5000);
  assert.throws(() => parsePriceCsv(`date,close\n${makeCsvRows(5001).join('\n')}`), /最多可包含 5,000 筆/);
});
