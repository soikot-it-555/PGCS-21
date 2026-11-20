// In-process fake Supabase (PostgREST subset + realtime) and fake browsers running the REAL db.js
const vm = require("vm"), fs = require("fs");
const DBJS = fs.readFileSync(__dirname + "/../db.js", "utf8");

class Server {
  constructor() { this.t = { app_state: new Map(), payments: new Map(), fin_transactions: new Map() }; this.pk = { app_state: "key", payments: "id", fin_transactions: "id" };
    this.listeners = new Set(); this.down = false; this.log = []; this.seq = 0; this.writes = []; }
  emit(table, eventType, nw, old) { for (const l of this.listeners) l(table, { eventType, new: nw ? JSON.parse(JSON.stringify(nw)) : {}, old: old || {} }); }
  match(row, filters) { return filters.every(([c, op, v]) => op === "eq" && String(row[c]) === v); }
  async handle(url, init = {}) {
    if (this.down) throw new TypeError("Failed to fetch");
    const u = new URL(url), path = u.pathname.replace("/rest/v1/", ""), table = path, method = init.method || "GET";
    const prefer = (init.headers && init.headers.Prefer) || "";
    const T = this.t[table]; if (!T) return new Response("{\"code\":\"PGRST205\"}", { status: 404 });
    const pk = this.pk[table], filters = [];
    for (const [k, v] of u.searchParams) if (v.startsWith("eq.")) filters.push([k, "eq", decodeURIComponent(v.slice(3))]);
    const body = init.body ? JSON.parse(init.body) : undefined, now = new Date().toISOString();
    const ok = (data, st = 200) => new Response(data === null ? "" : JSON.stringify(data), { status: st });
    const sel = rows => rows.map(r => JSON.parse(JSON.stringify(r)));
    if (method === "GET") {
      let rows = [...T.values()].filter(r => this.match(r, filters));
      rows.sort((a, b) => (a.created_at + String(a[pk])).localeCompare(b.created_at + String(b[pk])));
      const off = Number(u.searchParams.get("offset") || 0), lim = Number(u.searchParams.get("limit") || 1e9);
      return ok(sel(rows.slice(off, off + lim)));
    }
    if (method === "POST") {
      const out = [];
      for (const r of body) {
        const k = String(r[pk]);
        if (T.has(k)) { if (prefer.includes("ignore-duplicates")) continue; const old = T.get(k); const nr = { ...old, ...r, version: old.version + 1, updated_at: now }; T.set(k, nr); out.push(nr); this.emit(table, "UPDATE", nr, { [pk]: r[pk] }); this.writes.push(["upsert", table, k]); continue; }
        const nr = { ...r, version: 1, created_at: now + String(++this.seq).padStart(6, "0"), updated_at: now }; T.set(k, nr); out.push(nr); this.emit(table, "INSERT", nr); this.writes.push(["insert", table, k]);
      }
      return prefer.includes("return=representation") ? ok(out, 201) : ok(null, 201);
    }
    if (method === "PATCH") {
      const out = [];
      for (const r of [...T.values()]) if (this.match(r, filters)) { const gm = this.guard && this.guard(table, r, body); if (gm) return new Response(JSON.stringify({ code: "P0001", message: gm }), { status: 400 }); const nr = { ...r, ...body, version: r.version + 1, updated_at: now }; T.set(String(r[pk]), nr); out.push(nr); this.emit(table, "UPDATE", nr, { [pk]: r[pk] }); this.writes.push(["update", table, String(r[pk])]); }
      return prefer.includes("return=representation") ? ok(out) : ok(null, 204);
    }
    if (method === "DELETE") {
      const out = [];
      for (const r of [...T.values()]) if (this.match(r, filters)) { T.delete(String(r[pk])); out.push(r); this.emit(table, "DELETE", null, { [pk]: r[pk] }); this.writes.push(["delete", table, String(r[pk])]); }
      return prefer.includes("return=representation") ? ok(out) : ok(null, 204);
    }
  }
}

function browser(server, name, { realtime = true, store: st } = {}) {
  const store = st || new Map();
  class Storage { setItem(k, v) { store.set(k, String(v)); } getItem(k) { return store.has(k) ? store.get(k) : null; } removeItem(k) { store.delete(k); } }
  const localStorage = new Storage();
  const mkEl = () => ({ style: {}, appendChild() {}, set textContent(v) { this._t = v; }, get textContent() { return this._t; } });
  const listeners = {};
  const win = { localStorage, addEventListener: (e, f) => (listeners[e] ||= []).push(f), dispatchEvent: ev => { (listeners[ev.type] || []).forEach(f => f(ev)); return true; } };
  let channelStatusCb = null, rtHandlers = [], unsub = null;
  const sandbox = {
    window: win, Storage, document: { getElementById: () => null, createElement: mkEl, body: mkEl(), addEventListener() {}, visibilityState: "visible" },
    navigator: { onLine: true }, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } },
    AbortController, setTimeout, clearTimeout, setInterval: () => 0, console: { log() {}, warn() {}, error: (...a) => { if (process.env.VERBOSE) console.error(...a); } }, Response,
    fetch: (url, init) => server.handle(url, init), Promise, JSON, Map, Set, Error, Object, Array, String, Number, Date, URL, TypeError, encodeURIComponent, decodeURIComponent,
    INITIAL_PAYMENTS: [{ id: 1, mid: "X" }], MEMBERS: []
  };
  if (realtime) win.supabase = { createClient: () => ({
    removeChannel: async () => { if (unsub) { server.listeners.delete(unsub); unsub = null; } },
    channel: () => { const ch = { on(_t, _f, cb) { rtHandlers.push(cb); return ch; }, subscribe(cb) { channelStatusCb = cb;
      unsub = (table, p) => { rtHandlers.forEach(h => h._t === undefined && 0); handlers[table] && handlers[table](p); };
      server.listeners.add(unsub); setTimeout(() => cb("SUBSCRIBED"), 5); return ch; } }; return ch; } }) };
  const handlers = {};
  // intercept .on to map by table
  if (realtime) { const orig = win.supabase.createClient; win.supabase.createClient = (...a) => { const c = orig(...a); const ch0 = c.channel; c.channel = n => { const ch = ch0(n); ch.on = (_t, f, cb) => { handlers[f.table] = cb; return ch; }; return ch; }; return c; }; }
  vm.createContext(sandbox); sandbox.globalThis = sandbox;
  vm.runInContext(DBJS, sandbox, { filename: "db.js" });
  const b = { name, DB: win.DB, ls: localStorage, store, win, sandbox,
    got: {}, // last value delivered to subscribers
    get: k => JSON.parse(localStorage.getItem(k) || "null"), set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
    setStatus: s => channelStatusCb && channelStatusCb(s) };
  for (const n of ["payments", "finTx", "members", "settings", "passwords", "finCfg"]) win.DB.subscribe(n, v => { b.got[n] = v; b.calls = (b.calls || 0) + 1; });
  return b;
}
module.exports = { Server, browser, sleep: ms => new Promise(r => setTimeout(r, ms)) };
