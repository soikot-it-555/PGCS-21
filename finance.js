// ===== Financial Statement — double-entry ledger ভিত্তিক, লেনদেন থেকে নিজে থেকে হালনাগাদ =====
// Opening balance = Financial_Statement.xlsx (09-08-2026)। তার পরের সব Approved কিস্তি ও Admin-এর লেনদেন যুক্ত হয়।
const FIN_MEMBER_DOWNLOAD = false;      // true দিলে সাধারণ সদস্যরাও PDF/Excel নামাতে পারবে
const FIN_INCEPTION = "2025-07-01";     // সমিতির শুরুর তারিখ (Excel: "July 1, 2025")
const FIN_OPEN = { cutoff: "2026-08-09", inc: { membership: 17000, profit: 0, interest: 11407.73, misc: 0 }, exp: { ops: 0, bank: 2038.28, admin: 5100, contingency: 0 } };
const FIN_OPEN_BAL = { "ast:bank": 479452.45, "ast:inv": 105917, "ast:hand": 0, "ast:land": 0, "lia:pay": 5100, "eqt:cap": 612000, "eqt:ret": 21269.45 };
// ⚠ Opening-এর আয়-ব্যয় কোন আর্থিক বছরের — Excel-এ তারিখ নেই, তাই সবটা 2025-26-এ ধরা হয়েছে। জানা থাকলে এখানে ভাগ করুন (দুই বছরের যোগফল = inc/exp)।
FIN_OPEN.split = { "2025-26": { inc: { ...FIN_OPEN.inc }, exp: { ...FIN_OPEN.exp } }, "2026-27": { inc: {}, exp: {} } };
const FIN_MEM = {"PGCS-2101": {"inv": 35000, "fee": 1000, "due": 2000, "note": "July/26 Payment Due (2000/-)"}, "PGCS-2102": {"inv": 35000, "fee": 1000, "due": 2000, "note": "July/26 Payment Due (2000/-)"}, "PGCS-2103": {"inv": 31000, "fee": 1000, "due": 6000, "note": "May/26, June/26 & July/26 Payment Due (6000/-)"}, "PGCS-2104": {"inv": 35000, "fee": 1000, "due": 2000, "note": "July/26 Payment Due (2000/-)"}, "PGCS-2105": {"inv": 37000, "fee": 1000, "due": 0, "note": ""}, "PGCS-2106": {"inv": 29000, "fee": 1000, "due": 8000, "note": "April/26, May/26, June/26 & July/26 Payment Due (8000/-)"}, "PGCS-2107": {"inv": 37000, "fee": 1000, "due": 0, "note": ""}, "PGCS-2108": {"inv": 29000, "fee": 1000, "due": 8000, "note": "April/26, May/26, June/26 & July/26 Payment Due (8000/-)"}, "PGCS-2109": {"inv": 31000, "fee": 1000, "due": 6000, "note": "May/26, June/26 & July/26 Payment Due (6000/-)"}, "PGCS-2110": {"inv": 34000, "fee": 1000, "due": 3000, "note": "April/26 & July/26(1/2) Payment Due (3000/-)"}, "PGCS-2111": {"inv": 37000, "fee": 1000, "due": 0, "note": ""}, "PGCS-2112": {"inv": 35000, "fee": 1000, "due": 2000, "note": "July/26 Payment Due (2000/-)"}, "PGCS-2113": {"inv": 31000, "fee": 1000, "due": 6000, "note": "May/26, June/26 & July/26 Payment Due (6000/-)"}, "PGCS-2114": {"inv": 33000, "fee": 1000, "due": 4000, "note": "June/26 & July/26 Payment Due (4000/-)"}, "PGCS-2115": {"inv": 37000, "fee": 1000, "due": 0, "note": ""}, "PGCS-2116": {"inv": 35000, "fee": 1000, "due": 2000, "note": "July/26 Payment Due (2000/-)"}, "PGCS-2117": {"inv": 35000, "fee": 1000, "due": 2000, "note": "July/26 Payment Due (2000/-)"}};
// [kind, key, name, auto]  kind: inc=Income, exp=Expense, ast=Asset, lia=Liability, eqt=Equity। auto = সিস্টেম নিজে হিসাব করে (নিষ্ক্রিয়/লেনদেন-নির্বাচন নয়)
const FIN_SYS = [["inc", "membership", "Membership Fee", 1], ["inc", "profit", "Business Investment Returns / Profit"], ["inc", "interest", "Bank Interest"], ["inc", "misc", "Miscellaneous Income"],
  ["exp", "ops", "Business Operations & Management"], ["exp", "bank", "Bank Charges, Tax, Vat & Digital Fees"], ["exp", "admin", "Administrative & Legal Expenses"], ["exp", "contingency", "Contingency & Maintenance"],
  ["ast", "bank", "Cash at Bank"], ["ast", "inv", "Short-term Business Investments"], ["ast", "hand", "Cash in Hand"], ["ast", "recv", "Monthly Subscriptions Receivable", 1], ["ast", "land", "Land/Plot Advance & Acquisition"],
  ["eqt", "cap", "Member Capital Equity", 1], ["eqt", "ret", "Retained Earnings/Surplus", 1], ["lia", "pay", "Accounts Payable / Accrued Expenses"]];
const FIN_KIND = { inc: "Revenue / Income", exp: "Operating Expense", ast: "Asset", lia: "Liability", eqt: "Equity" };
const FIN_TYPES = { income: "আয় (Profit / Interest / Income)", expense: "খরচ (Expense)", invest: "নতুন Investment / Asset ক্রয়", invest_return: "Investment ফেরত (Principal)", settle: "Liability পরিশোধ (Accounts Payable ইত্যাদি)",
  payout: "সদস্যপদ বাতিল — Final Settlement", journal: "Journal (Advanced — যেকোনো দুই Account)", profit: "Business Profit / Return", interest: "Bank Interest", misc: "Miscellaneous Income" };
const FIN_FORM_TYPES = ["income", "expense", "invest", "invest_return", "settle", "payout", "journal"];
const FIN_MAX_FILE = 10 * 1024 * 1024, FIN_MAX_FILES = 10, FIN_FILE_RE = /\.(pdf|jpe?g|png|docx?|xlsx?)$/i, FIN_ACCEPT = ".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx";

// ---------- Storage (localStorage = cache; db.js এগুলো Supabase-এ পাঠায়) ----------
const FIN_TX_KEY = "pgcs_fin_tx_v1", FIN_CFG_KEY = "pgcs_fin_cfg_v1";
let FTX = JSON.parse(localStorage.getItem(FIN_TX_KEY) || "[]");
let FCFG = JSON.parse(localStorage.getItem(FIN_CFG_KEY) || '{"accounts":[]}'); FCFG.accounts = FCFG.accounts || [];
const saveTx = () => localStorage.setItem(FIN_TX_KEY, JSON.stringify(FTX));
const saveCfg = () => localStorage.setItem(FIN_CFG_KEY, JSON.stringify(FCFG));
if (S.fin && S.fin.tx && S.fin.tx.length && !FTX.length) { FTX = S.fin.tx.map(t => ({ ...t, id: String(t.id) })); saveTx(); }   // আগের সংস্করণ থেকে স্থানান্তর
if (S.fin) { delete S.fin; saveS(); }
const finId = () => (crypto.randomUUID ? crypto.randomUUID() : "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));

const fN = n => Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fD = iso => iso ? iso.split("-").reverse().join("-") : "";
const finToday = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const finAddDays = (iso, n) => { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const finCutoff = () => FIN_OPEN.cutoff;
const finTx = () => FTX;
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
let finAsOf = null, finFY = "ALL", finEditId = null, finBusy = false;
const finCanDownload = () => isApprover() || FIN_MEMBER_DOWNLOAD;

// ---------- Accounts (Admin (IT) কনফিগার করতে পারে; id স্থায়ী, তাই নাম বদলালে ইতিহাস নষ্ট হয় না) ----------
function finAccounts() {
  const ov = {}; FCFG.accounts.forEach(a => { ov[a.kind + ":" + a.key] = a; });
  const list = FIN_SYS.map(([kind, key, name, auto], i) => ({ kind, key, name, desc: "", active: true, order: (i + 1) * 10, ...(ov[kind + ":" + key] || {}), sys: true, auto: !!auto, id: kind + ":" + key }));
  FCFG.accounts.filter(a => a.custom).forEach(a => list.push({ desc: "", active: true, order: 1000, ...a, sys: false, auto: false, id: a.kind + ":" + a.key }));
  return list.sort((x, y) => x.order - y.order);
}
const finAcc = kind => finAccounts().filter(a => a.kind === kind);
const finName = id => (finAccounts().find(a => a.id === id) || { name: id }).name;
const finPickable = kind => finAcc(kind).filter(a => a.active && !a.auto);   // নতুন লেনদেনে দেখানো যাবে
const finMember = mid => MEMBERS.find(m => m.mid === mid);
function finSettleDate(mid) { const t = FTX.filter(x => x.type === "payout" && x.mid === mid).sort((a, b) => a.date.localeCompare(b.date))[0]; return t ? t.date : null; }

// ---------- Double-entry: প্রতিটি লেনদেন = Debit/Credit ----------
function finEntries(t) {
  const a = t.amount, acc = "ast:" + (t.acc || "bank"), lia = "lia:" + (t.liab || "pay");
  switch (t.type) {
    case "invest": return [{ dr: "ast:" + (t.cat || "inv"), cr: acc, a }];
    case "invest_return": return [{ dr: acc, cr: "ast:" + (t.cat || "inv"), a }];
    case "profit": case "interest": case "misc": return [{ dr: acc, cr: "inc:" + t.type, a }];
    case "income": return [{ dr: acc, cr: "inc:" + t.cat, a }];
    case "expense": return [{ dr: "exp:" + t.cat, cr: t.unpaid ? lia : acc, a }];
    case "settle": return [{ dr: lia, cr: acc, a }];
    case "journal": return [{ dr: t.dr, cr: t.cr, a }];
    default: return [];   // payout — সদস্যের হিসাব অনুযায়ী finCompute-এ আলাদাভাবে
  }
}
function finJournal(t) {
  if (t.type === "payout") return `Dr Member Capital Equity / Retained Earnings → Cr ${finName("ast:" + (t.acc || "bank"))}`;
  return finEntries(t).map(e => `Dr ${finName(e.dr)} → Cr ${finName(e.cr)}`).join("; ");
}
const finRefs = t => t.type === "payout" ? ["ast:" + (t.acc || "bank"), "eqt:cap", "eqt:ret"] : finEntries(t).flatMap(e => [e.dr, e.cr]);
const finUsed = id => FTX.some(t => finRefs(t).includes(id));

function finRange(fy) {
  if (fy === "ALL") return [FIN_INCEPTION, null];
  const y = Number(fy.slice(0, 4)); return [y + "-07-01", (y + 1) + "-06-30"];
}

// fy = "ALL" (শুরু থেকে) বা "2026-27"। Balance Sheet = জমা অবস্থা; Income Statement = শুধু নির্বাচিত সময়
function finCompute(asOfIn, fy = "ALL", txs = FTX) {
  const O = FIN_OPEN, C = finCutoff(), [pS, pFix] = finRange(fy);
  const eff = pFix && asOfIn > pFix ? pFix : asOfIn, asOf = eff < C ? C : eff, inP = d => d >= pS && d <= eff;
  const accs = finAccounts(), B = {}, I = {}, E = {}, pI = {}, pE = {};
  const sp = fy === "ALL" ? { inc: O.inc, exp: O.exp } : (O.split[fy] || { inc: {}, exp: {} });
  accs.forEach(a => {
    if (["ast", "lia", "eqt"].includes(a.kind)) B[a.id] = FIN_OPEN_BAL[a.id] || 0;
    if (a.kind === "inc") { I[a.key] = O.inc[a.key] || 0; pI[a.key] = sp.inc[a.key] || 0; }
    if (a.kind === "exp") { E[a.key] = O.exp[a.key] || 0; pE[a.key] = sp.exp[a.key] || 0; }
  });
  const bump = (k, v) => { B[k] = (B[k] || 0) + v; };
  const settle = {}; txs.filter(t => t.type === "payout").forEach(t => { if (!settle[t.mid] || t.date < settle[t.mid]) settle[t.mid] = t.date; });
  const mem = {}; MEMBERS.forEach(m => { const o = FIN_MEM[m.mid] || {}; mem[m.mid] = { m, inv: o.inv || 0, fee: o.fee || 0, openDue: o.due || 0, note: o.note || "", oldPaid: 0, newDue: 0, payout: 0, settledOn: null, add: 0, ded: 0 }; });
  const ev = [{ d: "", t: "add", a: O.inc.profit + O.inc.interest + O.inc.misc, open: true }, { d: "", t: "ded", a: O.inc.membership + Object.values(O.exp).reduce((s, v) => s + v, 0), open: true }];
  const instOf = p => (YEARS[p.fy] || []).find(i => i.key === p.inst);
  payments.filter(p => p.status === "Approved" && p.date && p.date <= asOf && mem[p.mid]).forEach(p => {
    const x = mem[p.mid], a = p.amount;
    if (p.inst === "Membership Fee") { if (p.date > C) { I.membership += a; bump("ast:bank", a); bump("eqt:ret", a); x.fee += a; x.inv += a; if (inP(p.date)) pI.membership += a; ev.push({ d: p.date, t: "ded", a }); } return; }
    const i = instOf(p), old = p.fy === "2025-26" || (i && i.due <= C);
    if (old) { if (p.date <= C) return; x.oldPaid += a; bump("ast:bank", a); x.inv += a; }
    else { bump("ast:bank", a); bump("eqt:cap", a); x.inv += a; }
  });
  // নতুন কিস্তি পেরিয়ে গেলে Receivable — শুধু Active সদস্য (বাতিল হলে বাতিলের তারিখ পর্যন্ত; Settlement-এর পর আর নয়)
  for (const f in YEARS) YEARS[f].forEach(i => {
    if (i.key === "Membership Fee" || i.due <= C || i.due > asOf) return;
    MEMBERS.forEach(m => {
      if (!(m.status === "Active" || (m.cancelDate && i.due <= m.cancelDate))) return;
      if (settle[m.mid] && i.due >= settle[m.mid]) return;
      const paid = payments.filter(p => p.fy === f && p.mid === m.mid && p.inst === i.key && p.status === "Approved" && p.date <= asOf).reduce((s, p) => s + p.amount, 0);
      const u = Math.max(0, i.amount - paid); mem[m.mid].newDue += u; bump("eqt:cap", u);
    });
  });
  let recv = 0;
  Object.values(mem).forEach(x => { const ap = Math.min(x.oldPaid, x.openDue); bump("eqt:cap", x.oldPaid - ap); x.recv = x.openDue - ap + x.newDue; x.applied = ap; recv += x.recv; });
  B["ast:recv"] = recv;
  const post = (e, d) => {
    const a = e.a, per = inP(d);
    const side = (id, sg) => {   // sg = +1 Debit, -1 Credit
      const [k, n] = id.split(":");
      if (k === "ast") bump(id, sg * a);
      else if (k === "lia" || k === "eqt") bump(id, -sg * a);
      else if (k === "exp") { E[n] = (E[n] || 0) + sg * a; if (per) pE[n] = (pE[n] || 0) + sg * a; bump("eqt:ret", -sg * a); ev.push({ d, t: "ded", a: sg * a }); }
      else if (k === "inc") { I[n] = (I[n] || 0) - sg * a; if (per) pI[n] = (pI[n] || 0) - sg * a; bump("eqt:ret", -sg * a); ev.push({ d, t: n === "membership" ? "ded" : "add", a: -sg * a }); }
    };
    side(e.dr, 1); side(e.cr, -1);
  };
  const live = txs.filter(t => t.date > C && t.date <= asOf);
  live.filter(t => t.type !== "payout").forEach(t => finEntries(t).forEach(e => post(e, t.date)));
  const rows = Object.values(mem);
  ev.forEach(e => {   // প্রতিটি আয়/ব্যয় তার তারিখে যারা তখন সদস্য (Settlement-এর আগে) তাদের মধ্যে সমান ভাগ
    const el = rows.filter(x => e.open ? !!FIN_MEM[x.m.mid] : (!settle[x.m.mid] || e.d < settle[x.m.mid]));
    el.forEach(x => { x[e.t] += e.a / el.length; });
  });
  live.filter(t => t.type === "payout").forEach(t => {   // Final Settlement: Cash কমে; Capital-এর অংশ Capital Equity থেকে, বাকিটা Retained Earnings থেকে
    const x = mem[t.mid]; if (!x) return;
    const capPart = x.inv - x.fee;
    bump("ast:" + (t.acc || "bank"), -t.amount); bump("eqt:cap", -capPart); bump("eqt:ret", -(t.amount - capPart));
    x.payout += t.amount; x.settledOn = t.date;
  });
  rows.forEach(x => { x.total = x.inv + x.add - x.ded - x.payout; x.cancelDate = x.m.cancelDate || ""; });
  const sum = o => Object.values(o).reduce((s, v) => s + v, 0), pick = k => Object.entries(B).filter(([id]) => id.startsWith(k + ":")).reduce((s, [, v]) => s + v, 0);
  const totInc = sum(I), totExp = sum(E), pTotInc = sum(pI), pTotExp = sum(pE), assets = pick("ast"), le = pick("lia") + pick("eqt");
  return { fy, asOf, eff, C, pS, pEnd: eff, B, I, E, pI, pE, totInc, totExp, bal: totInc - totExp, pTotInc, pTotExp, pBal: pTotInc - pTotExp, assets, le, recv,
    cash: B["ast:bank"], hand: B["ast:hand"], inv: B["ast:inv"], land: B["ast:land"], ret: B["eqt:ret"], cap: B["eqt:cap"], pay: B["lia:pay"], N: rows.length, rows,
    other: sum(I) - I.membership, diff: Math.round((assets - le) * 100) / 100 };
}

function finZip(L, R) { const n = Math.max(L.length, R.length), out = []; for (let i = 0; i < n; i++) out.push([L[i] ? L[i][0] : "", L[i] ? L[i][1] : null, R[i] ? R[i][0] : "", R[i] ? R[i][1] : null]); return out; }
function finIncRows(R) {
  const l = finAcc("inc").filter(a => a.active || Math.abs(R.pI[a.key] || 0) > 0.004).map(a => [a.name, R.pI[a.key] || 0]);
  const r = finAcc("exp").filter(a => a.active || Math.abs(R.pE[a.key] || 0) > 0.004).map(a => [a.name, R.pE[a.key] || 0]);
  return finZip(l, r);
}
function finBsRows(R) {
  const keep = a => a.active || Math.abs(R.B[a.id] || 0) > 0.004, v = a => [a.name, R.B[a.id] || 0];
  return finZip(finAcc("ast").filter(keep).map(v), [...finAcc("eqt"), ...finAcc("lia")].filter(keep).map(v));
}
const finNm = x => x.m.name + (x.settledOn ? ` (Settled ${fD(x.settledOn)})` : x.m.status !== "Active" ? " (Cancelled)" : "");
const finNotes = R => [`* Addition: Profit + Bank Interest + অন্যান্য আয় (মোট ${fN(R.other)}) — প্রতিটি আয় তার তারিখে তখনকার সদস্যদের মধ্যে সমান ভাগ`, `**Deduction: Membership fee + সব খরচ (মোট ${fN(R.I.membership + R.totExp)}) — একই নিয়মে ভাগ; Settlement-এর তারিখ থেকে সেই সদস্য বাদ`];
const finComment = (x, C) => [x.recv - x.newDue > 0 && x.note ? x.note : "", x.applied ? `Received after ${fD(C)}: ${x.applied}/-` : "", x.newDue ? `New Due: ${x.newDue}/-` : ""].filter(Boolean).join(" | ");

// ---------- Page ----------
function finLimits() {
  const t = finToday(), [pS, pFix] = finRange(finFY), min = pS < FIN_INCEPTION ? FIN_INCEPTION : pS;
  let max = pFix && pFix < t ? pFix : t; if (max < min) max = min;
  return { min, max };
}
function finView() { const { min, max } = finLimits(); let d = finAsOf || finToday(); if (d < min) d = min; if (d > max) d = max; return finCompute(d, finFY); }
function finSetDate(v) { const { min, max } = finLimits(); if (v && (v < min || v > max)) { toast(`তারিখ ${fD(min)} থেকে ${fD(max)}-এর মধ্যে হতে হবে`); v = v < min ? min : max; } finAsOf = v || null; renderFinance(); }
function finSetFY(v) { finFY = v; finAsOf = null; renderFinance(); }

function renderFinance() {
  const root = $("fin-root"); if (!root) return;
  const R = finView(), ap = isApprover(), { min, max } = finLimits();
  const td = (v, c = "") => `<td class="p-2 border ${c}">${v}</td>`, num = v => v === null ? "" : fN(v);
  const two = (rows, extra) => rows.map(r => `<tr>${td(esc(r[0]))}${td(num(r[1]), "text-right")}${td(esc(r[2]))}${td(num(r[3]), "text-right")}</tr>`).join("") + extra;
  const tot = (a, b, c, d) => `<tr class="bg-slate-100 font-bold">${td(a)}${td(fN(b), "text-right")}${td(c)}${td(d === null ? "" : fN(d), "text-right")}</tr>`;
  const card = (t, v, c) => `<div class="bg-white p-4 rounded-xl border"><p class="text-xs text-slate-500">${t}</p><p class="text-lg font-bold ${c}">৳ ${fN(v)}</p></div>`;
  const hd = (a, b, c, d) => `<thead class="bg-sky-800 text-white"><tr><th class="p-2 border text-left">${a}</th><th class="p-2 border text-right">${b}</th><th class="p-2 border text-left">${c}</th><th class="p-2 border text-right">${d}</th></tr></thead>`;
  const th = h => `<thead class="bg-sky-800 text-white"><tr>${h.map(x => `<th class="p-2 border text-left">${x}</th>`).join("")}</tr></thead>`;
  const rs = g => R.rows.reduce((s, x) => s + g(x), 0);
  const fyOpts = `<option value="ALL" ${finFY === "ALL" ? "selected" : ""}>All (শুরু থেকে আজ পর্যন্ত)</option>` + Object.keys(YEARS).sort().map(y => `<option ${finFY === y ? "selected" : ""}>${y}</option>`).join("");
  root.innerHTML = `
  <div class="flex flex-wrap items-center gap-3 mb-4"><h2 class="text-2xl font-bold">Financial Statement</h2>
    <span class="chip ${R.diff === 0 ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}">${R.diff === 0 ? "Assets = Liabilities + Equity ✓" : "পার্থক্য: " + fN(R.diff)}</span>
    <div class="ml-auto flex flex-wrap items-center gap-2 text-sm"><label>আর্থিক বছর:</label><select onchange="finSetFY(this.value)" class="border rounded-lg px-3 py-2">${fyOpts}</select>
      <label>Statement Date:</label><input type="date" value="${R.eff}" min="${min}" max="${max}" onchange="finSetDate(this.value)" class="border rounded-lg px-3 py-2">
      ${finCanDownload() ? `<button onclick="finPDF()" class="bg-rose-600 text-white px-4 py-2 rounded-lg">📄 PDF</button><button onclick="finExcel()" class="bg-emerald-600 text-white px-4 py-2 rounded-lg">📤 Excel</button>` : ""}</div></div>
  <p class="text-xs text-slate-500 mb-3">Income Statement = নির্বাচিত সময়ের আয়-ব্যয় (${fD(R.pS)} – ${fD(R.pEnd)}); Balance Sheet, Total Payable ও Receivable = ${fD(R.asOf)} তারিখ পর্যন্ত <b>জমা (cumulative)</b> অবস্থা। Opening: ${fD(R.C)}-এর Excel Statement।</p>
  <div class="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">${card("Total Assets", R.assets, "text-slate-800")}${card("Cash at Bank", R.cash, "text-emerald-600")}${card("Investments", R.inv + R.land, "text-sky-700")}${card("Subscriptions Receivable", R.recv, "text-rose-600")}${card("Surplus (Retained)", R.ret, "text-amber-600")}</div>
  <div class="bg-white rounded-xl border p-4 mb-5 overflow-x-auto"><h3 class="font-bold mb-1">Statement of Income and Expenditure</h3><p class="text-xs text-slate-500 mb-2">${fD(R.pS)} – ${fD(R.pEnd)}${finFY === "ALL" ? " (শুরু থেকে)" : " (আর্থিক বছর " + finFY + ")"}</p>
    <table class="w-full text-sm">${hd("Revenue / Inflows", "Amount (BDT)", "Operating Expenses / Outflows", "Amount (BDT)")}<tbody>${two(finIncRows(R), tot("Total Income", R.pTotInc, "Total Expenses", R.pTotExp) + tot("Balance", R.pBal, "", null))}</tbody></table></div>
  <div class="bg-white rounded-xl border p-4 mb-5 overflow-x-auto"><h3 class="font-bold mb-1">Statement of Financial Position (Balance Sheet)</h3><p class="text-xs text-slate-500 mb-2">As of ${fD(R.asOf)} — cumulative${R.eff < R.C ? " — এই বছরের শেষ দিনের Balance Sheet সংরক্ষিত নেই; সর্বশেষ Opening অবস্থা (Excel) দেখানো হলো" : ""}</p>
    <table class="w-full text-sm">${hd("Assets", "Amount (BDT)", "Liabilities & Equity", "Amount (BDT)")}<tbody>${two(finBsRows(R), tot("Total Assets", R.assets, "Total Liabilities & Equity", R.le))}</tbody></table></div>
  <div class="bg-white rounded-xl border p-4 mb-5 overflow-x-auto"><h3 class="font-bold mb-2">Total Payable Amount (Individual) <span class="text-xs font-normal text-slate-500">— ${fD(R.asOf)} পর্যন্ত</span></h3>
    <table class="w-full text-sm">${th(["SL", "MID", "Name", "Investment", "Addition*", "Deduction**", "Paid Out", "Total Payable"])}<tbody>${R.rows.map(x => `<tr class="${x.settledOn ? "bg-slate-50 text-slate-500" : ""}">${td(x.m.sl)}${td(x.m.mid)}${td(esc(finNm(x)))}${td(fN(x.inv), "text-right")}${td(fN(x.add), "text-right")}${td(fN(x.ded), "text-right")}${td(fN(x.payout), "text-right")}${td(fN(x.total), "text-right font-semibold")}</tr>`).join("")}
      <tr class="bg-slate-100 font-bold">${td("")}${td("")}${td("Total")}${td(fN(rs(x => x.inv)), "text-right")}${td(fN(rs(x => x.add)), "text-right")}${td(fN(rs(x => x.ded)), "text-right")}${td(fN(rs(x => x.payout)), "text-right")}${td(fN(rs(x => x.total)), "text-right")}</tr></tbody></table>
    <p class="text-xs text-slate-500 mt-2">${finNotes(R).map(esc).join("<br>")}</p></div>
  <div class="bg-white rounded-xl border p-4 mb-5 overflow-x-auto"><h3 class="font-bold mb-2">Subscription Receivable</h3>
    <table class="w-full text-sm">${th(["SL", "MID", "Name", "Receivable (Taka)", "Comment"])}<tbody>${R.rows.map(x => `<tr>${td(x.m.sl)}${td(x.m.mid)}${td(esc(finNm(x)))}${td(fN(x.recv), "text-right")}${td(esc(finComment(x, R.C)))}</tr>`).join("")}
      <tr class="bg-slate-100 font-bold">${td("")}${td("")}${td("Total")}${td(fN(R.recv), "text-right")}${td("")}</tr></tbody></table></div>
  <div class="bg-white rounded-xl border p-4 mb-5 overflow-x-auto"><h3 class="font-bold mb-2">Membership Fee</h3>
    <table class="w-full text-sm">${th(["SL", "MID", "Name", "Amount (Taka)"])}<tbody>${R.rows.map(x => `<tr>${td(x.m.sl)}${td(x.m.mid)}${td(esc(finNm(x)))}${td(fN(x.fee), "text-right")}</tr>`).join("")}
      <tr class="bg-slate-100 font-bold">${td("")}${td("")}${td("Total")}${td(fN(R.I.membership), "text-right")}</tr></tbody></table></div>
  ${ap ? finCancelPanel(R) + finTxPanel() : ""}`;
  if (ap) { finTypeChange(); if (finEditId) finFillForm(FTX.find(t => t.id === finEditId)); }
}

// ---------- সদস্যপদ বাতিল তালিকা (Admin/Admin (IT)) ----------
function finCancelPanel(R) {
  const rows = R.rows.filter(x => x.m.status !== "Active");
  if (!rows.length) return "";
  return `<div class="bg-white rounded-xl border p-4 mb-5 overflow-x-auto"><h3 class="font-bold mb-2">বাতিল সদস্য ও Final Settlement</h3>
    <table class="w-full text-xs"><thead class="bg-slate-100"><tr><th class="p-2 text-left">MID</th><th class="text-left">Name</th><th class="text-left">বাতিলের তারিখ</th><th class="text-right">বর্তমান পাওনা</th><th class="text-left">Settlement</th><th></th></tr></thead><tbody>
    ${rows.map(x => { const t = FTX.find(y => y.type === "payout" && y.mid === x.m.mid); return `<tr class="border-b"><td class="p-2 font-mono">${x.m.mid}</td><td>${esc(x.m.name)}</td><td>${x.cancelDate ? fD(x.cancelDate) : "<span class='text-amber-600'>তারিখ নেই</span>"}</td><td class="text-right">${fN(x.total)}</td>
      <td>${t ? `✓ ${fD(t.date)} · ${fN(t.amount)} · ${esc(t.method || "")} ${esc(t.ref || "")}` : "<span class='text-amber-600'>বাকি</span>"}</td>
      <td>${t ? "" : `<button class="text-blue-600 underline" onclick="finStartSettle('${x.m.mid}')">Settle</button>`}</td></tr>`; }).join("")}</tbody></table></div>`;
}
function finStartSettle(mid) {
  $("fin-type").value = "payout"; finTypeChange(); $("fin-mid").value = mid; finSettleAuto(); $("fin-date").scrollIntoView({ behavior: "smooth", block: "center" });
}
function finSettleAuto() {
  const mid = $("fin-mid").value, d = $("fin-date").value; if (!mid || !d) return;
  const R = finCompute(finAddDays(d, -1), "ALL", FTX.filter(t => !(t.type === "payout" && t.mid === mid)));
  const x = R.rows.find(r => r.m.mid === mid); if (x) $("fin-amount").value = Math.max(0, Math.round(x.total * 100) / 100);
}

// ---------- লেনদেন form (শুধু Admin / Admin (IT)) ----------
const finOpts = (list, sel) => list.map(a => `<option value="${a.key}" ${a.key === sel ? "selected" : ""}>${esc(a.name)}</option>`).join("");
function finTxPanel() {
  const C = finCutoff(), list = FTX.slice().sort((a, b) => b.date.localeCompare(a.date));
  const wd = MEMBERS.filter(m => m.status !== "Active" && !finSettleDate(m.mid));
  const accOpts = finPickable("ast").filter(a => a.key !== "recv"), allAcc = finAccounts().filter(a => a.active && !a.auto && !(a.kind === "inc" && a.key === "membership"));
  const detail = t => t.type === "payout" ? (finMember(t.mid)?.name || t.mid) : t.type === "expense" ? finName("exp:" + t.cat) : t.type === "income" ? finName("inc:" + t.cat) : (t.type === "invest" || t.type === "invest_return") ? finName("ast:" + t.cat) : t.type === "settle" ? finName("lia:" + (t.liab || "pay")) : t.type === "journal" ? "Journal" : "-";
  const jopts = allAcc.map(a => `<option value="${a.id}">${esc(a.name)} (${FIN_KIND[a.kind]})</option>`).join("");
  return `<div class="bg-white rounded-xl border p-4" id="fin-form"><h3 class="font-bold mb-1">লেনদেন যোগ করুন (Investment / Profit / খরচ / Liability / Final Settlement)</h3>
    <p id="fin-edit-note" class="hidden text-sm bg-amber-50 border border-amber-300 text-amber-800 rounded p-2 mb-2"></p>
    <div class="grid md:grid-cols-4 gap-3 items-end">
      <div><label class="lbl">তারিখ</label><input type="date" id="fin-date" min="${finAddDays(C, 1)}" max="${finToday()}" value="${finToday()}" class="inp" onchange="finTypeChange(true)"></div>
      <div><label class="lbl">ধরন</label><select id="fin-type" class="inp" onchange="finTypeChange()">${FIN_FORM_TYPES.map(k => `<option value="${k}">${FIN_TYPES[k]}</option>`).join("")}</select></div>
      <div id="fin-cat-wrap"><label class="lbl" id="fin-cat-label">খাত</label><select id="fin-cat" class="inp"></select></div>
      <div id="fin-liab-wrap" class="hidden"><label class="lbl">কোন Liability</label><select id="fin-liab" class="inp">${finOpts(finPickable("lia"), "pay")}</select></div>
      <div id="fin-mid-wrap" class="hidden"><label class="lbl">সদস্য (বাতিল, Settlement বাকি)</label><select id="fin-mid" class="inp" onchange="finSettleAuto()">${wd.map(m => `<option value="${m.mid}">${esc(m.name)} (${m.mid})</option>`).join("") || '<option value="">— কেউ নেই (আগে Admin (IT) থেকে সদস্যপদ বাতিল করুন) —</option>'}</select></div>
      <div id="fin-pm-wrap" class="hidden md:col-span-2 grid grid-cols-2 gap-3"><div><label class="lbl">Payment Method</label><select id="fin-method" class="inp">${S.methods.map(m => `<option>${esc(m)}</option>`).join("")}</select></div><div><label class="lbl">Payment Reference</label><input id="fin-ref" class="inp"></div></div>
      <div id="fin-jr-wrap" class="hidden md:col-span-2 grid grid-cols-2 gap-3"><div><label class="lbl">Debit (Dr)</label><select id="fin-dr" class="inp">${jopts}</select></div><div><label class="lbl">Credit (Cr)</label><select id="fin-cr" class="inp">${jopts}</select></div></div>
      <div><label class="lbl">Amount (BDT)</label><input type="number" id="fin-amount" min="0.01" step="0.01" class="inp"></div>
      <div id="fin-acc-wrap"><label class="lbl" id="fin-acc-label">কোন Assets থেকে</label><select id="fin-acc" class="inp">${finOpts(accOpts, "bank")}</select></div>
      <div class="md:col-span-2"><label class="lbl">মন্তব্য</label><input id="fin-note" class="inp"></div>
      <div class="md:col-span-2"><label class="lbl">Supporting Documents / সংযুক্ত ডকুমেন্ট</label><input type="file" id="fin-files" multiple accept="${FIN_ACCEPT}" class="inp"></div></div>
    <label id="fin-unpaid-wrap" class="text-sm hidden mt-2 block"><input type="checkbox" id="fin-unpaid" onchange="finTypeChange()"> এখনো পরিশোধ হয়নি (Liability-তে যাবে)</label>
    <p class="text-xs text-slate-500 mt-1">PDF, JPG, PNG, DOC(X), XLS(X) — সর্বোচ্চ ${FIN_MAX_FILES}টি, প্রতিটি 10 MB পর্যন্ত। ${fD(C)}-এর পরের তারিখ দিতে হবে (আগের লেনদেন Opening-এ আছে)।</p>
    <div class="mt-3 flex gap-2"><button id="fin-submit" onclick="finSubmit()" class="bg-emerald-600 text-white text-sm px-4 py-2 rounded-lg">+ যোগ করুন</button><button id="fin-cancel-edit" onclick="finCancelEdit()" class="hidden border text-sm px-4 py-2 rounded-lg">Edit বাতিল</button></div>
    <div class="overflow-x-auto mt-4"><table class="w-full text-xs"><thead class="bg-slate-100"><tr><th class="p-2 text-left">তারিখ</th><th class="text-left">ধরন</th><th class="text-left">খাত / সদস্য</th><th class="text-left">Journal (Dr → Cr)</th><th class="text-right">Amount</th><th class="text-left">মন্তব্য</th><th class="text-center">Docs</th><th></th></tr></thead>
    <tbody>${list.map(t => `<tr class="border-b ${t.id === finEditId ? "bg-amber-50" : ""}"><td class="p-2 whitespace-nowrap">${fD(t.date)}</td><td>${FIN_TYPES[t.type] || t.type}${t.unpaid ? " (বাকি)" : ""}</td><td>${esc(detail(t))}</td><td>${esc(finJournal(t))}</td><td class="text-right">${fN(t.amount)}</td><td>${esc(t.note || "")}${t.ref ? " · Ref: " + esc(t.ref) : ""}</td>
      <td class="text-center"><button class="text-blue-600 underline" onclick="finDocsOpen('${t.id}')">📎 ${(t.docs || []).length}</button></td>
      <td class="text-right whitespace-nowrap"><button class="text-sky-700 mr-2" onclick="finEdit('${t.id}')">Edit</button><button class="text-rose-600" onclick="finDelTx('${t.id}')">Delete</button></td></tr>`).join("") || `<tr><td colspan="8" class="p-3 text-center text-slate-500">এখনো কোনো লেনদেন নেই</td></tr>`}</tbody></table></div></div>`;
}
function finTypeChange(dateOnly) {
  const t = $("fin-type").value, set = (el, list, sel) => { el.innerHTML = finOpts(list, sel); };
  const show = (id, on) => $(id).classList.toggle("hidden", !on);
  if (dateOnly === true) { if (t === "payout") finSettleAuto(); return; }
  const inflow = ["income", "invest_return"].includes(t), unpaid = t === "expense" && $("fin-unpaid").checked;
  if (t === "income") set($("fin-cat"), finPickable("inc")); else if (t === "expense") set($("fin-cat"), finPickable("exp"));
  else if (t === "invest" || t === "invest_return") set($("fin-cat"), finPickable("ast").filter(a => a.key !== "recv" && a.key !== "bank" && a.key !== "hand"));
  $("fin-cat-label").textContent = { income: "আয়ের খাত", expense: "খরচের খাত", invest: "কোথায় Invest / কোন Asset", invest_return: "কোন Investment থেকে ফেরত" }[t] || "খাত";
  $("fin-acc-label").textContent = inflow ? "কোন Assets-এ জমা হবে" : "কোন Assets থেকে পরিশোধ";
  show("fin-cat-wrap", ["income", "expense", "invest", "invest_return"].includes(t));
  show("fin-liab-wrap", t === "settle" || unpaid); show("fin-mid-wrap", t === "payout"); show("fin-pm-wrap", t === "payout"); show("fin-jr-wrap", t === "journal");
  show("fin-unpaid-wrap", t === "expense"); show("fin-acc-wrap", !unpaid && t !== "journal");
  const keep = $("fin-acc").value || "bank";
  $("fin-acc").innerHTML = finOpts(finPickable("ast").filter(a => a.key !== "recv"), keep);
  if (t === "payout") finSettleAuto();
}

// ---------- Validation / Save ----------
function finValidate(list) {
  const last = list.reduce((m, t) => t.date > m ? t.date : m, finToday());
  for (const asOf of [last]) {
    const R = finCompute(asOf, "ALL", list);
    for (const a of finAccounts()) {
      const v = R.B[a.id]; if (v === undefined || a.kind === "eqt") continue;
      if (a.kind === "ast" && v < -0.005) return `${a.name}-এ যথেষ্ট টাকা নেই (ঘাটতি ${fN(-v)})`;
      if (a.kind === "lia" && v < -0.005) return `${a.name}-এর বকেয়ার চেয়ে বেশি পরিশোধ করা যাবে না (অতিরিক্ত ${fN(-v)})`;
    }
    if (Math.abs(R.diff) > 0.005) return "Assets = Liabilities + Equity মিলছে না (পার্থক্য " + fN(R.diff) + ") — লেনদেন সেভ করা হয়নি";
    const bad = R.rows.find(x => x.settledOn && Math.abs(x.total) > 0.01);
    if (bad) return `${bad.m.name}-এর Final Settlement সম্পূর্ণ পাওনার সমান হতে হবে (Settlement-এর আগের পাওনা ${fN(bad.total + bad.payout)}, দেওয়া ${fN(bad.payout)}). আংশিক বা ভিন্ন পরিমাণের নিয়ম এখনো নিশ্চিত নয় — পুরো পরিমাণই দিন।`;
    const neg = R.rows.find(x => x.total < -0.01 && !x.settledOn);
    if (neg) return `${neg.m.name}-এর পাওনার চেয়ে বেশি দেওয়া যাবে না`;
  }
  return "";
}
function finRead() {
  const t = { type: $("fin-type").value, date: $("fin-date").value, amount: Math.round(Number($("fin-amount").value) * 100) / 100, note: $("fin-note").value.trim() };
  if (["income", "expense", "invest", "invest_return"].includes(t.type)) t.cat = $("fin-cat").value;
  if (t.type === "expense") { t.unpaid = $("fin-unpaid").checked; if (t.unpaid) t.liab = $("fin-liab").value; }
  if (t.type === "settle") t.liab = $("fin-liab").value;
  if (t.type === "journal") { t.dr = $("fin-dr").value; t.cr = $("fin-cr").value; }
  else if (!t.unpaid) t.acc = $("fin-acc").value || "bank";
  if (t.type === "payout") { t.mid = $("fin-mid").value; t.method = $("fin-method").value; t.ref = $("fin-ref").value.trim(); }
  return t;
}
function finFillForm(t) {
  if (!t) return;
  $("fin-type").value = t.type; finTypeChange(); $("fin-date").value = t.date; $("fin-amount").value = t.amount; $("fin-note").value = t.note || "";
  if (t.cat) $("fin-cat").value = t.cat; if (t.liab) $("fin-liab").value = t.liab; if (t.acc) $("fin-acc").value = t.acc;
  if (t.type === "expense") { $("fin-unpaid").checked = !!t.unpaid; finTypeChange(); if (t.liab) $("fin-liab").value = t.liab; }
  if (t.type === "journal") { $("fin-dr").value = t.dr; $("fin-cr").value = t.cr; }
  if (t.type === "payout") { if (![...$("fin-mid").options].some(o => o.value === t.mid)) $("fin-mid").insertAdjacentHTML("beforeend", `<option value="${t.mid}">${esc(finMember(t.mid)?.name || t.mid)}</option>`); $("fin-mid").value = t.mid; $("fin-method").value = t.method || ""; $("fin-ref").value = t.ref || ""; }
  $("fin-edit-note").textContent = "✏ Edit মোড — লেনদেন সংশোধন হলে আগের মান ইতিহাসে (history) জমা থাকবে। নতুন ফাইল যোগ করলে আগেরগুলো থাকবে।"; $("fin-edit-note").classList.remove("hidden");
  $("fin-submit").textContent = "Update করুন"; $("fin-cancel-edit").classList.remove("hidden");
}
function finEdit(id) { if (!isApprover()) return; finEditId = id; renderFinance(); $("fin-form").scrollIntoView({ behavior: "smooth" }); }
function finCancelEdit() { finEditId = null; renderFinance(); }
const finSig = t => [t.date, t.type, t.amount, t.acc, t.cat, t.liab, t.mid, t.dr, t.cr, t.note].join("|");
function finCheckFiles(files) {
  if (files.length > FIN_MAX_FILES) return `একসাথে সর্বোচ্চ ${FIN_MAX_FILES}টি ফাইল`;
  for (const f of files) { if (!FIN_FILE_RE.test(f.name)) return `"${f.name}" — অনুমোদিত নয় (PDF, JPG, PNG, DOC, DOCX, XLS, XLSX)`; if (f.size > FIN_MAX_FILE) return `"${f.name}" — 10 MB-এর বেশি`; if (!f.size) return `"${f.name}" — ফাইল ফাঁকা`; }
  return "";
}
async function finUploadFiles(txId, files) {
  if (!files.length) return [];
  if (!window.DB || !DB.upload) throw new Error("Storage চালু নেই — db.js আপডেট করুন");
  const out = [];
  try {
    for (const f of files) {
      const path = `${txId}/${Date.now()}_${out.length}_${f.name.replace(/[^\w.\-]+/g, "_")}`;
      await DB.upload(path, f);
      out.push({ name: f.name, path, size: f.size, type: f.type, by: session.mid || session.role, at: new Date().toISOString() });
    }
  } catch (e) { await DB.removeFiles(out.map(d => d.path)).catch(() => {}); throw e; }
  return out;
}
async function finSubmit() {
  if (!isApprover() || finBusy) return;
  const t = finRead(), files = [...$("fin-files").files];
  if (!t.date || t.date <= finCutoff()) return toast(fD(finCutoff()) + "-এর পরের তারিখ দিন");
  if (t.date > finToday()) return toast("ভবিষ্যতের তারিখ দেওয়া যাবে না");
  if (!(t.amount > 0)) return toast("সঠিক Amount দিন");
  if (t.type === "payout") { if (!t.mid) return toast("আগে Admin (IT) পেজ থেকে সদস্যের সদস্যপদ বাতিল করুন"); const m = finMember(t.mid); if (m.cancelDate && t.date < m.cancelDate) return toast("Settlement-এর তারিখ বাতিলের তারিখ (" + fD(m.cancelDate) + ") এর আগে হতে পারে না"); if (FTX.some(x => x.type === "payout" && x.mid === t.mid && x.id !== finEditId)) return toast("এই সদস্যের Final Settlement আগেই হয়েছে"); }
  if (t.type === "journal" && t.dr === t.cr) return toast("Debit ও Credit আলাদা Account হতে হবে");
  const fe = finCheckFiles(files); if (fe) return toast(fe);
  const prev = finEditId ? FTX.find(x => x.id === finEditId) : null;
  if (prev && (prev.docs || []).length + files.length > FIN_MAX_FILES) return toast("মোট ফাইল " + FIN_MAX_FILES + "টির বেশি হবে");
  if (FTX.some(x => x.id !== finEditId && finSig(x) === finSig(t)) && !confirm("একই তারিখ, ধরন ও Amount-এর লেনদেন আগেই আছে। তবুও যোগ করবেন?")) return;
  finBusy = true; $("fin-submit").disabled = true; $("fin-submit").textContent = "সেভ হচ্ছে...";
  let up = [];
  try {
    const id = prev ? prev.id : finId();
    up = await finUploadFiles(id, files);
    const nt = { ...t, id, docs: [...((prev && prev.docs) || []), ...up], by: prev ? prev.by : (session.mid || session.role), at: prev ? prev.at : new Date().toISOString() };
    if (prev) { nt.history = [...(prev.history || []), { at: new Date().toISOString(), by: session.mid || session.role, before: Object.fromEntries(Object.entries(prev).filter(([k]) => !["docs", "history"].includes(k))) }]; nt.updatedBy = session.mid || session.role; }
    const list = prev ? FTX.map(x => x.id === id ? nt : x) : [...FTX, nt];
    const err = finValidate(list);
    if (err) { if (up.length) await DB.removeFiles(up.map(d => d.path)).catch(() => {}); return toast(err); }
    FTX = list; saveTx(); finEditId = null; renderFinance(); toast(prev ? "লেনদেন সংশোধিত হয়েছে" : "লেনদেন যোগ হয়েছে — Financial Statement হালনাগাদ হয়েছে");
  } catch (e) { console.error(e); toast("সেভ হয়নি: " + (e.message || e)); }
  finally { finBusy = false; const b = $("fin-submit"); if (b) { b.disabled = false; b.textContent = finEditId ? "Update করুন" : "+ যোগ করুন"; } }
}
async function finDelTx(id) {
  if (!isApprover()) return;
  const t = FTX.find(x => x.id === id); if (!t) return;
  const list = FTX.filter(x => x.id !== id), err = finValidate(list);
  if (err) return toast("মুছলে হিসাব ভেঙে যাবে: " + err);
  if (!confirm("এই লেনদেন" + ((t.docs || []).length ? " ও এর " + t.docs.length + "টি সংযুক্ত ডকুমেন্ট" : "") + " মুছবেন?")) return;
  try { if ((t.docs || []).length) await DB.removeFiles(t.docs.map(d => d.path)); } catch (e) { if (!confirm("ডকুমেন্ট মোছা যায়নি (" + e.message + "). তবুও লেনদেন মুছবেন?")) return; }
  FTX = list; if (finEditId === id) finEditId = null; saveTx(); renderFinance(); toast("লেনদেন মোছা হয়েছে");
}

// ---------- Supporting documents modal ----------
function finDocsOpen(id) {
  if (!isApprover()) return;
  let m = $("fin-docs-modal");
  if (!m) { m = document.createElement("div"); m.id = "fin-docs-modal"; m.className = "fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"; document.body.appendChild(m); }
  m.dataset.id = id; finDocsRender();
}
function finDocsRender() {
  const m = $("fin-docs-modal"), t = m && FTX.find(x => x.id === m.dataset.id); if (!t) return;
  m.innerHTML = `<div class="bg-white rounded-xl max-w-xl w-full p-5 max-h-[90vh] overflow-y-auto"><div class="flex justify-between mb-3"><h3 class="font-bold text-sm">Supporting Documents — ${fD(t.date)} · ${FIN_TYPES[t.type] || t.type} · ${fN(t.amount)}</h3><button onclick="$('fin-docs-modal').remove()" class="text-xl font-bold">&times;</button></div>
    <table class="w-full text-xs mb-3">${(t.docs || []).map((d, i) => `<tr class="border-b"><td class="py-2">${esc(d.name)}<div class="text-slate-400">${(d.size / 1024).toFixed(0)} KB · ${esc(d.by || "")} · ${new Date(d.at).toLocaleString("en-GB")}</div></td>
      <td class="text-right whitespace-nowrap"><button class="text-blue-600 mr-2" onclick="finDocOpen('${t.id}',${i},false)">View</button><button class="text-emerald-700 mr-2" onclick="finDocOpen('${t.id}',${i},true)">Download</button><button class="text-rose-600" onclick="finDocRemove('${t.id}',${i})">Remove</button></td></tr>`).join("") || '<tr><td class="py-3 text-slate-500">কোনো ডকুমেন্ট নেই</td></tr>'}</table>
    <div class="flex gap-2"><input type="file" id="fin-docs-add" multiple accept="${FIN_ACCEPT}" class="border rounded p-1 text-xs flex-1"><button onclick="finDocsAdd('${t.id}')" class="bg-emerald-600 text-white text-xs px-3 rounded">Upload</button></div></div>`;
}
async function finDocOpen(id, i, dl) {
  if (!isApprover()) return;
  const d = FTX.find(x => x.id === id).docs[i];
  try { const url = await DB.signedUrl(d.path, d.name, dl); const a = document.createElement("a"); a.href = url; a.target = "_blank"; a.rel = "noopener"; document.body.appendChild(a); a.click(); a.remove(); }
  catch (e) { toast("ডকুমেন্ট খোলা যায়নি: " + e.message); }
}
async function finDocsAdd(id) {
  if (!isApprover() || finBusy) return;
  const t = FTX.find(x => x.id === id), files = [...$("fin-docs-add").files]; if (!files.length) return toast("ফাইল বাছুন");
  const fe = finCheckFiles(files) || ((t.docs || []).length + files.length > FIN_MAX_FILES ? "মোট ফাইল " + FIN_MAX_FILES + "টির বেশি হবে" : ""); if (fe) return toast(fe);
  finBusy = true;
  try { const up = await finUploadFiles(id, files); t.docs = [...(t.docs || []), ...up]; saveTx(); finDocsRender(); renderFinance(); toast(up.length + "টি ডকুমেন্ট যোগ হয়েছে"); }
  catch (e) { toast("Upload হয়নি: " + e.message); } finally { finBusy = false; }
}
async function finDocRemove(id, i) {
  if (!isApprover()) return;
  const t = FTX.find(x => x.id === id), d = t.docs[i]; if (!confirm('"' + d.name + '" মুছবেন?')) return;
  try { await DB.removeFiles([d.path]); } catch (e) { return toast("মোছা যায়নি: " + e.message); }
  t.docs.splice(i, 1); saveTx(); finDocsRender(); renderFinance();
}

// ---------- Admin (IT): Financial Statement Configuration ----------
function finCfgSet(id, field, val) {
  if (!isAdmin()) return;
  const [kind, key] = id.split(":"), cur = finAccounts().find(a => a.id === id); if (!cur) return;
  if (field === "name") {
    val = String(val).trim();
    if (!val) { toast("নাম ফাঁকা রাখা যাবে না"); return renderFinConfig(); }
    if (finAcc(kind).some(a => a.id !== id && a.name.toLowerCase() === val.toLowerCase())) { toast("এই নামে আগেই একটি item আছে"); return renderFinConfig(); }
    if (finUsed(id) && !confirm(`"${cur.name}" → "${val}" নাম বদলাবে। আগের সব লেনদেন একই Account-এই থাকবে, শুধু নাম বদলাবে। নিশ্চিত?`)) return renderFinConfig();
  }
  if (field === "active") {
    if (cur.auto) { toast("এটি সিস্টেমের স্বয়ংক্রিয় Account — নিষ্ক্রিয় করা যাবে না"); return renderFinConfig(); }
    if (!val && !confirm(`"${cur.name}" নিষ্ক্রিয় হলে নতুন লেনদেনে পাওয়া যাবে না (ইতিহাস ও রিপোর্টে থাকবে)। নিশ্চিত?`)) return renderFinConfig();
  }
  if (field === "order") val = Number(val) || 0;
  let o = FCFG.accounts.find(a => a.kind === kind && a.key === key); if (!o) { o = { kind, key }; FCFG.accounts.push(o); }
  o[field] = val; saveCfg(); renderFinConfig(); if ($("page-financial") && !$("page-financial").classList.contains("hidden")) renderFinance();
}
function finCfgAdd() {
  if (!isAdmin()) return;
  const kind = $("fc-kind").value, name = $("fc-name").value.trim(), desc = $("fc-desc").value.trim();
  if (!name) return toast("নাম দিন");
  if (finAcc(kind).some(a => a.name.toLowerCase() === name.toLowerCase())) return toast("এই নামে আগেই একটি item আছে");
  if (!confirm(`নতুন ${FIN_KIND[kind]} item "${name}" যোগ করবেন?`)) return;
  const max = Math.max(0, ...finAcc(kind).map(a => a.order));
  FCFG.accounts.push({ kind, key: "c" + Date.now().toString(36), name, desc, active: true, order: max + 10, custom: true }); saveCfg(); renderFinConfig(); toast("Item যোগ হয়েছে");
}
function finCfgDel(id) {
  if (!isAdmin()) return;
  const a = finAccounts().find(x => x.id === id); if (!a || a.sys) return;
  if (finUsed(id)) return toast("এই Account-এ লেনদেন আছে — মোছা যাবে না (নিষ্ক্রিয় করুন)");
  if (!confirm(`"${a.name}" মুছবেন?`)) return;
  FCFG.accounts = FCFG.accounts.filter(x => !(x.kind === a.kind && x.key === a.key)); saveCfg(); renderFinConfig();
}
function renderFinConfig() {
  const box = $("admin-fincfg"); if (!box || !isAdmin()) return;
  const inp = (id, f, v, w) => `<input class="border rounded p-1 ${w}" value="${esc(v)}" onchange="finCfgSet('${id}','${f}',this.value)">`;
  box.innerHTML = ["inc", "exp", "ast", "eqt", "lia"].map(k => `<p class="text-sm font-semibold mt-3 mb-1">${FIN_KIND[k]}</p><div class="overflow-x-auto border rounded-lg"><table class="w-full text-xs"><thead class="bg-slate-100"><tr><th class="p-2 text-left">ক্রম</th><th class="text-left">নাম</th><th class="text-left">বিবরণ</th><th>Active</th><th></th></tr></thead><tbody>
    ${finAcc(k).map(a => `<tr class="border-b"><td class="p-2"><input type="number" class="border rounded p-1 w-16" value="${a.order}" onchange="finCfgSet('${a.id}','order',this.value)"></td><td>${inp(a.id, "name", a.name, "w-64")}${a.auto ? ' <span class="chip bg-slate-200 text-slate-600">auto</span>' : a.sys ? ' <span class="chip bg-sky-100 text-sky-700">system</span>' : ""}</td><td>${inp(a.id, "desc", a.desc || "", "w-64")}</td>
      <td class="text-center"><input type="checkbox" ${a.active ? "checked" : ""} ${a.auto ? "disabled" : ""} onchange="finCfgSet('${a.id}','active',this.checked)"></td>
      <td>${a.sys ? "" : `<button class="text-rose-600" onclick="finCfgDel('${a.id}')">Delete</button>`}</td></tr>`).join("")}</tbody></table></div>`).join("") +
    `<div class="border rounded-xl p-3 bg-slate-50 mt-4"><p class="font-semibold text-sm mb-2">নতুন Item যোগ</p><div class="grid md:grid-cols-4 gap-3 items-end">
      <div><label class="lbl">ধরন</label><select id="fc-kind" class="inp">${Object.entries(FIN_KIND).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div>
      <div><label class="lbl">নাম</label><input id="fc-name" class="inp"></div><div><label class="lbl">বিবরণ</label><input id="fc-desc" class="inp"></div>
      <button onclick="finCfgAdd()" class="bg-emerald-600 text-white text-sm px-4 py-2 rounded-lg">+ যোগ করুন</button></div></div>`;
}

// ---------- Excel ----------
function finTxRows() {
  return [["ID", "Date", "Type", "Category / Member", "Debit", "Credit", "Amount", "Method", "Reference", "Note", "Documents", "Added By"],
    ...FTX.slice().sort((a, b) => a.date.localeCompare(b.date)).map(t => [t.id, t.date, FIN_TYPES[t.type] || t.type, t.type === "payout" ? (finMember(t.mid)?.name || t.mid) : (t.cat ? finName((t.type === "income" ? "inc:" : t.type === "expense" ? "exp:" : "ast:") + t.cat) : ""),
      t.type === "payout" ? "Member Capital Equity / Retained Earnings" : finEntries(t).map(e => finName(e.dr)).join("; "), t.type === "payout" ? finName("ast:" + (t.acc || "bank")) : finEntries(t).map(e => finName(e.cr)).join("; "),
      t.amount, t.method || "", t.ref || "", t.note || "", (t.docs || []).map(d => d.name).join("; "), t.by || ""])];
}
function finExcel() {
  if (!finCanDownload()) return toast("শুধু Admin / Admin (IT) download করতে পারবেন");
  const R = finView(), wb = XLSX.utils.book_new(), add = (name, aoa, w) => { const ws = XLSX.utils.aoa_to_sheet(aoa); ws["!cols"] = w.map(x => ({ wch: x })); XLSX.utils.book_append_sheet(wb, ws, name); };
  const lab = finFY === "ALL" ? "All (Inception to Date)" : "FY " + finFY;
  add("Financial Statement", [["Financial Statement — " + lab], ["Statement of Income and Expenditure"], [fD(R.pS) + " – " + fD(R.pEnd)], [], ["Revenue / Inflows", "Amount (BDT)", "Operating Expenses / Outflows", "Amount (BDT)"], ...finIncRows(R),
    ["Total Income", R.pTotInc, "Total Expenses", R.pTotExp], ["Balance", R.pBal], [], ["Statement of Financial Position (Balance Sheet) — cumulative"], ["As of " + fD(R.asOf)], [],
    ["Assets", "Amount (BDT)", "Liabilities & Equity", "Amount (BDT)"], ...finBsRows(R), ["Total Assets", R.assets, "Total Liabilities & Equity", R.le]], [38, 16, 42, 16]);
  add("Total Payable Amount", [["Total Payable Amount (Individual)"], ["Date: " + fD(R.asOf)], [], ["SL NO.", "MID", "Name", "Investment Amount (Taka)", "Addition (Profit, Bank Interest, Etc)*", "Deduction (Membership fee, Cost Etc)**", "Paid Out (Settlement)", "Total Payable Amount"],
    ...R.rows.map(x => [x.m.sl, x.m.mid, finNm(x), x.inv, x.add, x.ded, x.payout, x.total]), ["", "", "Total", ...[x => x.inv, x => x.add, x => x.ded, x => x.payout, x => x.total].map(f => R.rows.reduce((s, x) => s + f(x), 0))], [], ...finNotes(R).map(n => [n])], [8, 12, 34, 22, 22, 22, 18, 20]);
  add("Subscription Receivable", [["Subscription Receivable"], ["Date: " + fD(R.asOf)], [], ["SL NO.", "MID", "Name", "Amount (Taka)", "Comment"], ...R.rows.map(x => [x.m.sl, x.m.mid, finNm(x), x.recv, finComment(x, R.C)]), ["", "", "Total", R.recv]], [8, 12, 34, 16, 60]);
  add("Membership Fee", [["Membership Fee"], ["Date: " + fD(R.asOf)], [], ["SL NO.", "MID", "Name", "Amount (Taka)"], ...R.rows.map(x => [x.m.sl, x.m.mid, finNm(x), x.fee]), ["", "", "Total", R.I.membership]], [8, 12, 34, 16]);
  if (isApprover()) add("Transactions", finTxRows(), [38, 12, 34, 34, 34, 34, 14, 18, 18, 30, 40, 14]);
  XLSX.writeFile(wb, `PGCS-21_Financial_Statement_${finFY}_${R.asOf}.xlsx`); toast("Financial Statement Excel downloaded");
}

// ---------- PDF ----------
function finPDF() {
  if (!finCanDownload()) return toast("শুধু Admin / Admin (IT) download করতে পারবেন");
  const R = finView(), doc = new jsPDF(), f = fN;
  const bold = (a, b, c, d) => [{ content: a, styles: { fontStyle: "bold" } }, { content: f(b), styles: { fontStyle: "bold", halign: "right" } }, { content: c, styles: { fontStyle: "bold" } }, { content: d === null ? "" : f(d), styles: { fontStyle: "bold", halign: "right" } }];
  const body2 = rows => rows.map(r => [r[0], { content: r[1] === null ? "" : f(r[1]), styles: { halign: "right" } }, r[2], { content: r[3] === null ? "" : f(r[3]), styles: { halign: "right" } }]);
  const colL = { 0: { halign: "left" }, 2: { halign: "left" } };
  let y = pdfHead(doc, "Financial Statement" + (finFY === "ALL" ? " — All (Inception to Date)" : " — FY " + finFY));
  doc.setFontSize(10); doc.text("Statement of Income and Expenditure — " + fD(R.pS) + " – " + fD(R.pEnd), 14, y - 4);
  safeTable(doc, { ...tblStyle, startY: y, head: [["Revenue / Inflows", "Amount (BDT)", "Operating Expenses / Outflows", "Amount (BDT)"]], columnStyles: colL,
    body: [...body2(finIncRows(R)), bold("Total Income", R.pTotInc, "Total Expenses", R.pTotExp), bold("Balance", R.pBal, "", null)] });
  y = doc.lastAutoTable.finalY + 10; doc.setFontSize(10); doc.setFont("helvetica", "bold"); doc.text("Statement of Financial Position (Balance Sheet) — As of " + fD(R.asOf) + " (cumulative)", 14, y - 3);
  safeTable(doc, { ...tblStyle, startY: y, head: [["Assets", "Amount (BDT)", "Liabilities & Equity", "Amount (BDT)"]], columnStyles: colL,
    body: [...body2(finBsRows(R)), bold("Total Assets", R.assets, "Total Liabilities & Equity", R.le)] });
  signBlock(doc);
  const page = (title, sub) => { doc.addPage(); const y0 = pdfHead(doc, title); doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.text(sub, 14, y0 - 4); return y0; };
  const tb = (y0, head, body, cs) => safeTable(doc, { ...tblStyle, startY: y0, head: [head], body, columnStyles: cs });
  const tr = { halign: "right" }, tot = (c, ...v) => [{ content: "", styles: {} }, "", { content: c, styles: { fontStyle: "bold" } }, ...v.map(x => ({ content: x, styles: { fontStyle: "bold", halign: "right" } }))];
  const sum = g => f(R.rows.reduce((s, x) => s + g(x), 0));
  let y1 = page("Total Payable Amount (Individual)", "Date: " + fD(R.asOf));
  tb(y1, ["SL", "MID", "Name", "Investment", "Addition*", "Deduction**", "Paid Out", "Total Payable"], [...R.rows.map(x => [x.m.sl, x.m.mid, finNm(x), f(x.inv), f(x.add), f(x.ded), f(x.payout), f(x.total)]), tot("Total", sum(x => x.inv), sum(x => x.add), sum(x => x.ded), sum(x => x.payout), sum(x => x.total))],
    { 2: { halign: "left" }, 3: tr, 4: tr, 5: tr, 6: tr, 7: tr });
  doc.setFontSize(8); doc.setFont("helvetica", "normal"); finNotes(R).forEach((n, k) => doc.text(doc.splitTextToSize(n, 180), 14, doc.lastAutoTable.finalY + 6 + k * 8)); signBlock(doc);
  let y2 = page("Subscription Receivable", "Date: " + fD(R.asOf));
  tb(y2, ["SL NO.", "MID", "Name", "Amount (Taka)", "Comment"], [...R.rows.map(x => [x.m.sl, x.m.mid, finNm(x), f(x.recv), finComment(x, R.C)]), tot("Total", f(R.recv), "")],
    { 2: { halign: "left" }, 3: tr, 4: { halign: "left", cellWidth: 62 } }); signBlock(doc);
  let y3 = page("Membership Fee", "Date: " + fD(R.asOf));
  tb(y3, ["SL NO.", "MID", "Name", "Amount (Taka)"], [...R.rows.map(x => [x.m.sl, x.m.mid, finNm(x), f(x.fee)]), tot("Total", f(R.I.membership))], { 2: { halign: "left" }, 3: tr }); signBlock(doc);
  doc.save(`PGCS-21_Financial_Statement_${finFY}_${R.asOf}.pdf`); toast("Financial Statement PDF downloaded");
}
