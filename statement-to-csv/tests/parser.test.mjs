import test from 'node:test';
import assert from 'node:assert/strict';
import { dateISO, groupSpans, parseLines, exportCsv, rowErrors, csvCell } from '../dist/parser.mjs';

const lines = strings => strings.map((text, i) => ({ text, page: 1, source: 'text', id: `1-${i}`, spans: [] }));
const base = { year: 2026, endMonth: 8, sign: 'card' };
const reviewed = rows => rows.map(r => ({ ...r, reviewed: true }));
function positionedRow(cells, y) { return cells.map(([text, x]) => ({ text, x, y, width: text.length * 5, height: 10 })); }

test('keeps groceries, gas, and fast food separate and excludes summaries', () => {
  const parsed = parseLines(lines(['Statement period August 1, 2026 to August 31, 2026', 'Date Description Amount', '08/03 Publix 87.42', '08/05 Shell 42.18', '08/06 Chick-fil-A 18.65', '08/31 Ending balance 500.00']), base);
  assert.equal(parsed.rows.length, 3);
  assert.deepEqual(parsed.rows.map(r => r.category), ['Groceries', 'Gas', 'Fast Food']);
  assert.deepEqual(parsed.rows.map(r => r.amount), ['87.42', '42.18', '18.65']);
});

test('uses debit and credit positions instead of the running balance', () => {
  const spans = [
    ...positionedRow([['Date', 10], ['Description', 100], ['Debit', 300], ['Credit', 390], ['Balance', 480]], 10),
    ...positionedRow([['08/02', 10], ['Publix', 100], ['87.42', 300], ['912.58', 480]], 30),
    ...positionedRow([['08/03', 10], ['Payroll deposit', 100], ['1,400.00', 380], ['2,312.58', 470]], 50),
  ];
  const parsed = parseLines(groupSpans(spans, 1), { ...base, sign: 'bank' });
  assert.deepEqual(parsed.rows.map(r => [r.description, r.amount, r.type]), [['Publix', '87.42', 'expense'], ['Payroll deposit', '1400.00', 'income']]);
});

test('Paycheck output contains only spending and preserves quoted merchants', () => {
  const rows = reviewed(parseLines(lines(['08/01 Store, "Downtown" 14.25', '08/02 Online payment thank you -950.00', '08/03 Store refund -24.99', '08/04 Direct deposit 1400.00']), base).rows);
  const csv = exportCsv(rows);
  assert.match(csv, /"Date","Description","Amount"/);
  assert.match(csv, /"Store, ""Downtown""","14.25"/);
  assert.doesNotMatch(csv, /950.00|24.99|1400.00/);
  const all = exportCsv(rows, { mode: 'all' });
  assert.match(all, /"Transfer Amount"/);
  assert.match(all, /"transfer".*"950.00"/);
});

test('validates real dates and December/January rollover', () => {
  assert.equal(dateISO('12/31', 2026, 'mdy', 1), '2025-12-31');
  assert.equal(dateISO('01/02', 2026, 'mdy', 1), '2026-01-02');
  assert.equal(dateISO('31/08/26', 2026, 'dmy'), '2026-08-31');
  assert.equal(dateISO('Feb 29, 2026', 2026), '');
  assert.equal(dateISO('2024-02-29', 2026), '2024-02-29');
});

test('flags uncertain signs, scanned rows, duplicates, and missing amounts', () => {
  const raw = lines(['08/01 Unknown merchant 19.25', '08/01 Unknown merchant 19.25', '08/02 Merchant with no amount']); raw[0].source = 'ocr';
  const parsed = parseLines(raw, { year: 2026, sign: 'auto' });
  assert.equal(parsed.rows.length, 2); assert.equal(parsed.unmatched.length, 1);
  assert.equal(parsed.rows[0].reviewed, false);
  assert.ok(parsed.rows[0].reasons.some(r => r.includes('Scanned')));
  assert.ok(parsed.rows[1].reasons.some(r => r.includes('duplicate')));
  assert.throws(() => exportCsv(parsed.rows), /Review/);
});

test('two dates and wrapped descriptions produce one transaction', () => {
  const parsed = parseLines(lines(['08/02 08/03 FIRST MERCHANT', 'CONTINUATION 17.23']), base);
  assert.equal(parsed.rows.length, 1); assert.equal(parsed.rows[0].date, '2026-08-02');
  assert.equal(parsed.rows[0].description, 'FIRST MERCHANT CONTINUATION');
});

test('invalid or empty values cannot be exported, and formulas are escaped', () => {
  const row = reviewed(parseLines(lines(['08/01 =HYPERLINK(malicious) 10.00']), base).rows)[0];
  assert.match(exportCsv([row]), /'\=HYPERLINK/);
  assert.equal(csvCell('@SUM(A1:A2)'), '"\'@SUM(A1:A2)"');
  for (const amount of ['1.2.3', '0', '-5', '1,23']) assert.ok(rowErrors({ ...row, amount }).includes('amount'));
  assert.throws(() => exportCsv([{ ...row, date: '2026-02-30' }]), /Fix/);
  assert.throws(() => exportCsv([{ ...row, included: false }]), /no spending/);
});

test('merchant text containing transaction and credit is not mistaken for a header', () => {
  const parsed = parseLines(lines(['08/01 Transaction credit adjustment -25.00']), base);
  assert.equal(parsed.rows.length, 1); assert.equal(parsed.rows[0].type, 'refund');
});
