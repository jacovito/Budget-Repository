export const CATEGORIES = ['Groceries', 'Gas', 'Fast Food', 'Restaurants', 'Bills', 'Subscriptions', 'Car / Transportation', 'Personal', 'Shopping', 'Giving', 'Tax', 'Other / Uncategorized'];
export const TYPES = ['expense', 'income', 'refund', 'transfer'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DATE_START = /^(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,?\s+\d{4})?)(?=\s|$)/i;
const MONEY = /(?<![\w.])(?:\(\s*)?[+\-−]?\s*[$£€]?\s*(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}(?:\s*\)|\s*(?:CR|DR)\b|[+\-])?(?![\d.])/gi;
const SUMMARY = /\b(?:beginning balance|opening balance|closing balance|ending balance|previous balance|new balance|balance brought forward|balance carried forward|total (?:deposits|withdrawals|payments|purchases|fees|credits|debits|interest)|minimum payment|payment due|statement period|billing period|annual percentage|daily balance|balance summary)\b/i;

export function dateISO(raw, year, order = 'mdy', endMonth = null) {
  const value = raw.trim(); let y = Number(year), m, d; let explicit = false;
  const iso = value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  const numeric = value.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/);
  const named = value.match(/^([A-Za-z]+)\s+(\d{1,2})(?:,?\s+(\d{4}))?$/);
  if (iso) { y = +iso[1]; m = +iso[2]; d = +iso[3]; explicit = true; }
  else if (numeric) { m = +(order === 'dmy' ? numeric[2] : numeric[1]); d = +(order === 'dmy' ? numeric[1] : numeric[2]); if (numeric[3]) { y = +numeric[3]; if (y < 100) y += 2000; explicit = true; } }
  else if (named) { m = MONTHS.indexOf(named[1].slice(0, 3).toLowerCase()) + 1; d = +named[2]; if (named[3]) { y = +named[3]; explicit = true; } }
  else return '';
  if (!explicit && endMonth === 1 && m === 12) y -= 1;
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return '';
  const check = new Date(Date.UTC(y, m - 1, d));
  return check.getUTCFullYear() === y && check.getUTCMonth() === m - 1 && check.getUTCDate() === d ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : '';
}

export function parseMoney(raw) {
  const cleaned = raw.trim();
  const n = Number(cleaned.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n) || !/\d/.test(cleaned)) return null;
  return /[-−(]|CR\b/i.test(cleaned) ? -n : n;
}

export function inferPeriod(lines) {
  const head = lines.slice(0, 45).map(l => l.text).join('\n');
  const dateRE = /\b(20\d{2}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[/.-]\d{1,2}[/.-]20\d{2}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+20\d{2})\b/gi;
  const candidates = [...head.matchAll(dateRE)].map(m => dateISO(m[0], new Date().getFullYear())).filter(Boolean).sort();
  const end = candidates.at(-1);
  const years = head.match(/\b20\d{2}\b/g);
  return { year: end ? +end.slice(0, 4) : years?.length ? +years.at(-1) : new Date().getFullYear(), endMonth: end ? +end.slice(5, 7) : null, detected: !!end || !!years?.length };
}

export function categoryFor(description) {
  const s = description.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  const rules = [
    [/\b(publix|aldi|walmart grocery|walmart neighborhood|whole foods|trader joe|kroger)\b/, 'Groceries'],
    [/\b(shell|chevron|exxon|mobil|sunoco|marathon gas)\b/, 'Gas'],
    [/\b(chick fil a|mcdonald|mcdonalds|taco bell|wendy|wendys|burger king|chipotle|subway|popeyes)\b/, 'Fast Food'],
    [/\b(netflix|spotify|apple com bill|apple subscription|hulu|disney plus)\b/, 'Subscriptions'],
    [/\b(fpl|electric|water utility|rent|insurance|comcast|xfinity|att bill)\b/, 'Bills'],
    [/\b(uber|lyft|toll|parking|sunpass)\b/, 'Car / Transportation'],
    [/\b(amazon|target|best buy)\b/, 'Shopping'],
    [/\b(restaurant|cafe|bistro|steakhouse)\b/, 'Restaurants'],
  ];
  return rules.find(([re]) => re.test(s))?.[1] ?? 'Other / Uncategorized';
}

/** Rebuild reading order from positioned PDF text or OCR words. */
export function groupSpans(spans, page, source = 'text') {
  const rows = [];
  for (const span of spans.filter(s => s.text.trim()).sort((a, b) => a.y - b.y || a.x - b.x)) {
    const tolerance = Math.max(2.5, Math.min(span.height || 10, 14) * .4);
    let row = rows.findLast(r => Math.abs(r.y - span.y) <= tolerance);
    if (!row) { row = { y: span.y, spans: [], page, source }; rows.push(row); }
    row.spans.push(span);
  }
  return rows.sort((a, b) => a.y - b.y).map((row, i) => {
    let text = '';
    const positioned = row.spans.sort((a, b) => a.x - b.x).map(span => {
      if (text) text += ' ';
      const start = text.length; text += span.text.trim();
      return { ...span, start, end: text.length };
    });
    return { ...row, spans: positioned, text, id: `${page}-${i}` };
  });
}

function xAt(line, offset) {
  const span = line.spans?.find(s => offset >= s.start && offset <= s.end);
  if (!span) return offset * 5;
  return span.x + (offset - span.start) / Math.max(1, span.end - span.start) * span.width;
}

function headerColumns(line) {
  if (DATE_START.test(line.text.trim())) return null;
  if (!/\b(date|description|details|transaction)\b/i.test(line.text)) return null;
  const re = /\b(withdrawals?|debits?|money out|payments? and withdrawals?|charges?|deposits?|credits?|money in|balance|amount)\b/gi;
  const headers = [...line.text.matchAll(re)].map(m => ({
    kind: /balance/i.test(m[0]) ? 'balance' : /deposit|credit|money in/i.test(m[0]) ? 'credit' : /amount/i.test(m[0]) ? 'amount' : 'debit',
    x: xAt(line, m.index + m[0].length / 2),
  }));
  return headers.length ? headers : null;
}

export function parseLines(lines, options = {}) {
  const period = inferPeriod(lines);
  const opts = { year: period.year, endMonth: period.endMonth, order: 'mdy', sign: 'auto', ...options };
  let columns = null, section = '', page = null, pending = null;
  const result = [], unmatched = [];
  const add = (line) => {
    const dates = []; let rest = line.text.trim(); let used = line.text.length - rest.length;
    for (let i = 0; i < 2; i++) { const m = rest.match(DATE_START); if (!m) break; dates.push(m[0]); used += m[0].length; rest = rest.slice(m[0].length); const ws = rest.match(/^\s*/)[0].length; used += ws; rest = rest.slice(ws); }
    if (!dates.length) return false;
    if (SUMMARY.test(rest)) return true;
    const amounts = [...rest.matchAll(MONEY)].map(m => ({ raw: m[0].trim(), value: parseMoney(m[0]), offset: used + m.index, x: xAt(line, used + m.index + m[0].trimEnd().length / 2) }));
    if (!amounts.length) return false;
    let candidates = amounts.map(a => ({ ...a, column: columns?.length ? columns.reduce((best, h) => Math.abs(h.x - a.x) < Math.abs(best.x - a.x) ? h : best).kind : null }));
    if (columns?.some(h => h.kind === 'balance')) candidates = candidates.filter(a => a.column !== 'balance');
    if (!candidates.length) { unmatched.push({ ...line, reason: 'Only a balance was found; no transaction amount.' }); return true; }
    const actual = candidates.filter(a => a.value !== 0);
    const picked = actual[0] ?? candidates[0];
    if (!picked || picked.value === 0) return true;
    let description = rest.slice(0, amounts[0].offset - used).trim();
    // Some layouts print amount before merchant. Preserve the text after the last amount.
    if (!description) { const last = [...rest.matchAll(MONEY)].at(-1); description = rest.slice(last.index + last[0].length).trim(); }
    description = description.replace(/^[\s|:]+|[\s|:]+$/g, '');
    if (!description || !/[A-Za-z]/.test(description)) { unmatched.push({ ...line, reason: 'Merchant or description needs a check.' }); return true; }
    const reasons = [];
    if (!period.detected && !/\b\d{4}\b/.test(dates[0])) reasons.push(`Year assumed: check ${opts.year} in reading settings.`);
    if (actual.length > 1) reasons.push('Multiple amounts: check the transaction amount.');
    const date = dateISO(dates[0], opts.year, opts.order, opts.endMonth);
    if (!date) reasons.push('Check the date.');
    let type = 'expense'; let known = false;
    if (/\b(?:transfer|payment received|payment thank|autopay payment|automatic payment|online payment|payment to.*(?:card|visa|mastercard)|credit card payment)\b/i.test(description)) { type = 'transfer'; known = true; reasons.push('Check that this is a transfer, not a purchase.'); }
    else if (/\b(?:refund|return credit|merchandise credit)\b/i.test(description)) { type = 'refund'; known = true; }
    else if (picked.column === 'credit') { type = opts.sign === 'card' ? 'refund' : 'income'; known = true; }
    else if (picked.column === 'debit') { type = 'expense'; known = true; }
    else if (section === 'credit') { type = opts.sign === 'card' ? 'refund' : 'income'; known = true; }
    else if (section === 'debit') { type = 'expense'; known = true; }
    else if (/\b(payroll|direct deposit|salary|interest paid)\b/i.test(description)) { type = 'income'; known = true; }
    else if (opts.sign === 'bank') { type = picked.value < 0 ? 'expense' : 'income'; known = true; }
    else if (opts.sign === 'card') { type = picked.value < 0 ? 'refund' : 'expense'; known = true; }
    else if (/CR\b/i.test(picked.raw)) { type = 'refund'; known = true; }
    else if (picked.value < 0) { type = 'expense'; reasons.push('Check whether this negative amount is spending or a card refund.'); }
    if (!known && picked.value >= 0) reasons.push('Spending assumed: check the transaction type.');
    if (line.source === 'ocr') reasons.push('Scanned text: check the date, merchant, and amount.');
    result.push({ id: `r-${result.length + 1}`, date, rawDate: dates[0], description, amount: Math.abs(picked.value).toFixed(2), type, category: categoryFor(description), included: true, reviewed: reasons.length === 0, reasons, page: line.page, source: line.text, method: line.source ?? 'text' });
    return true;
  };
  for (const line of lines) {
    if (page !== line.page) { if (pending) unmatched.push({ ...pending, reason: 'Dated line has no recognized amount.' }); pending = null; page = line.page; columns = null; section = ''; }
    const headers = headerColumns(line);
    if (headers) { columns = headers; continue; }
    const isDate = DATE_START.test(line.text.trim());
    if (!isDate && /^(?:deposits? (?:and|&) (?:other )?(?:additions|credits)|payments? (?:and|&) (?:other )?credits|deposits?|credits?)\s*(?:continued)?\s*$/i.test(line.text)) { section = 'credit'; continue; }
    if (!isDate && /^(?:withdrawals? (?:and|&) (?:other )?(?:debits|deductions)|purchases?(?: (?:and|&) (?:other )?(?:charges|adjustments))?|payments? (?:and|&) (?:other )?withdrawals|debits?|electronic withdrawals|card purchases|fees charged)\s*(?:continued)?\s*$/i.test(line.text)) { section = 'debit'; continue; }
    if (isDate) {
      if (pending) unmatched.push({ ...pending, reason: 'Dated line has no recognized amount.' });
      pending = add(line) ? null : line;
    } else if (pending && !SUMMARY.test(line.text) && line.text.length < 240) {
      const joined = { ...pending, text: `${pending.text} ${line.text}`, spans: [] };
      if (add(joined)) pending = null; else pending = joined;
    }
  }
  if (pending) unmatched.push({ ...pending, reason: 'Dated line has no recognized amount.' });
  // Repeated transactions can be real. Flag, never silently deduplicate.
  const seen = new Set();
  for (const row of result) { const key = [row.date, row.description.toLowerCase(), row.amount, row.type].join('|'); if (seen.has(key)) { row.reasons.push('Possible duplicate: compare with the statement.'); row.reviewed = false; } seen.add(key); }
  return { rows: result, unmatched, period };
}

export function rowErrors(row) {
  const errors = [];
  if (!dateISO(row.date, 2000) || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) errors.push('date');
  if (!row.description.trim()) errors.push('description');
  if (!/^\d+(?:\.\d{1,2})?$/.test(String(row.amount).trim()) || Number(row.amount) <= 0 || Number(row.amount) > 1e10) errors.push('amount');
  if (!TYPES.includes(row.type)) errors.push('type');
  return errors;
}

/** Quoted text fields also receive a formula guard for spreadsheet apps. */
export function csvCell(value, numeric = false) {
  let text = String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  if (!numeric && /^[\s]*[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function exportCsv(rows, { mode = 'paycheck', account = '' } = {}) {
  const selected = rows.filter(r => r.included && (mode === 'all' || r.type === 'expense'));
  if (!selected.length) throw new Error(mode === 'paycheck' ? 'There are no spending rows selected.' : 'Select at least one transaction.');
  if (selected.some(r => rowErrors(r).length)) throw new Error('Fix the highlighted dates, descriptions, or amounts before downloading.');
  if (selected.some(r => !r.reviewed)) throw new Error('Review the flagged transactions before downloading.');
  const headers = mode === 'paycheck' ? ['Date', 'Description', 'Amount'] : ['Date', 'Description', 'Debit', 'Credit', 'Type', 'Category', 'Account'];
  const records = selected.map(r => {
    const amount = Number(r.amount).toFixed(2);
    const values = mode === 'paycheck' ? [r.date, r.description, amount] : [r.date, r.description, r.type === 'expense' ? amount : '', r.type === 'income' || r.type === 'refund' ? amount : '', r.type, r.category, account];
    // Transfers retain their amount in a separate row field below, without becoming a Debit.
    return values;
  });
  if (mode === 'all') { headers.push('Transfer Amount'); records.forEach((v, i) => v.push(selected[i].type === 'transfer' ? Number(selected[i].amount).toFixed(2) : '')); }
  return '\uFEFF' + [headers, ...records].map((cells, i) => cells.map((value, j) => csvCell(value, i > 0 && (j === 2 || mode === 'all' && (j === 3 || j === 7)))).join(',')).join('\r\n') + '\r\n';
}
