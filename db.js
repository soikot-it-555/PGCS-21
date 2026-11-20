// =====================================================================
// PGCS-21 — Supabase Online Database Layer  (v2: two-way sync)
//
//   app.js / finance.js --localStorage.setItem--> [interceptor] --> outbox --> Supabase
//   Supabase Realtime / resync --> DB.subscribe(name, fn) --> memory + cache + UI
//
// Rules enforced here
//  * Supabase is the source of truth. localStorage is a cache (+ a small "outbox" of
//    changes not yet saved, so nothing is silently lost on refresh / offline).
//  * Writes are RECORD-LEVEL. A stale browser can never delete or overwrite a record
//    it did not itself change.
//  * Every row has a server-maintained `version`. Update/delete = compare-and-set on it.
//    If someone else changed the record first, the server copy wins, the local copy is
//    reloaded and a conflict message is shown.
//  * Remote changes update memory + cache WITHOUT writing back to the database.
// =====================================================================
(function () {
  "use strict";

  // ▼▼▼ Supabase → Project Settings → API Keys (publishable/anon key only) ▼▼▼
  const SUPABASE_URL = "https://lknftxkkplztbcovprma.supabase.co";
  const SUPABASE_KEY = "sb_publishable_6MByUD2x5QZxOjrI34fqRw_npSJXcl7";
  // ▲▲▲ service_role / secret key must NEVER be placed here ▲▲▲

  const MEMBERS_KEY = "pgcs_members_v1";
  const SETTINGS_KEY = "pgcs_settings_v1";
  const PW_KEY = "pgcs_passwords_v1";
  const PAY_KEY = "pgcs_payments_v3";
  const FIN_CFG_KEY = "pgcs_fin_cfg_v1";
  const FIN_TX_KEY = "pgcs_fin_tx_v1";
  const INCOME_YEARS_KEY = "pgcs_income_years_v1";
  const PAYMENT_AUDIT_KEY = "pgcs_payment_audit_v1";
  const OUTBOX_KEY = "pgcs_outbox_v1";

  const configured = !/YOUR-/.test(SUPABASE_URL + SUPABASE_KEY);
  const authHeaders = () => SUPABASE_KEY.startsWith("sb_")
    ? { apikey: SUPABASE_KEY }
    : { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY };

  const ls = window.localStorage;
  const origSet = Storage.prototype.setItem;
  const rawSet = (k, v) => origSet.call(ls, k, v);
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // Canonical JSON (sorted keys). Postgres jsonb re-orders keys, so plain JSON.stringify
  // would report false differences between the local copy and the server copy.
  const canon = v => {
    if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
    if (v && typeof v === "object")
      return "{" + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
    return JSON.stringify(v === undefined ? null : v);
  };

  // ---------------------------------------------------------------- UI helpers
  function bar(id, bg, msg, btn) {
    let b = document.getElementById(id);
    if (!msg) { if (b) b.style.display = "none"; return; }
    if (!b) {
      b = document.createElement("div"); b.id = id;
      b.style.cssText = "position:fixed;left:0;right:0;z-index:100;color:#fff;padding:8px 14px;text-align:center;font-size:13px";
      b.style.top = id === "db-banner" ? "0" : "38px";
      document.body.appendChild(b);
    }
    b.style.background = bg; b.style.display = "block"; b.textContent = msg + " ";
    if (btn) {
      const x = document.createElement("button");
      x.textContent = btn.label; x.style.cssText = "text-decoration:underline;margin-left:8px";
      x.onclick = btn.fn; b.appendChild(x);
    }
  }
  const errBanner = msg => bar("db-banner", "#be123c", msg, msg ? { label: "Retry now", fn: () => kick(true) } : null);
  const warnBanner = msg => bar("db-conflict", "#b45309", msg, msg ? { label: "OK", fn: () => bar("db-conflict", "", "") } : null);
  let pill;
  function setPill(text, color) {
    if (!document.body) return;
    if (!pill) {
      pill = document.createElement("div"); pill.id = "db-pill";
      pill.style.cssText = "position:fixed;left:8px;bottom:8px;z-index:90;font-size:11px;padding:3px 8px;border-radius:999px;color:#fff;opacity:.85;pointer-events:none";
      document.body.appendChild(pill);
    }
    pill.textContent = text; pill.style.background = color;
  }

  // -------------------------------------------------------------- REST helper
  async function api(path, { method = "GET", body, headers = {}, retries = 3 } = {}) {
    for (let a = 0; ; a++) {
      let res;
      const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 25000);
      try {
        res = await fetch(SUPABASE_URL + "/rest/v1/" + path, {
          method, cache: "no-store", signal: ctl.signal,
          headers: { ...authHeaders(), "Content-Type": "application/json", ...headers },
          body: body === undefined ? undefined : JSON.stringify(body)
        });
      } catch (e) {
        clearTimeout(timer);
        if (a < retries) { await sleep(500 * 2 ** a); continue; }
        const err = new Error("Network error: check your internet connection");
        err.network = true; throw err;
      }
      clearTimeout(timer);
      if (!res.ok) {
        const t = await res.text();
        if (res.status >= 500 && a < retries) { await sleep(500 * 2 ** a); continue; }
        const err = new Error("Supabase " + res.status + ": " + t.slice(0, 200));
        err.status = res.status; err.body = t; throw err;
      }
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    }
  }

  // ------------------------------------------------------ data model definitions
  // "rows": one table row per record (payments, fin_transactions)
  // "doc" : one app_state row per key, split into ENTRIES (a member, one setting, one
  //         password, one finance account) so edits to different entries merge.
  const DEFS = {
    payments: { kind: "rows", table: "payments", lsKey: PAY_KEY, idVal: Number, label: "Payment", sort: (a, b) => Number(a.id) - Number(b.id) },
    finTx: { kind: "rows", table: "fin_transactions", lsKey: FIN_TX_KEY, idVal: String, label: "Financial transaction" },
    members: { kind: "doc", key: MEMBERS_KEY, lsKey: MEMBERS_KEY, form: "list", idOf: o => o.mid, label: "Member" },
    settings: { kind: "doc", key: SETTINGS_KEY, lsKey: SETTINGS_KEY, form: "obj", deep: ["amt"], label: "Setting" },
    passwords: { kind: "doc", key: PW_KEY, lsKey: PW_KEY, form: "obj", label: "Password" },
    finCfg: { kind: "doc", key: FIN_CFG_KEY, lsKey: FIN_CFG_KEY, form: "cfg", label: "Financial configuration" },
    incomeYears: { kind: "doc", key: INCOME_YEARS_KEY, lsKey: INCOME_YEARS_KEY, form: "list", idOf: o => String(o.id), label: "Income year" },
    paymentAudit: { kind: "doc", key: PAYMENT_AUDIT_KEY, lsKey: PAYMENT_AUDIT_KEY, form: "list", idOf: o => String(o.id), label: "Payment audit" }
  };
  const DOC_BY_KEY = {};
  for (const [n, d] of Object.entries(DEFS)) if (d.kind === "doc") DOC_BY_KEY[d.key] = n;

  function toE(d, v) { // value -> Map(entryId -> canonical json)
    const m = new Map();
    if (d.kind === "rows") { for (const o of v || []) m.set(String(o.id), canon(o)); return m; }
    if (d.form === "list") { for (const o of v || []) m.set(String(d.idOf(o)), canon(o)); return m; }
    for (const [k, val] of Object.entries(v || {})) {
      if (d.form === "cfg" && k === "accounts") { for (const a of val || []) m.set("a|" + a.kind + "|" + a.key, canon(a)); }
      else if ((d.deep || []).includes(k) && val && typeof val === "object" && !Array.isArray(val)) { for (const [k2, v2] of Object.entries(val)) m.set("d|" + k + "|" + k2, canon(v2)); }
      else m.set("k|" + k, canon(val));
    }
    return m;
  }
  function fromE(d, m) { // Map -> value
    const vals = [...m.entries()];
    if (d.kind === "rows" || d.form === "list") {
      const arr = vals.map(([, j]) => JSON.parse(j));
      return d.sort ? arr.sort(d.sort) : arr;
    }
    const o = d.form === "cfg" ? { accounts: [] } : {};
    for (const k of d.deep || []) o[k] = {};
    for (const [id, j] of vals) {
      const v = JSON.parse(j);
      if (id.startsWith("a|")) o.accounts.push(v);
      else if (id.startsWith("d|")) { const rest = id.slice(2), p = rest.indexOf("|"); o[rest.slice(0, p)][rest.slice(p + 1)] = v; }
      else o[id.slice(2)] = v;
    }
    return o;
  }

  // --------------------------------------------------------------- collections
  const colls = {}, subs = {};
  const queue = new Map();                  // "name|id" -> op   (the outbox)
  let ready = false, paused = false, pumping = false, retryTimer = null, failCount = 0, lastErr = null, waiters = [];
  const qkey = (n, id) => n + "|" + id;

  class Coll {
    constructor(name) { this.name = name; this.def = DEFS[name]; this.view = new Map(); this.known = new Map(); this.ver = null; this.t = null; }
    isRows() { return this.def.kind === "rows"; }
    value() { return fromE(this.def, this.view); }
    cache() { rawSet(this.def.lsKey, JSON.stringify(this.value())); }
    pending(id) { return queue.has(qkey(this.name, id)); }
    baseOf(id) { return this.known.has(id) ? (this.isRows() ? this.known.get(id).v : this.known.get(id)) : null; }
    // remote data changed -> persist cache and tell the UI (batched, never writes to the DB)
    changed() {
      this.cache(); clearTimeout(this.t);
      this.t = setTimeout(() => { try { subs[this.name] && subs[this.name](this.value()); } catch (e) { console.error("subscriber error", e); } }, 30);
    }
    // ---- local save intercepted from localStorage.setItem
    onLocal(str) {
      let v; try { v = JSON.parse(str); } catch { return; }
      const listLike = this.isRows() || this.def.form === "list";
      if (listLike ? !Array.isArray(v) : (!v || typeof v !== "object" || Array.isArray(v))) return;
      const next = toE(this.def, v);
      for (const [id, j] of next) if (this.view.get(id) !== j) this.qSet(id, j);
      for (const id of [...this.view.keys()]) if (!next.has(id)) this.qDel(id);
      this.view = next;
    }
    qSet(id, j) {
      const k = qkey(this.name, id), ex = queue.get(k);
      if (ex && ex.inflight) { ex.after = { t: "set", j }; return; }
      if (ex) { ex.t = "set"; ex.j = j; return; }
      queue.set(k, { name: this.name, id, t: "set", j, base: this.baseOf(id) });
    }
    qDel(id) {
      const k = qkey(this.name, id), ex = queue.get(k);
      if (ex && ex.inflight) { ex.after = { t: "del" }; return; }
      if (ex) { if (ex.t === "set" && ex.base === null) queue.delete(k); else { ex.t = "del"; delete ex.j; } return; }
      if (this.baseOf(id) === null) return;            // never existed on the server
      queue.set(k, { name: this.name, id, t: "del", base: this.baseOf(id) });
    }
    // ---- adopt authoritative server data; entries with unsent local changes are left alone
    syncRows(rows) {
      let ch = false; const seen = new Set();
      for (const r of rows) {
        const id = String(r.id); seen.add(id);
        if (this.pending(id)) continue;
        const k = this.known.get(id);
        if (k && k.v >= r.version) { if (this.view.get(id) !== k.j) { this.view.set(id, k.j); ch = true; } continue; }
        const j = canon(r.data); this.known.set(id, { j, v: r.version });
        if (this.view.get(id) !== j) { this.view.set(id, j); ch = true; }
      }
      for (const id of [...this.known.keys()]) if (!seen.has(id) && !this.pending(id)) { this.known.delete(id); if (this.view.delete(id)) ch = true; }
      return ch;
    }
    syncDoc(value, version) {
      const srv = toE(this.def, value); let ch = false;
      this.known = new Map(srv); this.ver = version;
      for (const [id, j] of srv) { if (this.pending(id)) continue; if (this.view.get(id) !== j) { this.view.set(id, j); ch = true; } }
      for (const id of [...this.view.keys()]) if (!srv.has(id) && !this.pending(id)) { this.view.delete(id); ch = true; }
      return ch;
    }
    docMissing() {
      let ch = false; this.known = new Map(); this.ver = null;
      for (const id of [...this.view.keys()]) if (!this.pending(id)) { this.view.delete(id); ch = true; }
      return ch;
    }
  }
  for (const n of Object.keys(DEFS)) colls[n] = new Coll(n);

  // ---------------------------------------------------------- loading from server
  async function fetchRows(d) {
    const out = [];
    for (let off = 0; ; off += 1000) {
      const rows = await api(d.table + "?select=id,data,version&order=created_at.asc,id.asc&limit=1000&offset=" + off);
      out.push(...rows); if (rows.length < 1000) break;
    }
    return out;
  }
  const fetchDocs = () => api("app_state?select=key,value,version");
  async function fetchOne(c, id) {
    const rows = await api(c.def.table + "?select=id,data,version&id=eq." + encodeURIComponent(id));
    return rows && rows[0];
  }

  // Full refresh (reconnect, tab focus, polling fallback). Waits for in-flight writes first and
  // blocks new ones while it applies the snapshot, so a snapshot can never undo a fresh local save.
  let resyncing = null;
  function resync() {
    if (!ready) return Promise.resolve();
    if (resyncing) return resyncing;
    resyncing = (async () => {
      while (pumping) await sleep(50);
      paused = true;
      try {
        const [docs, pay, fin] = await Promise.all([fetchDocs(), fetchRows(DEFS.payments), fetchRows(DEFS.finTx)]);
        const dm = new Map(docs.map(r => [r.key, r])), list = [];
        if (colls.payments.syncRows(pay)) list.push(colls.payments);
        if (colls.finTx.syncRows(fin)) list.push(colls.finTx);
        for (const [key, name] of Object.entries(DOC_BY_KEY)) {
          const r = dm.get(key), c = colls[name];
          if (r) { if (r.version !== c.ver && c.syncDoc(r.value, r.version)) list.push(c); }
          else if (c.ver !== null && c.docMissing()) list.push(c);
        }
        list.forEach(c => c.changed());
        markOk();
      } catch (e) { console.warn("resync failed", e.message); markFail(e); }
      finally { paused = false; resyncing = null; kick(); }
    })();
    return resyncing;
  }

  // ------------------------------------------------------------- write executors
  async function execRow(c, op) {
    const d = c.def, id = op.id, q = encodeURIComponent(id);
    const conflict = async () => {
      const cur = await fetchOne(c, id);
      if (op.t === "set" && cur && canon(cur.data) === op.j) { c.known.set(id, { j: op.j, v: cur.version }); return null; } // an earlier attempt had already succeeded
      if (op.t === "del" && !cur) { c.known.delete(id); return null; }
      if (cur) { const j = canon(cur.data); c.known.set(id, { j, v: cur.version }); c.view.set(id, j); }
      else { c.known.delete(id); c.view.delete(id); }
      return { name: c.name, id, op: op.t, serverHas: !!cur };
    };
    if (op.t === "set") {
      let rows;
      if (op.base === null)
        rows = await api(d.table + "?on_conflict=id", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=representation" }, body: [{ id: d.idVal(id), data: JSON.parse(op.j) }] });
      else
        rows = await api(d.table + "?id=eq." + q + "&version=eq." + op.base, { method: "PATCH", headers: { Prefer: "return=representation" }, body: { data: JSON.parse(op.j) } });
      if (rows && rows[0]) { c.known.set(id, { j: op.j, v: rows[0].version }); return null; }
      return conflict();
    }
    if (op.base === null) return null;
    const rows = await api(d.table + "?id=eq." + q + "&version=eq." + op.base, { method: "DELETE", headers: { Prefer: "return=representation" } });
    if (rows && rows.length) { c.known.delete(id); return null; }
    return conflict();
  }

  async function execDoc(c, batch) {
    const d = c.def, kq = encodeURIComponent(d.key), conflicts = [];
    for (let attempt = 0; attempt < 8; attempt++) {
      const rows = await api("app_state?select=value,version&key=eq." + kq);
      const row = rows && rows[0], srv = row ? toE(d, row.value) : new Map(), out = new Map(srv), cf = [];
      for (const o of batch) {
        const s = srv.get(o.id), b = o.base === null ? undefined : o.base;
        if (o.t === "set") { if (s === o.j) continue; if (s !== b) { cf.push(o); continue; } out.set(o.id, o.j); }
        else { if (s === undefined) continue; if (s !== b) { cf.push(o); continue; } out.delete(o.id); }
      }
      const changed = out.size !== srv.size || [...out].some(([k, v]) => srv.get(k) !== v);
      let ver = row ? row.version : null;
      if (changed) {
        const value = fromE(d, out); let r;
        if (row) r = await api("app_state?key=eq." + kq + "&version=eq." + row.version, { method: "PATCH", headers: { Prefer: "return=representation" }, body: { value } });
        else r = await api("app_state?on_conflict=key", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=representation" }, body: [{ key: d.key, value }] });
        if (!r || !r[0]) continue;                 // somebody saved in between -> re-read and redo the merge
        ver = r[0].version;
      }
      c.known = new Map(out); c.ver = ver;
      for (const o of cf) {                        // server wins for entries that others changed first
        const s = out.get(o.id);
        if (s === undefined) c.view.delete(o.id); else c.view.set(o.id, s);
        conflicts.push({ name: c.name, id: o.id, op: o.t, serverHas: s !== undefined });
      }
      const touched = new Set(batch.map(o => o.id));   // adopt others' changes to entries we did not touch
      for (const [id, j] of out) if (!touched.has(id) && !c.pending(id) && c.view.get(id) !== j) c.view.set(id, j);
      for (const id of [...c.view.keys()]) if (!out.has(id) && !touched.has(id) && !c.pending(id)) c.view.delete(id);
      return conflicts;
    }
    throw new Error("Too many people are saving at once — try again (too many concurrent saves)");
  }

  // ------------------------------------------------------------------- pump
  function persistQueue() {
    const ops = [...queue.values()].map(o => ({ name: o.name, id: o.id, t: o.t, j: o.j, base: o.base }));
    try { if (ops.length) rawSet(OUTBOX_KEY, JSON.stringify(ops)); else ls.removeItem(OUTBOX_KEY); } catch { }
  }
  function describe(cf) {
    const lab = c => DEFS[c.name].label + " " + (String(c.id).length > 24 ? String(c.id).slice(0, 8) + "…" : c.id);
    return cf.map(c => lab(c) + (c.serverHas ? " — someone else changed it first" : " — someone else already deleted it")).join("; ");
  }
  function kick(now) {
    if (now) { clearTimeout(retryTimer); retryTimer = null; }
    if (!ready || pumping || paused || retryTimer) return;
    pump();
  }
  function markOk() { failCount = 0; lastErr = null; refreshPill(); }
  function markFail(e) { failCount++; lastErr = e; refreshPill(); }
  async function pump() {
    pumping = true; const all = [], rejected = [];
    try {
      while (queue.size && !paused) {
        const head = [...queue.values()].find(o => !o.inflight); if (!head) break;
        const c = colls[head.name];
        const batch = c.isRows() ? [head] : [...queue.values()].filter(o => o.name === head.name && !o.inflight);
        batch.forEach(o => { o.inflight = true; });
        try {
          const res = c.isRows() ? [await execRow(c, head)].filter(Boolean) : await execDoc(c, batch);
          for (const o of batch) {
            queue.delete(qkey(o.name, o.id)); o.inflight = false;
            if (o.after) { o.after.t === "set" ? c.qSet(o.id, o.after.j) : c.qDel(o.id); }
          }
          if (res.length) { all.push(...res); c.changed(); }
          markOk(); errBanner("");
        } catch (e) {
          if (!e.network && [400, 409, 422].includes(e.status)) {      // permanent rejection by a database rule: drop it (never retry forever) and restore the server copy
            let msg = e.body || e.message; try { msg = JSON.parse(e.body).message || msg; } catch { }
            batch.forEach(o => {
              queue.delete(qkey(o.name, o.id)); o.inflight = false;
              const k = c.known.get(o.id); if (k) c.view.set(o.id, c.isRows() ? k.j : k); else c.view.delete(o.id);
            });
            rejected.push(DEFS[c.name].label + " — " + String(msg).slice(0, 160)); c.changed(); markOk();
            continue;
          }
          batch.forEach(o => { o.inflight = false; if (o.after) { if (o.after.t === "set") { o.t = "set"; o.j = o.after.j; } else o.t = "del"; delete o.after; } });
          console.error("Database save failed:", e);
          markFail(e);
          errBanner("⚠️ Not saved — the change has not reached the Database yet (" + (e.network ? "offline" : e.message) + "). The change is kept on this device and will be retried automatically.");
          retryTimer = setTimeout(() => { retryTimer = null; kick(); }, Math.min(30000, 2000 * 2 ** Math.min(failCount, 4)));
          break;
        }
      }
    } finally {
      pumping = false; persistQueue(); refreshPill();
      const done = !queue.size;
      if (done || retryTimer) { const w = waiters; waiters = []; w.forEach(r => r(done)); }
      if (all.length) {
        warnBanner("⚠️ Conflict: your change was not applied, the latest version from the Database has been loaded → " + describe(all));
        window.dispatchEvent(new CustomEvent("db-conflict", { detail: all }));
      }
      if (rejected.length) warnBanner("⚠️ The Database rejected the change (not saved): " + rejected.join("; "));
      if (queue.size && !retryTimer && !paused) setTimeout(kick, 0);
    }
  }
  const flush = () => new Promise(res => {
    if (!queue.size && !pumping) return res(true);
    waiters.push(res); kick(true);
  });

  // -------------------------------------------------- localStorage interception
  const TRACK = { [PAY_KEY]: "payments", [FIN_TX_KEY]: "finTx", [MEMBERS_KEY]: "members", [SETTINGS_KEY]: "settings", [PW_KEY]: "passwords", [FIN_CFG_KEY]: "finCfg", [INCOME_YEARS_KEY]: "incomeYears", [PAYMENT_AUDIT_KEY]: "paymentAudit" };   // income years + payment audit must be uploaded too (they were only downloaded)
  Storage.prototype.setItem = function (k, v) {
    origSet.call(this, k, v);
    if (this === ls && ready && TRACK[k]) { colls[TRACK[k]].onLocal(String(v)); persistQueue(); refreshPill(); kick(); }
  };

  // --------------------------------------------------------------------- Realtime
  let client = null, channel = null, rtStatus = "CONNECTING", rtTimer = null, rtBackoff = 2000, started = false;
  function refreshPill() {
    if (!ready) return;
    if (!navigator.onLine) return setPill("● Offline" + (queue.size ? " — " + queue.size + " unsaved" : ""), "#be123c");
    if (queue.size) return setPill("● Saving… (" + queue.size + ")", failCount ? "#be123c" : "#b45309");
    if (rtStatus === "SUBSCRIBED") return setPill("● Live sync", "#047857");
    setPill("● Reconnecting… (auto-check every 5s)", "#b45309");
  }
  function handleEvent(table, p) {
    try {
      const ev = p.eventType, rec = p.new || {}, old = p.old || {};
      if (table === "app_state") {
        const name = DOC_BY_KEY[rec.key || old.key]; if (!name) return;
        const c = colls[name];
        if (ev === "DELETE") { if (c.docMissing()) c.changed(); return; }
        if (c.ver !== null && rec.version <= c.ver) return;               // duplicate / older event
        if (rec.value === undefined) { resync(); return; }                // payload truncated -> re-read authoritative copy
        if (c.syncDoc(rec.value, rec.version)) c.changed();
        return;
      }
      const c = table === "payments" ? colls.payments : colls.finTx;
      if (ev === "DELETE") {
        const id = String(old.id); if (c.pending(id) || !c.known.has(id)) return;
        c.known.delete(id); if (c.view.delete(id)) c.changed(); return;
      }
      const id = String(rec.id); if (c.pending(id)) return;
      const k = c.known.get(id); if (k && k.v >= rec.version) return;     // duplicate / older event
      if (rec.data === undefined) { resync(); return; }
      const j = canon(rec.data); c.known.set(id, { j, v: rec.version });
      if (c.view.get(id) !== j) { c.view.set(id, j); c.changed(); }
    } catch (e) { console.error("realtime event error", e); }
  }
  async function startChannel() {
    clearTimeout(rtTimer);
    if (!window.supabase || !window.supabase.createClient) { rtStatus = "UNAVAILABLE"; refreshPill(); return; }   // polling fallback covers this
    try {
      if (!client) client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { params: { eventsPerSecond: 10 } } });
      if (channel) { const oldCh = channel; channel = null; try { await client.removeChannel(oldCh); } catch { } }   // never two channels
      const ch = client.channel("pgcs-sync");
      for (const t of ["app_state", "payments", "fin_transactions"])
        ch.on("postgres_changes", { event: "*", schema: "public", table: t }, p => handleEvent(t, p));
      channel = ch;
      ch.subscribe(status => {
        if (ch !== channel) return;
        rtStatus = status; refreshPill();
        if (status === "SUBSCRIBED") { rtBackoff = 2000; clearTimeout(rtTimer); resync(); }   // catch up on anything missed while disconnected
        else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) scheduleReconnect();
      });
      rtTimer = setTimeout(() => { if (rtStatus !== "SUBSCRIBED") scheduleReconnect(); }, 15000);   // watchdog
    } catch (e) { console.error("realtime start failed", e); scheduleReconnect(); }
  }
  function scheduleReconnect() {
    clearTimeout(rtTimer);
    rtTimer = setTimeout(startChannel, rtBackoff); rtBackoff = Math.min(rtBackoff * 2, 30000);
  }
  function startRealtime() {
    if (started) return; started = true;
    startChannel();
    setInterval(() => { if (rtStatus !== "SUBSCRIBED") resync(); }, 5000);     // fallback while Realtime is down
    setInterval(resync, 5 * 60 * 1000);                                        // safety net while Realtime is up
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") resync(); });
    window.addEventListener("online", () => { refreshPill(); kick(true); resync(); if (rtStatus !== "SUBSCRIBED") startChannel(); });
    window.addEventListener("offline", refreshPill);
    window.addEventListener("beforeunload", e => { if (queue.size) { e.preventDefault(); e.returnValue = ""; } });
    refreshPill();
  }

  // ---------------------------------------------------- documents (Supabase Storage)
  const BUCKET = "fin-docs";
  const encPath = p => p.split("/").map(encodeURIComponent).join("/");
  async function storage(path, opts = {}) {
    let res;
    try { res = await fetch(SUPABASE_URL + "/storage/v1/" + path, { ...opts, headers: { ...authHeaders(), ...(opts.headers || {}) } }); }
    catch (e) { throw new Error("Network error: check your internet connection"); }
    if (!res.ok) throw new Error("Storage " + res.status + ": " + (await res.text()).slice(0, 160));
    return res.json().catch(() => ({}));
  }
  const upload = (path, file) => storage("object/" + BUCKET + "/" + encPath(path), { method: "POST", body: file, headers: { "Content-Type": file.type || "application/octet-stream", "x-upsert": "false" } });
  async function signedUrl(path, name, download) {
    const r = await storage("object/sign/" + BUCKET + "/" + encPath(path), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn: 300 }) });
    return SUPABASE_URL + "/storage/v1" + r.signedURL + (download ? "&download=" + encodeURIComponent(name || "") : "");
  }
  const removeFiles = paths => paths.length ? storage("object/" + BUCKET, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: paths }) }) : Promise.resolve();

  // ---------------------------------------------------------------------- startup
  async function init() {
    if (!configured) throw new Error("Supabase URL and Key are not set in the db.js file");
    if (!navigator.onLine) throw new Error("No internet — the latest data could not be fetched from the Database, so the app was not started (financial entry with old cache is not safe)");
    // 1. connection / schema probe
    let probe;
    try { probe = await fetch(SUPABASE_URL + "/rest/v1/app_state?select=key,version&limit=1", { headers: authHeaders(), cache: "no-store" }); }
    catch (e) { throw new Error("Cannot connect to the Supabase URL. Check your internet."); }
    if (!probe.ok) {
      const t = (await probe.text()).slice(0, 200);
      if (/42703/.test(t) || /column.*version/i.test(t)) throw new Error("Database migration pending — run supabase-migration-v2.sql once in the SQL Editor. (" + t + ")");
      if (probe.status === 404 || /PGRST205|does not exist|schema cache/i.test(t)) throw new Error("Table not found — run supabase-setup.sql and supabase-migration-v2.sql. (" + t + ")");
      if (probe.status === 401 || probe.status === 403) throw new Error("Key not accepted or no RLS policy (" + probe.status + "): " + t);
      throw new Error("Supabase " + probe.status + ": " + t);
    }
    // 2. authoritative fetch + validation
    const [docs, pay, fin] = await Promise.all([fetchDocs(), fetchRows(DEFS.payments), fetchRows(DEFS.finTx)]);
    if (!Array.isArray(docs) || !Array.isArray(pay) || !Array.isArray(fin)) throw new Error("Unexpected response received from the Database");
    const dm = new Map(docs.map(r => [r.key, r]));
    const firstTime = !dm.has("_initialized") && !pay.length && !dm.has(MEMBERS_KEY) && !fin.length;

    // 3. load server state
    colls.payments.syncRows(pay); colls.finTx.syncRows(fin);
    for (const [key, name] of Object.entries(DOC_BY_KEY)) { const r = dm.get(key); if (r) colls[name].syncDoc(r.value, r.version); }

    if (firstTime) {
      // Brand-new, completely EMPTY database only: seed once from this browser / Excel master data.
      // An existing database is never overwritten by cache or INITIAL_PAYMENTS.
      const jl = (k, dflt) => { try { return JSON.parse(ls.getItem(k) || "null") ?? dflt; } catch { return dflt; } };
      const seed = {
        payments: jl(PAY_KEY, typeof INITIAL_PAYMENTS !== "undefined" ? INITIAL_PAYMENTS : []),
        members: jl(MEMBERS_KEY, typeof MEMBERS !== "undefined" ? MEMBERS : null),
        settings: jl(SETTINGS_KEY, null), passwords: jl(PW_KEY, null), finCfg: jl(FIN_CFG_KEY, null), incomeYears: jl(INCOME_YEARS_KEY, null), paymentAudit: jl(PAYMENT_AUDIT_KEY, []), finTx: jl(FIN_TX_KEY, [])
      };
      ready = true;
      for (const [n, v] of Object.entries(seed)) if (v) colls[n].onLocal(JSON.stringify(v));
      persistQueue(); kick(true);
      if (!(await flush())) { ready = false; throw new Error("First-time Database setup did not complete — try again"); }
    }
    if (!dm.has("_initialized"))
      await api("app_state?on_conflict=key", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: [{ key: "_initialized", value: { at: new Date().toISOString() } }] }).catch(() => { });

    // 4. replay changes saved locally but never delivered (offline / tab closed). They keep their
    //    ORIGINAL base version, so they can never overwrite newer server data (they become conflicts).
    let outbox = []; try { outbox = JSON.parse(ls.getItem(OUTBOX_KEY) || "[]"); } catch { }
    for (const o of outbox) {
      const c = colls[o.name]; if (!c || queue.has(qkey(o.name, o.id))) continue;
      queue.set(qkey(o.name, o.id), { name: o.name, id: o.id, t: o.t, j: o.j, base: o.base });
      if (o.t === "set") c.view.set(o.id, o.j); else c.view.delete(o.id);
    }

    // 5. populate cache from server state (+ replayed local changes)
    for (const c of Object.values(colls)) {
      if (!c.isRows() && c.ver === null && !c.view.size) ls.removeItem(c.def.lsKey); else c.cache();
    }
    window.DB_FIN_READY = true;
    ready = true;
    persistQueue(); refreshPill(); kick();
  }

  // app.js / finance.js register one handler per data set; it receives the fresh value
  const subscribe = (name, fn) => { subs[name] = fn; };

  window.DB = {
    init, flush, upload, signedUrl, removeFiles, subscribe, startRealtime, resync,
    pending: () => queue.size > 0 || pumping,
    isLive: () => rtStatus === "SUBSCRIBED",
    status: () => ({ realtime: rtStatus, pending: queue.size, online: navigator.onLine, lastError: lastErr && lastErr.message }),
    _debug: { colls, queue, canon, handleEvent }
  };
})();
