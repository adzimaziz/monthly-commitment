// Sync Firebase (Firestore) untuk Komitmen Bulanan.
// Struktur Firestore:
//   households/main               -> { people, items, refs }
//   households/main/months/{YYYY-MM} -> { adzim: {itemId: entry}, wahidah: {...} }
// Perubahan dihantar per sel (field), jadi Adzim & Wahidah boleh edit serentak tanpa tindih satu sama lain.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail, connectAuthEmulator,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  initializeFirestore, connectFirestoreEmulator, doc, collection, getDoc, getDocs, onSnapshot, writeBatch, FieldPath, deleteField,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const A = window.mcApp;
const cfg = window.FIREBASE_CONFIG;
const BASE_KEY = 'mc-sync-base';

const state = { configured: !!cfg, user: null, status: cfg ? 'connecting' : 'off', pending: false, lastSync: null, error: null };
let auth, db, hh, monthsCol;
let memBase = null;      // what the cloud has, including writes we've already sent
let unsubs = [];
let linked = false;

window.mcSync = { state, push, openDialog };

/* ---------- helpers ---------- */
const clone = o => JSON.parse(JSON.stringify(o));
function stable(o) {
  if (Array.isArray(o)) return '[' + o.map(stable).join(',') + ']';
  if (o && typeof o === 'object') return '{' + Object.keys(o).sort().filter(k => o[k] !== undefined).map(k => JSON.stringify(k) + ':' + stable(o[k])).join(',') + '}';
  return JSON.stringify(o);
}
const same = (a, b) => stable(a ?? null) === stable(b ?? null);
const content = d => d && { people: d.people, items: d.items, refs: d.refs, months: d.months };
function loadBase() { try { return JSON.parse(localStorage.getItem(BASE_KEY) || 'null'); } catch { return null; } }
function saveBase(b) { try { localStorage.setItem(BASE_KEY, JSON.stringify(b)); } catch { /* ignore */ } }
function clearBase() { try { localStorage.removeItem(BASE_KEY); } catch { /* ignore */ } }

function errMsg(e) {
  const c = (e && e.code) || '';
  if (c.includes('invalid-credential') || c.includes('wrong-password') || c.includes('user-not-found') || c.includes('invalid-email')) return 'Email atau password salah';
  if (c.includes('too-many-requests')) return 'Terlalu banyak cubaan. Cuba lagi sekejap lagi';
  if (c.includes('network')) return 'Tiada internet';
  if (c.includes('permission-denied')) return 'Akaun ni tiada akses (semak Firestore rules)';
  return (e && e.message) || String(e);
}
function fail(e) {
  console.error('[sync]', e);
  state.error = errMsg(e);
  state.status = 'error';
  updateIndicator();
}

/* ---------- remote <-> local ---------- */
function assemble(metaSnap, monthDocs) {
  if (!metaSnap.exists() && !monthDocs.length) return null;
  const meta = metaSnap.exists() ? metaSnap.data() : {};
  const months = {};
  for (const d of monthDocs) months[d.id] = d.data();
  return {
    hasMeta: metaSnap.exists(),
    app: 'monthly-commitment',
    version: 1,
    people: meta.people || [{ id: 'adzim', name: 'Adzim' }, { id: 'wahidah', name: 'Wahidah' }],
    items: meta.items || {},
    refs: meta.refs || {},
    months,
  };
}
const emptyBase = () => ({ hasMeta: false, people: null, items: {}, refs: {}, months: {} });

/* Compare local data with memBase and send only the differences. */
function push() {
  if (!linked || !state.user || !memBase) return;
  const d = A.getData();
  if (!d) return;
  const b = memBase;
  const ops = [];
  const meta = { people: d.people, items: d.items, refs: d.refs };

  if (!b.hasMeta) ops.push(batch => batch.set(hh, clone(meta)));
  else {
    if (!same(d.people, b.people)) ops.push(batch => batch.update(hh, new FieldPath('people'), clone(d.people)));
    for (const key of ['items', 'refs']) {
      const pids = new Set([...Object.keys(d[key] || {}), ...Object.keys(b[key] || {})]);
      for (const pid of pids) {
        const lv = (d[key] || {})[pid], bv = (b[key] || {})[pid];
        if (!same(lv, bv)) ops.push(batch => batch.update(hh, new FieldPath(key, pid), lv === undefined ? deleteField() : clone(lv)));
      }
    }
  }

  const keys = new Set([...Object.keys(d.months), ...Object.keys(b.months)]);
  for (const k of keys) {
    const ref = doc(monthsCol, k);
    const lm = d.months[k], bm = b.months[k];
    if (!lm) { ops.push(batch => batch.delete(ref)); continue; }
    if (!bm) { ops.push(batch => batch.set(ref, clone(lm))); continue; }
    const pids = new Set([...Object.keys(lm), ...Object.keys(bm)]);
    for (const pid of pids) {
      const le = lm[pid] || {}, be = bm[pid] || {};
      for (const iid of new Set([...Object.keys(le), ...Object.keys(be)])) {
        if (same(le[iid], be[iid])) continue;
        ops.push(batch => batch.update(ref, new FieldPath(pid, iid), le[iid] === undefined ? deleteField() : clone(le[iid])));
      }
    }
  }
  if (!ops.length) return;

  // Optimistic: treat what we've sent as the cloud state, so we don't resend it.
  memBase = Object.assign(clone(content(d)), { hasMeta: true });
  state.pending = true;
  updateIndicator();
  for (let i = 0; i < ops.length; i += 400) {
    const batch = writeBatch(db);
    ops.slice(i, i + 400).forEach(op => op(batch));
    // Don't await: offline writes stay queued and are sent when back online.
    batch.commit().catch(e => { memBase = loadBase() || emptyBase(); fail(e); });
  }
}

/* First connection on this device: decide between cloud data and local data. */
async function link() {
  const user = state.user;
  let base = loadBase();
  if (base && base.email !== user.email) { base = null; clearBase(); }
  if (base) {
    memBase = base;
    linked = true;
    push();             // send edits made while offline / before sign-in
    return;
  }
  const [metaSnap, monthsSnap] = await Promise.all([getDoc(hh), getDocs(monthsCol)]);
  const remote = assemble(metaSnap, monthsSnap.docs);
  const local = A.getData();
  const localMonths = local ? Object.keys(local.months).length : 0;
  linked = true;
  if (!remote) {
    memBase = emptyBase();
    if (local) { push(); A.toast(`Data peranti ni (${localMonths} bulan) dimuat naik ke cloud`); }
    return;
  }
  let useCloud = true;
  if (localMonths && !same(content(local), content(remote))) {
    const n = Object.keys(remote.months).length;
    useCloud = confirm(`Cloud dah ada data (${n} bulan).\n\nOK = guna data cloud (data dalam peranti ni diganti).\nCancel = pilihan lain`);
    if (!useCloud && !confirm(`Ganti data CLOUD dengan data peranti ni (${localMonths} bulan)? Peranti lain pun akan dapat data ni.\n\nCancel = guna data cloud`)) useCloud = true;
  }
  memBase = remote;
  if (useCloud) A.setData(remote);
  else push();
}

function listen() {
  let meta = null, months = null;
  const apply = () => {
    if (!meta || !months) return;
    const remote = assemble(meta, months.docs);
    const pending = meta.metadata.hasPendingWrites || months.metadata.hasPendingWrites;
    const fromCache = meta.metadata.fromCache || months.metadata.fromCache;
    state.pending = pending;
    // Offline cache may be incomplete: never overwrite local data with it.
    if (remote && !fromCache) {
      memBase = remote;
      const local = A.getData();
      if (!local || !same(content(local), content(remote))) A.setData(remote);
      if (!pending && !fromCache) {
        saveBase(Object.assign(clone(remote), { email: state.user.email }));
        state.lastSync = new Date();
      }
    }
    state.status = fromCache ? 'offline' : 'ok';
    state.error = null;
    updateIndicator();
  };
  unsubs.push(onSnapshot(hh, { includeMetadataChanges: true }, s => { meta = s; apply(); }, fail));
  unsubs.push(onSnapshot(monthsCol, { includeMetadataChanges: true }, s => { months = s; apply(); }, fail));
}

function stop() {
  unsubs.forEach(u => u());
  unsubs = [];
  linked = false;
  memBase = null;
}

/* ---------- UI ---------- */
function updateIndicator() {
  const btn = document.getElementById('btnSync');
  if (btn) {
    btn.hidden = !state.configured;
    const map = {
      off: ['☁', 'Sync belum disetup'],
      signedout: ['☁ Log masuk', 'Belum log masuk sync'],
      connecting: ['☁ …', 'Menyambung…'],
      ok: [state.pending ? '☁ …' : '☁ ✓', state.pending ? 'Menghantar perubahan…' : 'Disync'],
      offline: ['☁ ⨯', 'Offline — perubahan akan dihantar bila ada internet'],
      error: ['☁ !', 'Ralat sync: ' + (state.error || '')],
    };
    const [label, title] = map[state.status] || map.off;
    btn.textContent = label;
    btn.title = title;
    btn.dataset.state = state.status;
  }
}

function openDialog() {
  const E = A.esc;
  if (!state.configured) {
    A.openDialog(`<h3>Sync cloud</h3><p style="margin:0">Sync belum disetup. Isi <b>firebase-config.js</b> dengan config projek Firebase (lihat README).</p>
      <div class="dlg-actions"><button class="btn primary" value="cancel">OK</button></div>`, () => {});
    return;
  }
  if (!state.user) {
    A.openDialog(`<h3>Log masuk sync</h3>
      <div class="subt">Data akan sama di semua phone & komputer yang log masuk.</div>
      ${state.error ? `<div class="note">${E(state.error)}</div>` : ''}
      <label class="f">Email<input name="email" type="email" autocomplete="username" required></label>
      <label class="f">Password<input name="password" type="password" autocomplete="current-password" required></label>
      <div class="dlg-actions"><div class="left"><button class="btn ghost" value="reset" formnovalidate>Lupa password</button></div>
        <button class="btn" value="cancel" formnovalidate>Batal</button><button class="btn primary" value="login">Log masuk</button></div>`,
      (act, fd) => {
        const email = String(fd.get('email') || '').trim();
        if (act === 'reset') {
          if (!email) { A.toast('Isi email dulu'); return false; }
          sendPasswordResetEmail(auth, email).then(() => A.toast('Email reset password dihantar')).catch(e => A.toast(errMsg(e)));
          return;
        }
        state.status = 'connecting'; state.error = null; updateIndicator();
        signInWithEmailAndPassword(auth, email, String(fd.get('password') || ''))
          .then(() => A.toast('Log masuk berjaya'))
          .catch(e => { fail(e); A.toast(errMsg(e)); state.status = 'signedout'; updateIndicator(); });
      });
    return;
  }
  const st = { ok: state.pending ? 'Menghantar perubahan…' : 'Disync ✓', offline: 'Offline — perubahan disimpan & akan dihantar bila ada internet', connecting: 'Menyambung…', error: 'Ralat: ' + (state.error || '') }[state.status] || state.status;
  A.openDialog(`<h3>Sync cloud</h3>
    <div class="subt">Log masuk sebagai <b>${E(state.user.email)}</b></div>
    <p style="margin:0">Status: ${E(st)}${state.lastSync ? `<br><span style="color:var(--muted);font-size:13px">Terakhir disync: ${E(state.lastSync.toLocaleString('ms-MY'))}</span>` : ''}</p>
    <div class="dlg-actions"><div class="left"><button class="btn danger" value="logout">Log keluar</button></div>
      <button class="btn primary" value="cancel">Tutup</button></div>`,
    act => {
      if (act === 'logout') {
        if (!confirm('Log keluar sync? Data dalam peranti ni kekal, tapi tak akan disync lagi.')) return false;
        signOut(auth);
      }
    });
}

/* ---------- start ---------- */
if (!cfg) {
  updateIndicator();
} else {
  try {
    const app = initializeApp(cfg);
    auth = getAuth(app);
    db = initializeFirestore(app, { ignoreUndefinedProperties: true });
    if (cfg.emulator) { // local testing only
      connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      connectFirestoreEmulator(db, '127.0.0.1', 8080);
    }
    hh = doc(db, 'households', 'main');
    monthsCol = collection(hh, 'months');
    const connect = async () => {
      stop();
      state.status = 'connecting'; updateIndicator();
      try { await link(); listen(); } catch (e) { stop(); fail(e); }
    };
    onAuthStateChanged(auth, user => {
      state.user = user;
      A.render();
      if (!user) { stop(); clearBase(); state.status = 'signedout'; updateIndicator(); return; }
      connect();
    });
    // First link needs internet; retry when it comes back.
    window.addEventListener('online', () => { if (state.user && !linked) connect(); });
  } catch (e) { fail(e); }
}
