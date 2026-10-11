'use strict';

/* ================= Data ================= */
const STORE_KEY = 'mc-data-v1';
const PREV_KEY = 'mc-data-prev';
const UI_KEY = 'mc-ui';
const MONTHS_MS = ['Januari', 'Februari', 'Mac', 'April', 'Mei', 'Jun', 'Julai', 'Ogos', 'September', 'Oktober', 'November', 'Disember'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ogo', 'Sep', 'Okt', 'Nov', 'Dis'];

function emptyData() {
  return {
    app: 'monthly-commitment',
    version: 1,
    people: [{ id: 'adzim', name: 'Adzim' }, { id: 'wahidah', name: 'Wahidah' }],
    items: { adzim: [], wahidah: [] },
    months: {},
    refs: { adzim: [], wahidah: [] },
    updatedAt: null,
    lastBackupAt: null,
  };
}

function normalize(d) {
  const base = emptyData();
  d = Object.assign(base, d || {});
  for (const p of d.people) {
    d.items[p.id] = d.items[p.id] || [];
    d.refs[p.id] = d.refs[p.id] || [];
  }
  return d;
}

function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } }

let data = (() => {
  try { const raw = lsGet(STORE_KEY); return raw ? normalize(JSON.parse(raw)) : null; } catch { return null; }
})();

function save() {
  data.updatedAt = new Date().toISOString();
  if (!lsSet(STORE_KEY, JSON.stringify(data))) toast('Gagal simpan! Storan penuh? Buat backup sekarang.');
}

/* ================= UI state ================= */
const ui = Object.assign({ view: 'month', person: 'all', month: null, showEmpty: false, histYear: null },
  (() => { try { return JSON.parse(lsGet(UI_KEY) || '{}'); } catch { return {}; } })());
function saveUi() { lsSet(UI_KEY, JSON.stringify({ view: ui.view, person: ui.person, showEmpty: ui.showEmpty })); }

/* ================= Helpers ================= */
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const monthKeys = () => Object.keys(data.months).sort();
const latestMonth = () => monthKeys().at(-1) || null;
const people = () => data.people.filter(p => ui.person === 'all' || ui.person === p.id);
const personName = id => (data.people.find(p => p.id === id) || {}).name || id;
const itemsOf = pid => data.items[pid];
const findItem = (pid, iid) => itemsOf(pid).find(i => i.id === iid);
const uid = () => Math.random().toString(36).slice(2, 10);

function monthLabel(k, short) {
  const [y, m] = k.split('-').map(Number);
  return short ? `${MONTHS_SHORT[m - 1]} ${String(y).slice(2)}` : `${MONTHS_MS[m - 1]} ${y}`;
}
function nextKey(k) {
  let [y, m] = k.split('-').map(Number);
  m++; if (m > 12) { m = 1; y++; }
  return `${y}-${String(m).padStart(2, '0')}`;
}
function currentKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function shortDate(iso) {
  if (!iso) return '';
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS_SHORT[m - 1]}`;
}

/* Safe arithmetic for values like "=750-300-365-200" (no eval). */
function calc(expr) {
  const s = String(expr).replace(/^=/, '').replace(/\s+/g, '').replace(/,/g, '');
  let i = 0;
  const peek = () => s[i];
  function num() {
    if (peek() === '(') { i++; const v = add(); if (s[i++] !== ')') throw 0; return v; }
    if (peek() === '-') { i++; return -num(); }
    if (peek() === '+') { i++; return num(); }
    const m = /^\d*\.?\d+/.exec(s.slice(i));
    if (!m) throw 0;
    i += m[0].length;
    return parseFloat(m[0]);
  }
  function mul() {
    let v = num();
    while (peek() === '*' || peek() === '/') { const op = s[i++]; const r = num(); v = op === '*' ? v * r : v / r; }
    return v;
  }
  function add() {
    let v = mul();
    while (peek() === '+' || peek() === '-') { const op = s[i++]; const r = mul(); v = op === '+' ? v + r : v - r; }
    return v;
  }
  const v = add();
  if (i !== s.length || !isFinite(v)) throw 0;
  return v;
}
function isFormula(v) { return typeof v === 'string' && v.trim().startsWith('='); }
/* Returns {n: number, text: string|null, ok: bool} */
function valueOf(v) {
  if (v === '' || v == null) return { n: 0, text: null, ok: true, empty: true };
  if (typeof v === 'number') return { n: v, text: null, ok: true };
  const s = String(v).trim();
  if (isFormula(s)) { try { return { n: calc(s), text: null, ok: true }; } catch { return { n: 0, text: s, ok: false }; } }
  const n = Number(s.replace(/,/g, '').replace(/^RM\s*/i, ''));
  if (s && isFinite(n)) return { n, text: null, ok: true };
  return { n: 0, text: s, ok: true };
}
function parseInput(s) {
  s = String(s).trim();
  if (!s) return '';
  if (isFormula(s)) return s;
  const n = Number(s.replace(/,/g, '').replace(/^RM\s*/i, ''));
  return isFinite(n) ? Math.round(n * 100) / 100 : s;
}
const fmt = n => 'RM ' + n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtShort = n => n.toLocaleString('en-MY', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });

function monthEntries(k, pid) { return (data.months[k] && data.months[k][pid]) || {}; }
function totals(k, pid) {
  let total = 0, paid = 0, count = 0, paidCount = 0;
  for (const e of Object.values(monthEntries(k, pid))) {
    const v = valueOf(e.v);
    if (v.empty && !e.note) continue;
    total += v.n; count++;
    if (e.paid) { paid += v.n; paidCount++; }
  }
  return { total, paid, due: total - paid, count, paidCount };
}

async function copyText(t) {
  try { await navigator.clipboard.writeText(t); toast('Disalin: ' + t); }
  catch {
    const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('Disalin: ' + t); } catch { toast('Tak dapat salin'); }
    ta.remove();
  }
}

let toastTimer;
function toast(msg, action) {
  const el = $('#toast');
  el.innerHTML = esc(msg) + (action ? ` <button>${esc(action.label)}</button>` : '');
  if (action) el.querySelector('button').onclick = () => { el.classList.remove('show'); action.fn(); };
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action ? 6000 : 2500);
}

/* ================= Render ================= */
function render() {
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === ui.view));
  document.querySelectorAll('#personSeg button').forEach(b => b.classList.toggle('active', b.dataset.person === ui.person));
  renderBanner();
  const app = $('#app');
  if (!data) { app.innerHTML = welcomeHtml(); return; }
  if (!ui.month || !data.months[ui.month]) ui.month = latestMonth();
  if (ui.view === 'history') app.innerHTML = historyHtml();
  else if (ui.view === 'info') app.innerHTML = infoHtml();
  else app.innerHTML = monthHtml();
  if (ui.view === 'history') document.querySelectorAll('.grid-wrap, .hist-tools').forEach(w => { w.scrollLeft = w.scrollWidth; });
}

function renderBanner() {
  const el = $('#banner');
  if (!data || !data.updatedAt) { el.innerHTML = ''; return; }
  const last = data.lastBackupAt ? new Date(data.lastBackupAt) : null;
  const changed = !last || new Date(data.updatedAt) > last;
  const old = !last || (Date.now() - last) > 14 * 864e5;
  if (changed && old) {
    el.innerHTML = `<div class="banner"><div><span>${last ? 'Backup terakhir ' + last.toLocaleDateString('ms-MY') + '.' : 'Belum pernah buat backup.'} Data hanya disimpan dalam browser ni.</span>
      <button class="btn small primary" data-act="backup">Backup sekarang</button></div></div>`;
  } else el.innerHTML = '';
}

function welcomeHtml() {
  return `<div class="empty-state card">
    <h2>Selamat datang 👋</h2>
    <p>Data disimpan dalam browser/peranti ni sahaja. Pulihkan fail backup (contohnya <b>backup-awal.json</b> yang dijana dari Excel), atau mula kosong.</p>
    <div class="btns">
      <button class="btn primary" data-act="restore">⭱ Pulihkan dari backup</button>
      <button class="btn" data-act="startEmpty">Mula kosong</button>
    </div></div>`;
}

function monthHtml() {
  const keys = monthKeys();
  if (!keys.length) {
    return `<div class="empty-state card"><p>Belum ada bulan.</p><div class="btns">
      <button class="btn primary" data-act="newMonth">+ Mula ${esc(monthLabel(currentKey()))}</button></div></div>`;
  }
  const k = ui.month, idx = keys.indexOf(k), latest = keys.at(-1);
  const opts = keys.slice().reverse().map(m => `<option value="${m}" ${m === k ? 'selected' : ''}>${esc(monthLabel(m))}</option>`).join('');
  let html = `<div class="month-nav">
    <button class="btn icon" data-act="prevMonth" ${idx <= 0 ? 'disabled' : ''} aria-label="Bulan sebelum">‹</button>
    <div class="title"><select id="monthSel" aria-label="Pilih bulan">${opts}</select></div>
    <button class="btn icon" data-act="nextMonth" ${idx >= keys.length - 1 ? 'disabled' : ''} aria-label="Bulan seterusnya">›</button>
    <div class="spacer"></div>
    <label class="cb" style="font-weight:500;font-size:13px"><input type="checkbox" id="showEmpty" ${ui.showEmpty ? 'checked' : ''}> Tunjuk item kosong</label>
    <button class="btn primary newmonth" data-act="newMonth">+ ${esc(monthLabel(nextKey(latest)))}</button>
  </div>`;

  const ps = people();
  const tt = ps.map(p => [p, totals(k, p.id)]);
  html += '<div class="summary">';
  for (const [p, t] of tt) {
    const pct = t.total > 0 ? Math.min(100, t.paid / t.total * 100) : (t.count && t.paidCount === t.count ? 100 : 0);
    html += `<div class="card stat"><div class="label">${esc(p.name)}</div>
      <div class="value num">${fmt(t.total)}</div>
      <div class="sub num">Dah bayar ${fmt(t.paid)} · ${t.paidCount}/${t.count}</div>
      <div class="bar"><span style="width:${pct}%"></span></div></div>`;
  }
  if (ps.length > 1) {
    const sum = tt.reduce((a, [, t]) => ({ total: a.total + t.total, due: a.due + t.due }), { total: 0, due: 0 });
    html += `<div class="card stat both"><div class="label">Jumlah berdua</div><div class="value num">${fmt(sum.total)}</div>
      <div class="sub num" style="color:var(--due)">Belum bayar ${fmt(sum.due)}</div></div>`;
  }
  html += '</div>';

  html += `<div class="persons ${tt.length > 1 ? 'cols' : ''}">`;
  for (const [p, t] of tt) {
    const entries = monthEntries(k, p.id);
    const rows = itemsOf(p.id).filter(it => entries[it.id] || (ui.showEmpty && !it.hidden));
    html += `<section class="person"><div class="person-head"><h2>${esc(p.name)}</h2>
      <span class="tot num">${t.due > 0 ? 'Belum bayar ' + fmt(t.due) : (t.count ? 'Semua dah bayar ✓' : '')}</span></div><div class="list">`;
    if (!rows.length) html += `<div class="row" style="cursor:default"><span></span><span style="color:var(--muted)">Tiada item bulan ni.</span><span></span></div>`;
    for (const it of rows) html += rowHtml(k, p.id, it, entries[it.id]);
    html += `<div class="list-foot"><button class="btn small ghost" data-act="addEntry" data-p="${p.id}">+ Tambah item</button>
      ${t.count && t.paidCount < t.count ? `<button class="btn small ghost" data-act="markAll" data-p="${p.id}">Tanda semua dah bayar</button>` : ''}</div>`;
    html += '</div></section>';
  }
  return html + '</div>';
}

function rowHtml(k, pid, it, e) {
  const v = e ? valueOf(e.v) : { empty: true };
  const paid = e && e.paid;
  const meta = [];
  if (it.jompay) meta.push(`<span>JomPAY <button class="copy" data-copy="${esc(it.jompay)}">${esc(it.jompay)} ⧉</button></span>`);
  if (it.account) meta.push(`<span>Akaun <button class="copy" data-copy="${esc(it.account)}">${esc(it.account)} ⧉</button></span>`);
  let amt;
  if (!e || v.empty) amt = `<div class="amt text">—</div>`;
  else if (v.text !== null) amt = `<div class="amt text">${esc(v.text)}${paid && e.paidAt ? `<span class="paidat">✓ ${shortDate(e.paidAt)}</span>` : ''}</div>`;
  else amt = `<div class="amt num">${fmt(v.n)}${isFormula(e.v) ? `<span class="f">${esc(e.v)}</span>` : ''}${paid && e.paidAt ? `<span class="paidat">✓ ${shortDate(e.paidAt)}</span>` : ''}</div>`;
  return `<div class="row ${paid ? 'paid' : ''} ${e ? '' : 'empty'}" data-act="editEntry" data-p="${pid}" data-i="${it.id}">
    ${e ? `<button class="check" data-act="togglePaid" data-p="${pid}" data-i="${it.id}" aria-label="Tanda dah bayar" aria-pressed="${!!paid}">✓</button>` : '<span class="check" style="border-style:dashed"></span>'}
    <div><div class="name">${esc(it.name)}</div>${meta.length ? `<div class="meta">${meta.join('')}</div>` : ''}
    ${e && e.note ? `<div class="note">${esc(e.note)}</div>` : ''}</div>
    ${amt}</div>`;
}

function historyHtml() {
  const keys = monthKeys();
  if (!keys.length) return `<div class="empty-state card"><p>Belum ada data.</p></div>`;
  const years = [...new Set(keys.map(k => k.slice(0, 4)))];
  if (!ui.histYear || (ui.histYear !== 'all' && !years.includes(ui.histYear))) ui.histYear = years.at(-1);
  let html = years.length < 2 ? '' : `<div class="hist-tools">${years.map(y => `<button class="chip ${ui.histYear === y ? 'active' : ''}" data-act="histYear" data-y="${y}">${y}</button>`).join('')}
    <button class="chip ${ui.histYear === 'all' ? 'active' : ''}" data-act="histYear" data-y="all">Semua</button></div>`;
  html += `<div class="legend"><span><i style="background:var(--paid-soft);border:1px solid var(--paid)"></i>Dah bayar</span>
    <span><i style="background:var(--due-soft);border:1px solid var(--due)"></i>Belum bayar</span>
    <span><i style="background:var(--danger)"></i>Ada nota (tekan sel)</span></div>`;
  const ks = ui.histYear === 'all' ? keys : keys.filter(k => k.startsWith(ui.histYear));
  for (const p of people()) {
    const its = itemsOf(p.id).filter(it => ks.some(k => monthEntries(k, p.id)[it.id]));
    html += `<section class="person"><div class="person-head"><h2>${esc(p.name)}</h2></div>`;
    if (!its.length) { html += `<div class="card" style="color:var(--muted)">Tiada data.</div></section>`; continue; }
    html += `<div class="grid-wrap"><table class="grid num"><thead><tr><th class="item">Item</th>${ks.map(k => `<th>${monthLabel(k, true)}</th>`).join('')}</tr></thead><tbody>`;
    for (const it of its) {
      html += `<tr><td class="item" title="${esc(it.name)}">${esc(it.name)}</td>`;
      for (const k of ks) {
        const e = monthEntries(k, p.id)[it.id];
        if (!e) { html += `<td class="cell" data-act="editEntry" data-p="${p.id}" data-i="${it.id}" data-k="${k}"></td>`; continue; }
        const v = valueOf(e.v);
        const txt = v.empty ? '' : v.text !== null ? esc(v.text) : fmtShort(v.n);
        html += `<td class="cell ${e.paid ? 'p' : 'u'} ${e.note ? 'has-note' : ''}" data-act="editEntry" data-p="${p.id}" data-i="${it.id}" data-k="${k}" title="${esc((isFormula(e.v) ? e.v + '\n' : '') + (e.note || ''))}">${txt}</td>`;
      }
      html += '</tr>';
    }
    html += `</tbody><tfoot><tr><td class="item">Jumlah</td>${ks.map(k => `<td>${fmtShort(totals(k, p.id).total)}</td>`).join('')}</tr></tfoot></table></div></section>`;
  }
  return html;
}

function infoHtml() {
  const ps = people();
  let html = `<div class="persons ${ps.length > 1 ? 'cols' : ''}">`;
  for (const p of ps) {
    html += `<section class="person"><div class="person-head"><h2>${esc(p.name)}</h2></div>`;
    html += `<h3 class="sec">Maklumat & pautan</h3><div class="list">`;
    data.refs[p.id].forEach((r, i) => {
      const val = esc(r.value).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
      html += `<div class="kv"><div><div class="k">${esc(r.label) || '<span style="color:var(--muted)">(tiada label)</span>'}</div><div class="v">${val}</div></div>
        <div class="acts">${r.value && !/^https?:/.test(r.value) ? `<button class="copy" data-copy="${esc(r.value)}">⧉</button>` : ''}
        <button class="btn small ghost" data-act="editRef" data-p="${p.id}" data-r="${i}">Edit</button></div></div>`;
    });
    html += `<div class="list-foot"><button class="btn small ghost" data-act="editRef" data-p="${p.id}" data-r="-1">+ Tambah maklumat</button></div></div>`;
    html += `<h3 class="sec">Senarai item</h3><div class="list">`;
    const itemRow = it => {
      const meta = [it.jompay && 'JomPAY ' + it.jompay, it.account && 'Akaun ' + it.account].filter(Boolean).join(' · ');
      return `<div class="kv"><div><div class="k">${esc(it.name)}</div>
        <div class="v">${esc(meta)}${it.info ? (meta ? '\n' : '') + esc(it.info) : ''}</div></div>
        <div class="acts"><button class="btn small ghost" data-act="editItem" data-p="${p.id}" data-i="${it.id}">Edit</button></div></div>`;
    };
    const ended = itemsOf(p.id).filter(it => it.hidden);
    html += itemsOf(p.id).filter(it => !it.hidden).map(itemRow).join('');
    html += `<div class="list-foot"><button class="btn small ghost" data-act="editItem" data-p="${p.id}" data-i="">+ Item baru</button></div></div>`;
    if (ended.length) html += `<details class="ended"><summary>Item dah tamat (${ended.length})</summary><div class="list">${ended.map(itemRow).join('')}</div></details>`;
    html += '</section>';
  }
  html += '</div>';
  html += `<p style="color:var(--muted);font-size:12px;text-align:center">Kemaskini terakhir: ${data.updatedAt ? new Date(data.updatedAt).toLocaleString('ms-MY') : '-'} ·
    Backup terakhir: ${data.lastBackupAt ? new Date(data.lastBackupAt).toLocaleString('ms-MY') : 'belum'}</p>`;
  return html;
}

/* ================= Dialogs ================= */
const dlg = $('#dlg'), dlgForm = $('#dlgForm');
function openDialog(html, onSubmit, onReady) {
  dlgForm.innerHTML = html;
  dlgForm.onsubmit = ev => {
    const btn = ev.submitter;
    if (btn && btn.value === 'cancel') return;
    if (onSubmit(btn ? btn.value : 'ok', new FormData(dlgForm)) === false) ev.preventDefault();
  };
  dlg.showModal();
  if (onReady) onReady();
}

function editEntry(pid, iid, k) {
  k = k || ui.month;
  const it = findItem(pid, iid);
  const e = monthEntries(k, pid)[iid];
  const raw = e ? (typeof e.v === 'number' ? String(e.v) : e.v) : '';
  openDialog(`<h3>${esc(it.name)}</h3><div class="subt">${esc(personName(pid))} · ${esc(monthLabel(k))}</div>
    <label class="f">Jumlah (RM)
      <input name="v" value="${esc(raw)}" autocomplete="off" placeholder="cth 120.50 atau =750-300-200">
      <span class="hint">Boleh tulis formula bermula dengan = (cth =750-300-365-200), atau teks (cth TH).</span></label>
    <div class="calc" id="calcOut"></div>
    <label class="f">Nota<textarea name="note" placeholder="Nota untuk sel ni (ikut disalin ke bulan baru)">${esc(e ? e.note || '' : '')}</textarea></label>
    <label class="cb"><input type="checkbox" name="paid" ${e && e.paid ? 'checked' : ''}> Dah bayar</label>
    <label class="f">Tarikh bayar<input type="date" name="paidAt" value="${esc(e && e.paidAt || '')}"></label>
    <div class="dlg-actions"><div class="left">
      ${e ? '<button class="btn danger" value="remove">Buang</button>' : ''}
      <button class="btn" value="item">Edit item…</button></div>
      <button class="btn" value="cancel" formnovalidate>Batal</button>
      <button class="btn primary" value="save">Simpan</button></div>`,
    (act, fd) => {
      if (act === 'item') { setTimeout(() => editItem(pid, iid), 0); return; }
      const m = data.months[k] = data.months[k] || {};
      const pm = m[pid] = m[pid] || {};
      if (act === 'remove') {
        const old = pm[iid]; delete pm[iid]; save(); render();
        toast('Dibuang dari ' + monthLabel(k), { label: 'Undo', fn: () => { pm[iid] = old; save(); render(); } });
        return;
      }
      const v = parseInput(fd.get('v'));
      const note = String(fd.get('note') || '').trim();
      const paid = fd.get('paid') === 'on';
      const entry = { v, paid };
      if (note) entry.note = note;
      if (paid) entry.paidAt = fd.get('paidAt') || (e && e.paidAt) || todayIso();
      pm[iid] = entry;
      save(); render();
    },
    () => {
      const inp = dlgForm.elements.v, out = $('#calcOut');
      const upd = () => {
        const s = inp.value.trim();
        if (!isFormula(s)) { out.textContent = ''; return; }
        const r = valueOf(s); out.textContent = r.ok ? '= ' + fmt(r.n) : 'Formula tak sah';
      };
      inp.oninput = upd; upd();
      dlgForm.elements.paid.onchange = ev => { if (ev.target.checked && !dlgForm.elements.paidAt.value) dlgForm.elements.paidAt.value = todayIso(); };
    });
}

function editItem(pid, iid) {
  const isNew = !iid;
  const it = isNew ? { id: '', name: '', jompay: '', account: '', info: '', hidden: false } : findItem(pid, iid);
  const list = itemsOf(pid), idx = list.indexOf(it);
  openDialog(`<h3>${isNew ? 'Item baru' : 'Edit item'}</h3><div class="subt">${esc(personName(pid))}</div>
    <label class="f">Nama<input name="name" required value="${esc(it.name)}"></label>
    <label class="f">JomPAY biller code<input name="jompay" value="${esc(it.jompay)}" inputmode="numeric"></label>
    <label class="f">No. akaun / rujukan<input name="account" value="${esc(it.account)}"></label>
    <label class="f">Maklumat item<textarea name="info" placeholder="cth nama bank, no pinjaman">${esc(it.info)}</textarea></label>
    ${isNew ? `<label class="f">Jumlah untuk ${esc(monthLabel(ui.month || currentKey()))} (kosongkan jika tiada)<input name="v" autocomplete="off"></label>` : `
    <label class="cb"><input type="checkbox" name="hidden" ${it.hidden ? 'checked' : ''}> Dah tamat (sorok dari senarai item kosong)</label>`}
    <div class="dlg-actions"><div class="left">
      ${!isNew ? `<button class="btn" value="up" ${idx <= 0 ? 'disabled' : ''} title="Naik">↑</button>
      <button class="btn" value="down" ${idx >= list.length - 1 ? 'disabled' : ''} title="Turun">↓</button>
      <button class="btn danger" value="delete">Padam</button>` : ''}</div>
      <button class="btn" value="cancel" formnovalidate>Batal</button>
      <button class="btn primary" value="save">Simpan</button></div>`,
    (act, fd) => {
      if (act === 'up' || act === 'down') {
        const j = act === 'up' ? idx - 1 : idx + 1;
        [list[idx], list[j]] = [list[j], list[idx]];
        save(); render(); setTimeout(() => editItem(pid, iid), 0); return;
      }
      if (act === 'delete') {
        const used = monthKeys().filter(k => monthEntries(k, pid)[iid]).length;
        if (!confirm(`Padam "${it.name}"?${used ? ` Item ni ada dalam ${used} bulan — semua rekod tu akan dipadam juga. Kalau dah tamat, lebih baik tanda "Dah tamat".` : ''}`)) return false;
        list.splice(idx, 1);
        for (const k of monthKeys()) if (data.months[k][pid]) delete data.months[k][pid][iid];
        save(); render(); return;
      }
      const name = String(fd.get('name') || '').trim();
      if (!name) return false;
      Object.assign(it, { name, jompay: String(fd.get('jompay') || '').trim(), account: String(fd.get('account') || '').trim(), info: String(fd.get('info') || '').trim() });
      if (isNew) {
        it.id = pid + '-' + uid();
        list.push(it);
        const v = parseInput(fd.get('v') || '');
        if (v !== '' && ui.month) {
          const m = data.months[ui.month];
          (m[pid] = m[pid] || {})[it.id] = { v, paid: false };
        }
      } else it.hidden = fd.get('hidden') === 'on';
      save(); render();
    });
}

function addEntry(pid) {
  const entries = monthEntries(ui.month, pid);
  const avail = itemsOf(pid).filter(it => !entries[it.id]);
  const active = avail.filter(it => !it.hidden), ended = avail.filter(it => it.hidden);
  const opt = it => `<option value="${it.id}">${esc(it.name)}</option>`;
  openDialog(`<h3>Tambah item ke ${esc(monthLabel(ui.month))}</h3><div class="subt">${esc(personName(pid))}</div>
    <label class="f">Item<select name="iid">
      <option value="__new">➕ Item baru…</option>
      ${active.length ? `<optgroup label="Item">${active.map(opt).join('')}</optgroup>` : ''}
      ${ended.length ? `<optgroup label="Dah tamat">${ended.map(opt).join('')}</optgroup>` : ''}
    </select></label>
    <div class="dlg-actions"><button class="btn" value="cancel" formnovalidate>Batal</button><button class="btn primary" value="ok">Teruskan</button></div>`,
    (act, fd) => {
      const iid = fd.get('iid');
      setTimeout(() => {
        if (iid === '__new') editItem(pid, '');
        else {
          const it = findItem(pid, iid);
          if (it.hidden) { it.hidden = false; save(); }
          editEntry(pid, iid);
        }
      }, 0);
    });
}

function editRef(pid, i) {
  const isNew = i < 0;
  const r = isNew ? { label: '', value: '' } : data.refs[pid][i];
  openDialog(`<h3>${isNew ? 'Tambah maklumat' : 'Edit maklumat'}</h3><div class="subt">${esc(personName(pid))}</div>
    <label class="f">Label<input name="label" value="${esc(r.label)}"></label>
    <label class="f">Nilai / pautan / nota<textarea name="value">${esc(r.value)}</textarea></label>
    <div class="dlg-actions"><div class="left">${!isNew ? '<button class="btn danger" value="delete">Padam</button>' : ''}</div>
      <button class="btn" value="cancel" formnovalidate>Batal</button><button class="btn primary" value="save">Simpan</button></div>`,
    (act, fd) => {
      if (act === 'delete') { data.refs[pid].splice(i, 1); save(); render(); return; }
      const nr = { label: String(fd.get('label') || '').trim(), value: String(fd.get('value') || '').trim() };
      if (isNew) data.refs[pid].push(nr); else data.refs[pid][i] = nr;
      save(); render();
    });
}

/* ================= Actions ================= */
function newMonth() {
  const latest = latestMonth();
  if (!latest) {
    const k = currentKey();
    data.months[k] = {};
    ui.month = k; save(); render(); return;
  }
  const k = nextKey(latest);
  const nEntries = data.people.reduce((a, p) => a + Object.keys(monthEntries(latest, p.id)).length, 0);
  openDialog(`<h3>Bulan baru: ${esc(monthLabel(k))}</h3>
    <p style="margin:0">Salin <b>${nEntries} item</b> dari ${esc(monthLabel(latest))} (Adzim &amp; Wahidah) — jumlah dan nota disalin, status bayar direset. Lepas tu edit mana-mana jumlah yang berubah.</p>
    <div class="dlg-actions"><button class="btn" value="cancel" formnovalidate>Batal</button><button class="btn primary" value="ok">Buat ${esc(monthLabel(k))}</button></div>`,
    () => {
      const src = data.months[latest], m = {};
      for (const p of data.people) {
        m[p.id] = {};
        for (const [iid, e] of Object.entries(src[p.id] || {})) {
          const ne = { v: e.v, paid: false };
          if (e.note) ne.note = e.note;
          m[p.id][iid] = ne;
        }
      }
      data.months[k] = m;
      ui.month = k; ui.view = 'month';
      save(); render();
      toast(monthLabel(k) + ' dicipta');
    });
}

function deleteLatestMonth() {
  const k = latestMonth();
  if (!k) return;
  if (!confirm(`Padam ${monthLabel(k)} dan semua rekodnya? (Boleh undo sejurus selepas ni)`)) return;
  const old = data.months[k];
  delete data.months[k];
  ui.month = latestMonth(); save(); render();
  toast(monthLabel(k) + ' dipadam', { label: 'Undo', fn: () => { data.months[k] = old; ui.month = k; save(); render(); } });
}

function backupBlob() {
  data.lastBackupAt = new Date().toISOString();
  lsSet(STORE_KEY, JSON.stringify(data));
  return new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
}
const backupName = () => `komitmen-backup-${todayIso()}.json`;

function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function doBackup() {
  if (!data) return toast('Tiada data untuk backup');
  downloadBlob(backupBlob(), backupName());
  render(); toast('Backup dimuat turun');
}

async function shareBackup() {
  if (!data) return toast('Tiada data untuk backup');
  const file = new File([backupBlob()], backupName(), { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Backup Komitmen Bulanan' }); render(); }
    catch (e) { if (e.name !== 'AbortError') toast('Gagal kongsi'); }
  } else { downloadBlob(file, file.name); render(); toast('Peranti ni tak sokong kongsi — fail dimuat turun'); }
}

function restoreFile(file) {
  const fr = new FileReader();
  fr.onload = () => {
    let d;
    try { d = JSON.parse(fr.result); } catch { return toast('Fail bukan JSON yang sah'); }
    if (!d || d.app !== 'monthly-commitment' || !d.months || !d.items) return toast('Ini bukan fail backup Komitmen Bulanan');
    const n = Object.keys(d.months).length;
    if (data && !confirm(`Ganti semua data sekarang dengan backup ni (${n} bulan, kemaskini ${d.updatedAt ? new Date(d.updatedAt).toLocaleString('ms-MY') : '?'})?`)) return;
    if (data) lsSet(PREV_KEY, JSON.stringify(data));
    const prev = data;
    data = normalize(d);
    data.lastBackupAt = new Date().toISOString();
    ui.month = latestMonth();
    save(); render();
    toast(`Dipulihkan: ${n} bulan`, prev ? { label: 'Undo', fn: () => { data = prev; save(); render(); } } : null);
  };
  fr.readAsText(file);
}

function exportCsv() {
  if (!data) return;
  const keys = monthKeys();
  const q = s => { s = String(s ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = [];
  for (const p of data.people) {
    lines.push([p.name, 'JomPAY', 'Akaun', ...keys.map(k => monthLabel(k))].map(q).join(','));
    for (const it of itemsOf(p.id)) {
      lines.push([it.name, it.jompay, it.account, ...keys.map(k => { const e = monthEntries(k, p.id)[it.id]; return e ? e.v : ''; })].map(q).join(','));
    }
    lines.push(['Jumlah', '', '', ...keys.map(k => totals(k, p.id).total.toFixed(2))].map(q).join(','));
    lines.push('');
  }
  downloadBlob(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv' }), `komitmen-${todayIso()}.csv`);
}

/* ================= Events ================= */
document.addEventListener('click', ev => {
  const menu = $('#menuPop');
  if (!menu.hidden && !ev.target.closest('#menuPop') && !ev.target.closest('#btnMenu')) menu.hidden = true;

  const copy = ev.target.closest('[data-copy]');
  if (copy) { ev.stopPropagation(); copyText(copy.dataset.copy); return; }
  if (ev.target.closest('a')) return;

  const t = ev.target.closest('[data-act],[data-view],[data-person]');
  if (!t) return;
  if (t.dataset.view) { ui.view = t.dataset.view; saveUi(); render(); window.scrollTo(0, 0); return; }
  if (t.dataset.person) { ui.person = t.dataset.person; saveUi(); render(); return; }

  const { p, i } = t.dataset;
  switch (t.dataset.act) {
    case 'togglePaid': {
      const e = monthEntries(ui.month, p)[i];
      e.paid = !e.paid;
      if (e.paid) e.paidAt = todayIso(); else delete e.paidAt;
      save(); render(); break;
    }
    case 'editEntry': editEntry(p, i, t.dataset.k); break;
    case 'addEntry': addEntry(p); break;
    case 'editItem': editItem(p, i); break;
    case 'editRef': editRef(p, Number(t.dataset.r)); break;
    case 'markAll': {
      if (!confirm(`Tanda semua item ${personName(p)} bulan ${monthLabel(ui.month)} sebagai dah bayar?`)) break;
      for (const e of Object.values(monthEntries(ui.month, p))) if (!e.paid) { e.paid = true; e.paidAt = todayIso(); }
      save(); render(); break;
    }
    case 'prevMonth': case 'nextMonth': {
      const keys = monthKeys(), idx = keys.indexOf(ui.month) + (t.dataset.act === 'prevMonth' ? -1 : 1);
      if (keys[idx]) { ui.month = keys[idx]; render(); }
      break;
    }
    case 'newMonth': newMonth(); break;
    case 'histYear': ui.histYear = t.dataset.y; render(); break;
    case 'startEmpty': data = emptyData(); save(); render(); break;
    case 'backup': menu.hidden = true; doBackup(); break;
    case 'share': menu.hidden = true; shareBackup(); break;
    case 'restore': menu.hidden = true; $('#fileRestore').click(); break;
    case 'csv': menu.hidden = true; exportCsv(); break;
    case 'deleteMonth': menu.hidden = true; deleteLatestMonth(); break;
  }
});

document.addEventListener('change', ev => {
  if (ev.target.id === 'monthSel') { ui.month = ev.target.value; render(); }
  if (ev.target.id === 'showEmpty') { ui.showEmpty = ev.target.checked; saveUi(); render(); }
});

$('#btnBackup').onclick = doBackup;
$('#btnMenu').onclick = () => { const m = $('#menuPop'); m.hidden = !m.hidden; };
$('#fileRestore').onchange = ev => { const f = ev.target.files[0]; if (f) restoreFile(f); ev.target.value = ''; };
dlg.addEventListener('click', ev => { if (ev.target === dlg) dlg.close(); });

/* ================= PWA ================= */
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').then(reg => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          toast('Versi baru tersedia', { label: 'Muat semula', fn: () => nw.postMessage('skipWaiting') });
        }
      });
    });
  }).catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

render();
