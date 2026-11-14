const { Server, browser, sleep } = require("./harness.js");
const assert = require("assert");
const results = [];
async function test(name, fn) { try { await fn(); results.push(["PASS", name]); } catch (e) { results.push(["FAIL", name + " :: " + e.message]); if (process.env.VERBOSE) console.error(e.stack); } }
const PAY = "pgcs_payments_v3", FTX = "pgcs_fin_tx_v1", MEM = "pgcs_members_v1", SET = "pgcs_settings_v1", PWK = "pgcs_passwords_v1", CFG = "pgcs_fin_cfg_v1";
const now = new Date().toISOString();
function seed(s) {
  const put = (t, k, o) => s.t[t].set(String(k), { ...o, version: 1, created_at: now + String(++s.seq).padStart(6, "0"), updated_at: now });
  for (let i = 1; i <= 5; i++) put("payments", i, { id: i, data: { id: i, mid: "PGCS-210" + i, fy: "2025-26", inst: "Jan", amount: 1000, status: "Approved", comment: "" } });
  put("fin_transactions", "t1", { id: "t1", data: { id: "t1", type: "invest", date: "2026-01-05", amount: 5000, cat: "inv", acc: "bank" } });
  put("app_state", MEM, { key: MEM, value: [{ mid: "PGCS-2101", name: "A", status: "Active" }, { mid: "PGCS-2102", name: "B", status: "Active" }] });
  put("app_state", SET, { key: SET, value: { formOpen: true, bank: "BASIC", methods: ["BEFTN"], closed: [], amt: { "2025-26|Jan": 1000 }, accounts: [] } });
  put("app_state", PWK, { key: PWK, value: { "PGCS-2101": "pw1" } });
  put("app_state", CFG, { key: CFG, value: { accounts: [{ kind: "income", key: "x", name: "X" }] } });
  put("app_state", "_initialized", { key: "_initialized", value: { at: now } });
}
const fresh = async (opts = {}) => { const s = new Server(); seed(s); return s; };
const boot = async (s, name, o) => { const b = browser(s, name, o); await b.DB.init(); b.DB.startRealtime(); await sleep(20); return b; };
const P = (id, extra = {}) => ({ id, mid: "PGCS-2101", fy: "2025-26", inst: "Feb", amount: 1000, status: "Draft", comment: "", ...extra });
const srvPay = s => [...s.t.payments.values()].map(r => r.data).sort((a, b) => a.id - b.id);

(async () => {
  await test("Init: loads server state; stale cache + INITIAL_PAYMENTS never pushed", async () => {
    const s = await fresh(); const store = new Map([[PAY, JSON.stringify([{ id: 999, mid: "OLD" }])], [FTX, "[{\"id\":\"stale\"}]"]]);
    const b = browser(s, "B", { store }); const w0 = s.writes.length; await b.DB.init();
    assert.equal(s.writes.length, w0, "init wrote to server: " + JSON.stringify(s.writes.slice(w0)));
    assert.deepEqual(b.get(PAY).map(p => p.id), [1, 2, 3, 4, 5]); assert.deepEqual(b.get(FTX).map(t => t.id), ["t1"]);
    assert.equal(s.t.payments.has("999"), false); assert.equal(s.t.payments.has("1"), true);
  });
  await test("A. Add payment on browser1 -> appears on browser2 via Realtime, no write-back", async () => {
    const s = await fresh(); const b1 = await boot(s, "local"), b2 = await boot(s, "pages");
    b1.set(PAY, [...b1.get(PAY), P(100)]); assert.equal(await b1.DB.flush(), true); await sleep(60);
    assert.ok(b2.got.payments && b2.got.payments.some(p => p.id === 100), "b2 did not get event");
    assert.ok(b2.get(PAY).some(p => p.id === 100), "b2 cache not updated");
    const w = s.writes.length; await sleep(100); assert.equal(s.writes.length, w, "echo wrote back");
    assert.equal(b2.DB.pending(), false);
  });
  await test("B. Financial tx added on browser2 appears on browser1 (+edit, +delete sync)", async () => {
    const s = await fresh(); const b1 = await boot(s, "local"), b2 = await boot(s, "pages");
    b2.set(FTX, [...b2.get(FTX), { id: "t2", type: "income", date: "2026-02-01", amount: 700, cat: "profit", acc: "bank", docs: [{ path: "t2/a.pdf", name: "a.pdf" }] }]);
    await b2.DB.flush(); await sleep(60);
    assert.deepEqual(b1.get(FTX).map(t => t.id), ["t1", "t2"]); assert.equal(b1.get(FTX)[1].docs[0].path, "t2/a.pdf");
    b1.set(FTX, b1.get(FTX).map(t => t.id === "t2" ? { ...t, amount: 800 } : t)); await b1.DB.flush(); await sleep(60);
    assert.equal(b2.get(FTX)[1].amount, 800);
    b2.set(FTX, b2.get(FTX).filter(t => t.id !== "t2")); await b2.DB.flush(); await sleep(60);
    assert.deepEqual(b1.get(FTX).map(t => t.id), ["t1"]); assert.equal(s.t.fin_transactions.has("t2"), false);
  });
  await test("E. Simultaneous adds from two browsers: both survive (stale browser without realtime)", async () => {
    const s = await fresh(); const b1 = await boot(s, "local", { realtime: false }), b2 = await boot(s, "pages", { realtime: false });
    b1.set(PAY, [...b1.get(PAY), P(201)]); b2.set(PAY, [...b2.get(PAY), P(202)]);
    b1.set(FTX, [...b1.get(FTX), { id: "ta", type: "income", date: "2026-02-02", amount: 1 }]); b2.set(FTX, [...b2.get(FTX), { id: "tb", type: "expense", date: "2026-02-02", amount: 2 }]);
    assert.equal((await Promise.all([b1.DB.flush(), b2.DB.flush()])).every(Boolean), true);
    assert.deepEqual(srvPay(s).map(p => p.id), [1, 2, 3, 4, 5, 201, 202]);
    assert.deepEqual([...s.t.fin_transactions.keys()].sort(), ["t1", "ta", "tb"]);
    await b1.DB.resync(); await b2.DB.resync();
    assert.deepEqual(b1.get(PAY).map(p => p.id), [1, 2, 3, 4, 5, 201, 202]); assert.deepEqual(b2.get(FTX).map(t => t.id).sort(), ["t1", "ta", "tb"]);
  });
  await test("Stale browser saving an UNRELATED change does not delete newer records", async () => {
    const s = await fresh(); const stale = await boot(s, "stale", { realtime: false }), live = await boot(s, "live");
    live.set(PAY, [...live.get(PAY), P(300)]); live.set(FTX, [...live.get(FTX), { id: "tnew", type: "income", date: "2026-03-01", amount: 9 }]); await live.DB.flush();
    const set = stale.get(SET); set.bank = "NEW BANK"; stale.set(SET, set); stale.set(PAY, stale.get(PAY)); stale.set(FTX, stale.get(FTX)); await stale.DB.flush();
    assert.ok(s.t.payments.has("300")); assert.ok(s.t.fin_transactions.has("tnew")); assert.equal(s.t.app_state.get(SET).value.bank, "NEW BANK");
  });
  await test("Stale browser cannot delete a record another device edited (CAS) + conflict message", async () => {
    const s = await fresh(); const stale = await boot(s, "stale", { realtime: false }), live = await boot(s, "live");
    live.set(PAY, live.get(PAY).map(p => p.id === 3 ? { ...p, comment: "edited by live" } : p)); await live.DB.flush();
    let conflicts = null; stale.win.addEventListener("db-conflict", e => conflicts = e.detail);
    stale.set(PAY, stale.get(PAY).filter(p => p.id !== 3)); const ok = await stale.DB.flush();
    assert.ok(s.t.payments.has("3"), "record was deleted"); assert.equal(s.t.payments.get("3").data.comment, "edited by live");
    assert.ok(conflicts && conflicts[0].id === "3", "no conflict reported"); assert.ok(stale.get(PAY).some(p => p.id === 3 && p.comment === "edited by live"), "local not reloaded");
  });
  await test("Conflicting edits of the same payment: first wins, second gets server copy", async () => {
    const s = await fresh(); const b1 = await boot(s, "1", { realtime: false }), b2 = await boot(s, "2", { realtime: false });
    b1.set(PAY, b1.get(PAY).map(p => p.id === 2 ? { ...p, status: "Rejected" } : p)); await b1.DB.flush();
    let c = null; b2.win.addEventListener("db-conflict", e => c = e.detail);
    b2.set(PAY, b2.get(PAY).map(p => p.id === 2 ? { ...p, comment: "mine" } : p)); await b2.DB.flush();
    assert.equal(s.t.payments.get("2").data.status, "Rejected"); assert.equal(s.t.payments.get("2").data.comment, ""); assert.ok(c);
    assert.equal(b2.get(PAY).find(p => p.id === 2).status, "Rejected");
  });
  await test("Settings/passwords/members: concurrent edits of DIFFERENT entries merge", async () => {
    const s = await fresh(); const b1 = await boot(s, "1", { realtime: false }), b2 = await boot(s, "2", { realtime: false });
    let x = b1.get(SET); x.bank = "BANK-1"; x.amt["2025-26|Feb"] = 1200; b1.set(SET, x);
    let y = b2.get(SET); y.methods = ["BEFTN", "NPSB"]; y.amt["2025-26|Mar"] = 1300; b2.set(SET, y);
    b1.set(PWK, { ...b1.get(PWK), "PGCS-2102": "pw2" }); b2.set(PWK, { ...b2.get(PWK), "PGCS-2103": "pw3" });
    b1.set(MEM, [...b1.get(MEM), { mid: "PGCS-2109", name: "New1", status: "Active" }]); b2.set(MEM, b2.get(MEM).map(m => m.mid === "PGCS-2102" ? { ...m, mobile: "01711111111" } : m));
    await Promise.all([b1.DB.flush(), b2.DB.flush()]);
    const S = s.t.app_state.get(SET).value; assert.equal(S.bank, "BANK-1"); assert.deepEqual(S.methods, ["BEFTN", "NPSB"]); assert.deepEqual(S.amt, { "2025-26|Jan": 1000, "2025-26|Feb": 1200, "2025-26|Mar": 1300 });
    assert.deepEqual(Object.keys(s.t.app_state.get(PWK).value).sort(), ["PGCS-2101", "PGCS-2102", "PGCS-2103"]);
    const M = s.t.app_state.get(MEM).value; assert.equal(M.length, 3); assert.equal(M.find(m => m.mid === "PGCS-2102").mobile, "01711111111");
  });
  await test("Same settings key edited by two people -> conflict, nothing silently lost", async () => {
    const s = await fresh(); const b1 = await boot(s, "1", { realtime: false }), b2 = await boot(s, "2", { realtime: false });
    let x = b1.get(SET); x.bank = "B1"; b1.set(SET, x); await b1.DB.flush(); let c = null; b2.win.addEventListener("db-conflict", e => c = e.detail);
    let y = b2.get(SET); y.bank = "B2"; b2.set(SET, y); await b2.DB.flush();
    assert.equal(s.t.app_state.get(SET).value.bank, "B1"); assert.ok(c); assert.equal(b2.get(SET).bank, "B1");
  });
  await test("Offline save: reported as failed, kept in outbox, delivered when back online", async () => {
    const s = await fresh(); const b = await boot(s, "1", { realtime: false }); s.down = true;
    b.set(PAY, [...b.get(PAY), P(400)]); b.set(FTX, [...b.get(FTX), { id: "toff", type: "income", date: "2026-04-01", amount: 5 }]);
    const ok = await b.DB.flush(); assert.equal(ok, false); assert.ok(b.ls.getItem("pgcs_outbox_v1")); assert.equal(s.t.payments.has("400"), false);
    s.down = false; assert.equal(await b.DB.flush(), true); assert.ok(s.t.payments.has("400") && s.t.fin_transactions.has("toff")); assert.equal(b.ls.getItem("pgcs_outbox_v1"), null);
  });
  await test("Closed tab with unsent edit: replay keeps original base -> cannot overwrite newer server data", async () => {
    const s = await fresh(); const store = new Map(); const b = await boot(s, "1", { realtime: false, store }); s.down = true;
    b.set(PAY, b.get(PAY).map(p => p.id === 4 ? { ...p, comment: "offline edit" } : p).concat([P(450)])); await b.DB.flush();
    s.down = false; const other = await boot(s, "2", { realtime: false });
    other.set(PAY, other.get(PAY).map(p => p.id === 4 ? { ...p, comment: "online edit" } : p)); await other.DB.flush();
    const b2 = browser(s, "1-restarted", { realtime: false, store }); await b2.DB.init(); await b2.DB.flush();
    assert.equal(s.t.payments.get("4").data.comment, "online edit", "offline edit overwrote newer data"); assert.ok(s.t.payments.has("450"), "offline-added record lost");
    assert.equal(b2.get(PAY).find(p => p.id === 4).comment, "online edit");
  });
  await test("Realtime DELETE applied; duplicate/out-of-order events are idempotent", async () => {
    const s = await fresh(); const b1 = await boot(s, "1"), b2 = await boot(s, "2");
    b1.set(PAY, b1.get(PAY).filter(p => p.id !== 5)); await b1.DB.flush(); await sleep(60);
    assert.ok(!b2.get(PAY).some(p => p.id === 5)); const calls = b2.calls;
    const row = s.t.payments.get("2"); const ev = { eventType: "UPDATE", new: { ...row, data: { ...row.data, comment: "dup" } }, old: { id: 2 } };
    b2.DB._debug.handleEvent("payments", { ...ev, new: { ...ev.new, version: row.version } });   // same version as known -> ignored
    await sleep(60); assert.equal(b2.calls, calls, "duplicate event re-applied");
  });
  await test("Missed events (disconnect) recovered by resync; deletes too", async () => {
    const s = await fresh(); const b1 = await boot(s, "1", { realtime: false }), b2 = await boot(s, "2", { realtime: false });
    b2.set(PAY, [...b2.get(PAY).filter(p => p.id !== 1), P(500)]); await b2.DB.flush(); await b1.DB.resync(); await sleep(60);
    assert.deepEqual(b1.get(PAY).map(p => p.id), [2, 3, 4, 5, 500]);
  });
  await test("Remote update never writes back to DB (no loop) and subscribers get the data", async () => {
    const s = await fresh(); const b1 = await boot(s, "1"), b2 = await boot(s, "2"); const w = s.writes.length;
    let x = b1.get(SET); x.bank = "X"; b1.set(SET, x); await b1.DB.flush(); await sleep(80);
    assert.equal(b2.got.settings.bank, "X"); assert.equal(s.writes.length, w + 1, "extra writes: " + JSON.stringify(s.writes.slice(w)));
  });
  await test("Payment id collision (two devices, same id) -> second reported as conflict, first kept", async () => {
    const s = await fresh(); const b1 = await boot(s, "1", { realtime: false }), b2 = await boot(s, "2", { realtime: false });
    b1.set(PAY, [...b1.get(PAY), P(777, { comment: "one" })]); await b1.DB.flush();
    let c = null; b2.win.addEventListener("db-conflict", e => c = e.detail); b2.set(PAY, [...b2.get(PAY), P(777, { comment: "two" })]); await b2.DB.flush();
    assert.equal(s.t.payments.get("777").data.comment, "one"); assert.ok(c);
  });
  await test("Empty database: seeded once from Excel master data; existing DB never re-seeded", async () => {
    const s = new Server(); const b = browser(s, "1", { realtime: false }); await b.DB.init();
    assert.ok(s.t.payments.has("1")); assert.ok(s.t.app_state.has("_initialized"));
    s.t.payments.delete("1"); const b2 = browser(s, "2", { realtime: false }); await b2.DB.init(); assert.equal(s.t.payments.has("1"), false, "re-seeded existing DB");
  });
  await test("Sequential-save race: two quick edits of one record both land (after-queue)", async () => {
    const s = await fresh(); const b = await boot(s, "1", { realtime: false });
    b.set(PAY, b.get(PAY).map(p => p.id === 1 ? { ...p, comment: "v1" } : p)); await sleep(1);
    b.set(PAY, b.get(PAY).map(p => p.id === 1 ? { ...p, comment: "v2" } : p)); assert.equal(await b.DB.flush(), true);
    assert.equal(s.t.payments.get("1").data.comment, "v2");
  });
  for (const [r, n] of results) console.log(r, "-", n);
  console.log(results.filter(r => r[0] === "PASS").length + "/" + results.length + " passed");
  process.exit(results.some(r => r[0] === "FAIL") ? 1 : 0);
})();
