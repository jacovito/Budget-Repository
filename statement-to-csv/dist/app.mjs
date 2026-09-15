import { CATEGORIES, TYPES, groupSpans, parseLines, rowErrors, exportCsv, inferPeriod, categoryFor } from './parser.mjs';
import { readPageText } from './pdf-text.mjs';

const $ = s => document.querySelector(s);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dollars = n => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
const title = s => s[0].toUpperCase() + s.slice(1);
const state = { lines: [], rows: [], unmatched: [], file: null, pdfUrl: null, pages: 0, scanPages: 0, filter: 'all', page: 0, pageSize: 30, account: '', mode: 'paycheck', confirmed: false, opts: { year: new Date().getFullYear(), order: 'mdy', sign: 'auto', endMonth: null }, example: false };
let generation = 0, loadingTask = null, pdfDocument = null, ocrWorker = null, renderTask = null, ocrScript = null, reading = false, activeOcrPage = 0;

function message(text, kind = '') { const el = $('#message'); el.textContent = text; el.className = `message ${kind}`; el.hidden = !text; }
function progress(text, detail, value) { $('#progress-title').textContent = text; $('#progress-detail').textContent = detail; $('#progress-bar').value = value; }
function panel(name) {
  for (const p of ['upload', 'progress', 'review']) $(`#${p}-panel`).hidden = p !== name;
  document.body.classList.toggle('page-review', name === 'review');
  $('#step-upload').className = name === 'upload' ? 'active' : 'done';
  $('#step-review').className = name === 'review' ? 'active' : '';
  $('#step-download').className = '';
}

async function cleanupEngines() {
  renderTask?.cancel(); renderTask = null;
  if (ocrWorker) { const w = ocrWorker; ocrWorker = null; try { await w.terminate(); } catch {} }
  if (loadingTask) { const t = loadingTask; loadingTask = null; pdfDocument = null; try { await t.destroy(); } catch {} }
}

async function cancel() {
  generation++; reading = false;
  if ($('#password-dialog').open) $('#password-dialog').close('cancel');
  await cleanupEngines();
  panel(state.rows.length ? 'review' : 'upload');
  message('Reading cancelled.');
  $('#file-input').value = '';
}

function reset() {
  generation++; cleanupEngines();
  if (state.pdfUrl) URL.revokeObjectURL(state.pdfUrl);
  Object.assign(state, { lines: [], rows: [], unmatched: [], file: null, pdfUrl: null, pages: 0, scanPages: 0, page: 0, filter: 'all', confirmed: false, example: false, account: '' });
  $('#file-input').value = ''; $('#review-panel').replaceChildren(); message(''); panel('upload');
}

function loadOcrScript() {
  if (!ocrScript) ocrScript = new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = '/vendor/ocr/tesseract.min.js';
    script.onload = resolve; script.onerror = () => { ocrScript = null; script.remove(); reject(new Error('The scan reader could not load. Check your connection and try again.')); };
    document.head.append(script);
  });
  return ocrScript;
}

async function getOcrWorker(token) {
  if (ocrWorker) return ocrWorker;
  await loadOcrScript();
  if (token !== generation) throw new Error('cancelled');
  const worker = await window.Tesseract.createWorker('eng', 1, {
    workerPath: `${location.origin}/vendor/ocr/worker.min.js`,
    corePath: `${location.origin}/vendor/ocr`, langPath: `${location.origin}/vendor/ocr`,
    workerBlobURL: false, cacheMethod: 'none',
    logger: m => { if (token === generation) progress('Reading scanned text', `Page ${activeOcrPage} of ${state.pages} · ${m.status === 'recognizing text' ? `${Math.round((m.progress || 0) * 100)}% read` : 'Loading the scan reader…'}`, ((activeOcrPage - 1) + (m.progress || 0)) / state.pages * 100); },
    errorHandler: () => {},
  });
  if (token !== generation) { await worker.terminate(); throw new Error('cancelled'); }
  await worker.setParameters({ preserve_interword_spaces: '1' });
  ocrWorker = worker; return worker;
}

async function scanPage(page, number, token) {
  activeOcrPage = number;
  const worker = await getOcrWorker(token);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(2.5, Math.sqrt(4500000 / (base.width * base.height)));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  try {
    renderTask = page.render({ canvasContext: context, viewport, background: '#fff' }); await renderTask.promise; renderTask = null;
    if (token !== generation) throw new Error('cancelled');
    const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
    const spans = (data.blocks ?? []).flatMap(b => b.paragraphs ?? []).flatMap(p => p.lines ?? []).flatMap(l => l.words ?? []).map(w => ({ text: w.text, x: w.bbox.x0 / scale, y: (w.bbox.y0 + w.bbox.y1) / 2 / scale, width: (w.bbox.x1 - w.bbox.x0) / scale, height: (w.bbox.y1 - w.bbox.y0) / scale }));
    if (spans.length) return groupSpans(spans, number, 'ocr');
    return (data.text || '').split('\n').filter(s => s.trim()).map((text, i) => ({ id: `${number}-${i}`, text: text.trim(), page: number, source: 'ocr', spans: [] }));
  } finally { canvas.width = 0; canvas.height = 0; }
}

async function openFile(file, forceScan = false) {
  if (!file) return;
  if (!/\.pdf$/i.test(file.name)) { message('Choose a PDF statement. Other file types are not supported.', 'error'); return; }
  if (file.size > 25 * 1024 * 1024) { message('This PDF is larger than 25 MB. Export a shorter statement or split the PDF first.', 'error'); return; }
  if (reading) return;
  await cleanupEngines();
  const token = ++generation; reading = true;
  state.rows = []; state.lines = []; state.unmatched = []; state.page = 0; state.filter = 'all'; state.confirmed = false; state.example = false; state.scanPages = 0;
  state.file = file;
  if (state.pdfUrl) URL.revokeObjectURL(state.pdfUrl);
  state.pdfUrl = URL.createObjectURL(file);
  message(''); panel('progress'); progress('Reading your statement', 'Opening the PDF…', 1);
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!new TextDecoder().decode(bytes.slice(0, 1024)).includes('%PDF-')) throw new Error('This file does not appear to be a valid PDF. Download the original PDF statement from your bank.');
    const pdfjs = await import('./vendor/pdfjs/pdf.mjs');
    if (token !== generation) return;
    pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.mjs';
    loadingTask = pdfjs.getDocument({ data: bytes, cMapUrl: '/vendor/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: '/vendor/pdfjs/standard_fonts/', wasmUrl: '/vendor/pdfjs/wasm/', isEvalSupported: false, enableXfa: false });
    loadingTask.onPassword = (updatePassword, reason) => {
      const dialog = $('#password-dialog'); $('#pdf-password').value = ''; $('#password-error').hidden = reason !== 2;
      dialog.addEventListener('close', () => {
        if (dialog.returnValue === 'unlock') { const value = $('#pdf-password').value; $('#pdf-password').value = ''; updatePassword(value); }
        else if (token === generation) cancel();
      }, { once: true });
      dialog.returnValue = 'cancel'; dialog.showModal(); $('#pdf-password').focus();
    };
    pdfDocument = await loadingTask.promise;
    if (token !== generation) return;
    state.pages = pdfDocument.numPages;
    if (state.pages > 100) throw new Error('Choose a statement with 100 pages or fewer. A monthly statement usually works best.');
    for (let i = 1; i <= state.pages; i++) {
      if (token !== generation) return;
      progress('Reading your statement', `Extracting page ${i} of ${state.pages}…`, (i - 1) / state.pages * 100);
      const page = await pdfDocument.getPage(i); const viewport = page.getViewport({ scale: 1 });
      let lines = [];
      if (!forceScan) {
        const content = await readPageText(page);
        const spans = content.items.filter(item => typeof item.str === 'string').map(item => {
          const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
          return { text: item.str, x, y, width: item.width, height: item.height };
        });
        lines = groupSpans(spans, i);
      }
      if (forceScan || lines.map(l => l.text).join('').replace(/[^a-zA-Z0-9]/g, '').length < 60) {
        state.scanPages++;
        if (state.scanPages > 20) throw new Error('Scanned statements are limited to 20 pages at a time. Split this PDF into smaller parts and try again.');
        lines = await scanPage(page, i, token);
      }
      state.lines.push(...lines); page.cleanup();
    }
    if (token !== generation) return;
    const period = inferPeriod(state.lines); state.opts = { ...state.opts, year: period.year, endMonth: period.endMonth };
    const parsed = parseLines(state.lines, state.opts); state.rows = parsed.rows; state.unmatched = parsed.unmatched;
    renderReview(); panel('review');
    if (!state.rows.length) message('No transaction rows were recognized. Try “Read as a scan,” adjust the reading settings, or add rows from the original PDF.', 'error');
    else if (state.scanPages) message(`${state.scanPages} scanned page${state.scanPages === 1 ? '' : 's'} read. Check each extracted row against the PDF before downloading.`);
  } catch (error) {
    if (token !== generation) return;
    panel('upload');
    const text = String(error?.message || error);
    message(/InvalidPDF|Invalid PDF|Invalid XRef|trailer|startxref/i.test(text) ? 'This PDF could not be read. Download a fresh copy of the statement and try again.' : text.includes('fetch') ? 'The PDF reader could not finish loading. Check your connection and try again.' : text, 'error');
  } finally {
    if (token === generation) { reading = false; await cleanupEngines(); $('#file-input').value = ''; }
  }
}

function optionList(values, current, blank = false) { return (blank ? '<option value="">Choose…</option>' : '') + values.map(v => `<option value="${esc(v)}" ${v === current ? 'selected' : ''}>${esc(TYPES.includes(v) ? title(v) : v)}</option>`).join(''); }
function filteredRows() { return state.rows.filter(r => state.filter === 'review' ? r.included && (!r.reviewed || rowErrors(r).length) : state.filter === 'expense' ? r.type === 'expense' : true); }
function selectedRows() { return state.rows.filter(r => r.included && (state.mode === 'all' || r.type === 'expense')); }
function totals() {
  const included = state.rows.filter(r => r.included);
  const sum = type => included.filter(r => r.type === type && !rowErrors(r).includes('amount')).reduce((s, r) => s + Math.round(Number(r.amount) * 100), 0) / 100;
  return { expense: sum('expense'), income: sum('income') + sum('refund'), transfers: included.filter(r => r.type === 'transfer').length, review: included.filter(r => !r.reviewed || rowErrors(r).length).length };
}

function renderReview() {
  document.body.classList.toggle('paycheck-mode', state.mode === 'paycheck');
  const s = totals();
  $('#review-panel').innerHTML = `<div class="review-heading"><div><h2>Review your transactions</h2><p class="file-meta">${esc(state.example ? 'Example statement · sample data' : state.file?.name)} · ${state.pages} page${state.pages === 1 ? '' : 's'} · ${state.scanPages ? 'scan reader' : 'text extraction'} · Year ${state.opts.year}</p></div><div class="actions">${state.pdfUrl ? `<a href="${esc(state.pdfUrl)}" target="_blank" rel="noopener" class="button secondary compact-button">View original PDF ↗</a>` : ''}<button id="start-over" class="button secondary compact-button">Choose another PDF</button></div></div>
  <div class="summary-bar" aria-label="Selected transaction totals"><div class="stat"><p class="stat-label">Spending</p><p class="stat-value" id="total-expense">${dollars(s.expense)}</p><p class="stat-note">Selected expenses</p></div><div class="stat"><p class="stat-label">Money in & refunds</p><p class="stat-value" id="total-income">${dollars(s.income)}</p><p class="stat-note">Kept out of spending</p></div><div class="stat"><p class="stat-label">Transfers</p><p class="stat-value" id="total-transfers">${s.transfers}</p><p class="stat-note">Kept out of spending</p></div><div class="stat"><p class="stat-label">Needs a check</p><p class="stat-value" id="total-review">${s.review}</p><p class="stat-note">Rows to review</p></div></div>
  <details class="settings"><summary>Reading settings & account</summary><div class="settings-grid"><label>Statement year<input id="setting-year" type="number" min="1900" max="2200" step="1" value="${state.opts.year}"></label><label>Date format<select id="setting-order"><option value="mdy" ${state.opts.order === 'mdy' ? 'selected' : ''}>Month / day</option><option value="dmy" ${state.opts.order === 'dmy' ? 'selected' : ''}>Day / month</option></select></label><label>Amounts on this statement<select id="setting-sign"><option value="auto" ${state.opts.sign === 'auto' ? 'selected' : ''}>Detect from columns</option><option value="bank" ${state.opts.sign === 'bank' ? 'selected' : ''}>Bank: − is spending</option><option value="card" ${state.opts.sign === 'card' ? 'selected' : ''}>Credit card: + is spending</option></select></label><label class="spreadsheet-only">Account name <small>Optional · included in CSV</small><input id="setting-account" placeholder="e.g. Checking" maxlength="100" value="${esc(state.account)}"></label><button class="button secondary" id="apply-settings">Read again</button></div><p class="settings-caption">Year is used for dates without a year. Reading again replaces edits to the extracted rows. Uses USD-style amounts (1,234.56); English scanned text.</p></details>
  <div class="toolbar"><div class="filter-buttons" aria-label="Transaction filter"><button data-filter="all" class="${state.filter === 'all' ? 'selected' : ''}">All <span id="count-all">${state.rows.length}</span></button><button data-filter="expense" class="${state.filter === 'expense' ? 'selected' : ''}">Spending</button><button data-filter="review" class="${state.filter === 'review' ? 'selected' : ''}">Review <span id="count-review">${s.review}</span></button></div><div class="actions">${!state.example ? '<button class="button secondary compact-button" id="read-scan">Read as a scan</button>' : ''}<button class="button secondary compact-button" id="add-row">+ Add a row</button><button class="button secondary compact-button" id="mark-visible">Mark this page reviewed</button></div></div>
  <div class="table-wrap"><table aria-label="Extracted transactions"><thead><tr><th><input type="checkbox" id="include-page" aria-label="Include all rows on this page"></th><th>Date</th><th>Description / merchant</th><th>Amount</th><th>Type</th><th class="spreadsheet-only">Category</th><th>Review</th></tr></thead><tbody id="transaction-body"></tbody></table><div id="table-empty" class="table-empty" hidden>No rows in this view.</div><div class="table-footer"><span id="row-count"></span><div class="pager"><button id="prev-page" aria-label="Previous page">←</button><span id="page-label"></span><button id="next-page" aria-label="Next page">→</button></div></div></div>
  ${state.unmatched.length ? `<details class="unmatched"><summary>${state.unmatched.length} dated line${state.unmatched.length === 1 ? '' : 's'} could not be converted</summary><div class="unmatched-content"><p>These lines are not included in the CSV. Compare them with the original PDF and add any missing transactions.</p>${state.unmatched.map((l, i) => `<div class="unmatched-item"><div><span>Page ${l.page} · ${esc(l.reason)}</span><code>${esc(l.text)}</code></div><button class="button secondary" data-add-unmatched="${i}">Add as a row</button></div>`).join('')}</div></details>` : ''}
  <div class="export-panel"><div><h3>Ready for your budget</h3><p id="export-note"></p><label class="review-confirm"><input type="checkbox" id="final-confirm" ${state.confirmed ? 'checked' : ''}>I checked the dates, amounts, and missing rows against the statement.</label></div><div class="export-actions"><label><span class="sr-only">CSV format</span><select id="export-mode"><option value="paycheck" ${state.mode === 'paycheck' ? 'selected' : ''}>Paycheck · spending only</option><option value="all" ${state.mode === 'all' ? 'selected' : ''}>Spreadsheet · all types</option></select></label><button class="button primary" id="download-csv">Download CSV ↓</button></div></div>`;
  renderRows(); updateSummary(); wireReview();
}

function renderRows() {
  const filtered = filteredRows(); const max = Math.max(0, Math.ceil(filtered.length / state.pageSize) - 1); state.page = Math.min(state.page, max);
  const visible = filtered.slice(state.page * state.pageSize, (state.page + 1) * state.pageSize);
  $('#transaction-body').innerHTML = visible.map(row => {
    const errors = rowErrors(row); const needs = !row.reviewed || errors.length;
    return `<tr data-row="${row.id}" class="${needs ? 'review-row' : ''} ${!row.included ? 'excluded-row' : ''}"><td><input type="checkbox" data-field="included" aria-label="Include ${esc(row.description)}" ${row.included ? 'checked' : ''}></td><td><span class="mobile-label">Date</span><input type="date" data-field="date" value="${esc(row.date)}" aria-label="Transaction date" aria-invalid="${errors.includes('date')}"></td><td><span class="mobile-label">Description / merchant</span><input type="text" data-field="description" value="${esc(row.description)}" aria-label="Description or merchant" maxlength="500" aria-invalid="${errors.includes('description')}">${needs ? `<p class="row-note">${esc(errors.length ? `Fix ${errors.join(', ')}.` : row.reasons[0] || 'Check this row.')}</p>` : ''}<button class="source-toggle" data-source="${row.id}" aria-expanded="false">Source · page ${row.page}</button><div class="row-source" id="source-${row.id}" hidden>${esc(row.source || 'Manually added row.')}${row.reasons.length > 1 ? `\n${esc(row.reasons.join(' '))}` : ''}</div></td><td><span class="mobile-label">Amount</span><input data-field="amount" type="text" inputmode="decimal" value="${esc(row.amount)}" aria-label="Transaction amount" aria-invalid="${errors.includes('amount')}"></td><td><span class="mobile-label">Type</span><select data-field="type" aria-label="Transaction type">${optionList(TYPES, row.type)}</select></td><td class="spreadsheet-only"><span class="mobile-label">Category</span><select data-field="category" aria-label="Spending category">${optionList(CATEGORIES, row.category)}</select></td><td>${needs ? `<button class="review-button" data-reviewed="${row.id}" aria-label="Mark ${esc(row.description)} reviewed">Reviewed</button>` : '<span class="checked-label">✓ Checked</span>'}<button class="delete-row" data-delete="${row.id}" aria-label="Remove ${esc(row.description)}">×</button></td></tr>`;
  }).join('');
  $('#table-empty').hidden = !!visible.length;
  $('#row-count').textContent = filtered.length ? `${state.page * state.pageSize + 1}–${Math.min((state.page + 1) * state.pageSize, filtered.length)} of ${filtered.length} rows` : '0 rows';
  $('#page-label').textContent = `Page ${state.page + 1} of ${max + 1}`; $('#prev-page').disabled = state.page === 0; $('#next-page').disabled = state.page >= max;
  $('#include-page').checked = !!visible.length && visible.every(r => r.included); $('#include-page').indeterminate = visible.some(r => r.included) && !visible.every(r => r.included);
  $('#mark-visible').disabled = !visible.some(r => r.included && !r.reviewed);
}

function updateSummary() {
  const s = totals(); $('#total-expense').textContent = dollars(s.expense); $('#total-income').textContent = dollars(s.income); $('#total-transfers').textContent = s.transfers; $('#total-review').textContent = s.review; $('#count-review').textContent = s.review; $('#count-all').textContent = state.rows.length;
  const selected = selectedRows(); const unresolved = selected.filter(r => !r.reviewed || rowErrors(r).length).length;
  $('#export-note').textContent = state.mode === 'paycheck' ? `${selected.length} spending rows. Income, refunds, and transfers stay out. Paycheck will apply its merchant rules after import.` : `${selected.length} selected rows. Separate Debit, Credit, and Transfer Amount columns keep their meaning clear.`;
  $('#download-csv').disabled = !state.confirmed || !selected.length || !!unresolved;
  $('#download-csv').title = unresolved ? `Review ${unresolved} selected row${unresolved === 1 ? '' : 's'} first.` : !state.confirmed ? 'Check the confirmation box after comparing with the statement.' : '';
}
function changed() { state.confirmed = false; $('#final-confirm').checked = false; $('#step-download').className = ''; message(''); updateSummary(); }

function addRow(source = null) {
  const raw = source?.text ?? ''; const candidate = parseLines(source ? [source] : [], state.opts).rows[0];
  const row = candidate ?? { date: '', description: raw, amount: '', type: 'expense', category: categoryFor(raw), included: true, reviewed: false, reasons: ['Enter the date, description, and amount.'], page: source?.page ?? 1, source: raw, method: 'manual' };
  row.id = `manual-${Date.now()}-${state.rows.length}`; state.rows.push(row); state.filter = 'all'; state.page = Math.floor((state.rows.length - 1) / state.pageSize); state.confirmed = false; renderReview(); $(`[data-row="${row.id}"] input[type=date]`)?.focus();
}

function wireReview() {
  $('#start-over').addEventListener('click', reset);
  $('#read-scan')?.addEventListener('click', () => openFile(state.file, true));
  $('#add-row').addEventListener('click', () => addRow());
  $('#setting-account').addEventListener('input', e => { state.account = e.target.value; });
  $('#apply-settings').addEventListener('click', () => {
    const year = Number($('#setting-year').value); if (!Number.isInteger(year) || year < 1900 || year > 2200) { message('Enter a statement year between 1900 and 2200.', 'error'); return; }
    state.opts = { ...state.opts, year, order: $('#setting-order').value, sign: $('#setting-sign').value };
    const parsed = parseLines(state.lines, state.opts); state.rows = parsed.rows; state.unmatched = parsed.unmatched; state.confirmed = false; state.page = 0; state.filter = 'all'; renderReview(); message('Transactions read again with your settings. Review the updated rows.');
  });
  for (const b of document.querySelectorAll('[data-filter]')) b.addEventListener('click', () => { state.filter = b.dataset.filter; state.page = 0; renderReview(); });
  $('#prev-page').addEventListener('click', () => { state.page--; renderRows(); }); $('#next-page').addEventListener('click', () => { state.page++; renderRows(); });
  $('#include-page').addEventListener('change', e => { filteredRows().slice(state.page * state.pageSize, (state.page + 1) * state.pageSize).forEach(r => r.included = e.target.checked); changed(); renderRows(); });
  $('#mark-visible').addEventListener('click', () => {
    const visible = filteredRows().slice(state.page * state.pageSize, (state.page + 1) * state.pageSize);
    for (const row of visible) if (row.included && !rowErrors(row).length) row.reviewed = true;
    changed(); renderRows(); message('Valid rows on this page marked reviewed. Any invalid values still need a correction.');
  });
  $('#transaction-body').addEventListener('input', e => {
    const field = e.target.dataset.field;
    if (!['date', 'description', 'amount'].includes(field)) return;
    const tr = e.target.closest('[data-row]'); const row = state.rows.find(r => r.id === tr.dataset.row); if (!row) return;
    row[field] = e.target.value; row.reviewed = false;
    if (field === 'description') { row.category = categoryFor(row.description); tr.querySelector('[data-field=category]').value = row.category; }
    const errors = rowErrors(row); e.target.setAttribute('aria-invalid', String(errors.includes(field))); tr.classList.add('review-row');
    if (!tr.querySelector('[data-reviewed]')) {
      tr.querySelector('.checked-label')?.remove(); const b = document.createElement('button'); b.className = 'review-button'; b.dataset.reviewed = row.id; b.textContent = 'Reviewed'; tr.lastElementChild.prepend(b);
    }
    changed();
  });
  $('#transaction-body').addEventListener('change', e => {
    const field = e.target.dataset.field; if (!field) return;
    if (['date', 'description', 'amount'].includes(field)) return;
    const row = state.rows.find(r => r.id === e.target.closest('[data-row]').dataset.row); if (!row) return;
    row[field] = field === 'included' ? e.target.checked : e.target.value;
    if (['date', 'description', 'amount', 'type'].includes(field)) row.reviewed = false;
    if (field === 'description') row.category = categoryFor(row.description);
    changed(); renderRows();
  });
  $('#transaction-body').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.source) { const el = $(`#source-${b.dataset.source}`); el.hidden = !el.hidden; b.setAttribute('aria-expanded', String(!el.hidden)); }
    if (b.dataset.reviewed) { const row = state.rows.find(r => r.id === b.dataset.reviewed); if (rowErrors(row).length) { message('Fix the highlighted values in this row first.', 'error'); return; } row.reviewed = true; changed(); renderRows(); }
    if (b.dataset.delete) { state.rows = state.rows.filter(r => r.id !== b.dataset.delete); changed(); renderRows(); }
  });
  for (const b of document.querySelectorAll('[data-add-unmatched]')) b.addEventListener('click', () => addRow(state.unmatched[Number(b.dataset.addUnmatched)]));
  $('#final-confirm').addEventListener('change', e => { state.confirmed = e.target.checked; updateSummary(); });
  $('#export-mode').addEventListener('change', e => { state.mode = e.target.value; changed(); renderReview(); });
  $('#download-csv').addEventListener('click', () => {
    try {
      if (!state.confirmed) throw new Error('Compare the rows with your statement and check the confirmation box first.');
      const csv = exportCsv(state.rows, { mode: state.mode, account: state.account }); const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob); const link = document.createElement('a');
      link.href = url; link.download = `${(state.file?.name ?? 'example-statement').replace(/\.pdf$/i, '').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 100)}-${state.mode === 'paycheck' ? 'paycheck' : 'transactions'}.csv`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
      $('#step-review').className = 'done'; $('#step-download').className = 'active'; message(state.mode === 'paycheck' ? 'Your CSV is ready. In Paycheck, choose Import and select the downloaded CSV. Check its preview, then import.' : 'Your CSV is ready to open in Excel, Google Sheets, or another spreadsheet app.', 'success'); $('#message').scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (error) { message(error.message, 'error'); }
  });
}

function example() {
  reset(); state.example = true; state.pages = 1; state.opts = { year: 2026, endMonth: 8, order: 'mdy', sign: 'card' };
  const lines = ['Statement period August 1, 2026 to August 31, 2026', 'Date Description Amount', '08/03 Publix 87.42', '08/05 Shell 42.18', '08/06 Chick-fil-A 18.65', '08/08 Netflix 15.49', '08/10 Online payment thank you -950.00', '08/12 Local Restaurant 64.20', '08/14 Store refund -24.99'];
  state.lines = lines.map((text, i) => ({ id: `1-${i}`, page: 1, source: 'text', text, spans: [] })); const parsed = parseLines(state.lines, state.opts); state.rows = parsed.rows; state.unmatched = parsed.unmatched; renderReview(); panel('review'); message('This is sample data. Choose your own PDF when you are ready.');
}

$('#file-input').addEventListener('change', e => openFile(e.target.files[0]));
$('#try-example').addEventListener('click', example); $('#cancel-read').addEventListener('click', cancel);
for (const event of ['dragenter', 'dragover']) $('#dropzone').addEventListener(event, e => { e.preventDefault(); $('#dropzone').classList.add('dragover'); });
$('#dropzone').addEventListener('dragleave', e => { if (!$('#dropzone').contains(e.relatedTarget)) $('#dropzone').classList.remove('dragover'); });
$('#dropzone').addEventListener('drop', e => { e.preventDefault(); $('#dropzone').classList.remove('dragover'); if (e.dataTransfer.files.length > 1) message('Choose one statement at a time.', 'error'); else openFile(e.dataTransfer.files[0]); });
window.addEventListener('dragover', e => e.preventDefault()); window.addEventListener('drop', e => e.preventDefault());
window.addEventListener('pagehide', () => { generation++; cleanupEngines(); if (state.pdfUrl) URL.revokeObjectURL(state.pdfUrl); state.file = null; state.rows = []; state.lines = []; state.unmatched = []; });
