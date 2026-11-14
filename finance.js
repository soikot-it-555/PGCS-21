// ===== Financial Statement (auto-updating) =====
// Opening balances = Financial_Statement.xlsx (09 August 2026). এর পরের সব Approved payment ও Admin-এর entry থেকে হিসাব নিজে থেকে হালনাগাদ হয়।
const FIN_MEMBER_DOWNLOAD = false;   // true দিলে সাধারণ সদস্যরাও PDF/Excel নামাতে পারবে
const FIN_OPEN = { cutoff: "2026-08-09", cash: 479452.45, invest: 105917, hand: 0, land: 0, capital: 612000, retained: 21269.45, payable: 5100,
  inc: { membership: 17000, profit: 0, interest: 11407.73, misc: 0 }, exp: { ops: 0, bank: 2038.28, admin: 5100, contingency: 0 } };
const FIN_MEM = {"PGCS-2101": {"inv": 35000, "fee": 1000, "due": 2000, "note": "July/26 Payment Due (2000/-)"}, "PGCS-2102": {"inv": 35000, "fee": 1000, "due": 2000, "note": "July/26 Payment Due (2000/-)"}, "PGCS-2103": {"inv": 31000, "fee": 1000, "due": 6000, "note": "May/26, June/26 & July/26 Payment Due (6000/-)"}, "PGCS-2104": {"inv": 35000, "fee": 1000, "due": 2000, "note": "July/26 Payment Due (2000/-)"}, "PGCS-2105": {"inv": 37000, "fee": 1000, "due": 0, "note": ""}, "PGCS-2106": {"inv": 29000, "fee": 1000, "due": 8000, "note": "April/26, May/26, June/26 & July/26 Payment Due (8000/-)"}, "PGCS-2107": {"inv": 37000, "fee": 1000, "due": 0, "note": ""}, "PGCS-2108": {"inv": 29000, "fee": 1000, "due": 8000, "note": "April/26, May/26, June/26 & July/26 Payment Due (8000/-)"}, "PGCS-2109": {"inv": 31000, "fee": 1000, "due": 6000, "note": "May/26, June/26 & July/26 Payment Due (6000/-)"}, "PGCS-2110": {"inv": 34000, "fee": 1000, "due": 3000, "note": "April/26 & July/26(1/2) Payment Due (3000/-)"}, "PGCS-2111": {"inv": 37000, "fee": 1000, "due": 0, "note": ""}, "PGCS-2112": {"inv": 35000, "fee": 1000, "due": 2000, "note": "July/26 Payment Due (2000/-)"}, "PGCS-2113": {"inv": 31000, "fee": 1000, "due": 6000, "note": "May/26, June/26 & July/26 Payment Due (6000/-)"}, "PGCS-2114": {"inv": 33000, "fee": 1000, "due": 4000, "note": "June/26 & July/26 Payment Due (4000/-)"}, "PGCS-2115": {"inv": 37000, "fee": 1000, "due": 0, "note": ""}, "PGCS-2116": {"inv": 35000, "fee": 1000, "due": 2000, "note": "July/26 Payment Due (2000/-)"}, "PGCS-2117": {"inv": 35000, "fee": 1000, "due": 2000, "note": "July/26 Payment Due (2000/-)"}};
const FIN_TYPES = { invest: "নতুন Investment (Cash → Investment)", invest_return: "Investment ফেরত (Principal)", profit: "Business Profit / Return", interest: "Bank Interest", misc: "Miscellaneous Income", expense: "খরচ (Expense)", settle: "Payable পরিশোধ" };
const FIN_EXP = { ops: "Business Operations & Management", bank: "Bank Charges, Tax, Vat & Digital Fees", admin: "Administrative & Legal Expenses", contingency: "Contingency & Maintenance" };
const FIN_ASSET = { inv: "Short-term Business Investments", land: "Land/Plot Advance & Acquisition" };
const fN = n => Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fD = iso => iso.split("-").reverse().join("-");
const finToday = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const finCutoff = () => S.finCutoff || FIN_OPEN.cutoff;
const finTx = () => (S.fin && S.fin.tx) || [];
let finAsOf = null;
const finCanDownload = () => isApprover() || FIN_MEMBER_DOWNLOAD;

function finCompute(asOf) {
  const O = FIN_OPEN, C = finCutoff(), inc = { ...O.inc }, exp = { ...O.exp };
  let cash = O.cash, inv = O.invest, land = O.land, cap = O.capital, ret = O.retained, pay = O.payable;
  const mem = {}; MEMBERS.forEach(m => { const o = FIN_MEM[m.mid] || {}; mem[m.mid] = { m, inv: o.inv || 0, fee: o.fee || 0, openDue: o.due || 0, note: o.note || "", oldPaid: 0, newDue: 0 }; });
  const instOf = p => (YEARS[p.fy] || []).find(i => i.key === p.inst);
  payments.filter(p => p.status === "Approved" && p.date && p.date <= asOf && mem[p.mid]).forEach(p => {
    const x = mem[p.mid], a = p.amount;
    if (p.inst === "Membership Fee") { if (p.date > C) { inc.membership += a; cash += a; ret += a; x.fee += a; x.inv += a; } return; }
    const i = instOf(p), old = p.fy === "2025-26" || (i && i.due <= C);
    if (old) { if (p.date <= C) return; x.oldPaid += a; cash += a; x.inv += a; }
    else { cash += a; cap += a; x.inv += a; }
  });
  for (const fy in YEARS) YEARS[fy].forEach(i => {
    if (i.key === "Membership Fee" || i.due <= C || i.due > asOf) return;
    MEMBERS.forEach(m => { if (m.status !== "Active") return;
      const paid = payments.filter(p => p.fy === fy && p.mid === m.mid && p.inst === i.key && p.status === "Approved" && p.date <= asOf).reduce((s, p) => s + p.amount, 0);
      const u = Math.max(0, i.amount - paid); mem[m.mid].newDue += u; cap += u; });
  });
  let recv = 0;
  Object.values(mem).forEach(x => { const applied = Math.min(x.oldPaid, x.openDue); cap += x.oldPaid - applied; x.recv = x.openDue - applied + x.newDue; x.applied = applied; recv += x.recv; });
  finTx().filter(t => t.date > C && t.date <= asOf).forEach(t => { const a = t.amount;
    if (t.type === "invest") { cash -= a; t.cat === "land" ? land += a : inv += a; }
    else if (t.type === "invest_return") { cash += a; t.cat === "land" ? land -= a : inv -= a; }
    else if (["profit", "interest", "misc"].includes(t.type)) { cash += a; ret += a; inc[t.type] += a; }
    else if (t.type === "expense") { ret -= a; exp[t.cat] += a; if (t.unpaid) pay += a; else cash -= a; }
    else if (t.type === "settle") { cash -= a; pay -= a; } });
  const N = MEMBERS.length, totInc = Object.values(inc).reduce((s, v) => s + v, 0), totExp = Object.values(exp).reduce((s, v) => s + v, 0);
  const assets = cash + inv + O.hand + land + recv, le = cap + ret + pay, other = inc.profit + inc.interest + inc.misc;
  const rows = Object.values(mem).map(x => { const add = other / N, ded = (inc.membership + totExp) / N; return { ...x, add, ded, total: x.inv + add - ded }; });
  return { asOf, C, inc, exp, totInc, totExp, bal: totInc - totExp, cash, inv, land, hand: O.hand, recv, cap, ret, pay, assets, le, other, N, rows, diff: Math.round((assets - le) * 100) / 100 };
}

function finIncRows(R) { return [["Membership Fee", R.inc.membership, FIN_EXP.ops, R.exp.ops], ["Business Investment Returns / Profit", R.inc.profit, FIN_EXP.bank, R.exp.bank], ["Bank Interest", R.inc.interest, FIN_EXP.admin, R.exp.admin], ["Miscellaneous Income", R.inc.misc, FIN_EXP.contingency, R.exp.contingency]]; }
function finBsRows(R) { return [["Cash at Bank", R.cash, "Member Capital Equity", R.cap], ["Short-term Business Investments", R.inv, "Retained Earnings/Surplus", R.ret], ["Cash in Hand", R.hand, "Accounts Payable / Accrued Expenses", R.pay], ["Monthly Subscriptions Receivable", R.recv, "", null], ["Land/Plot Advance & Acquisition", R.land, "", null]]; }
const finNotes = R => [`* Addition: Profit + Bank Interest + Misc (${fN(R.other)}/${R.N}) = ${fN(R.other / R.N)}`, `**Deduction: Membership fee + Expenses = (${fN(R.inc.membership)}+${fN(R.totExp)})/${R.N} = ${fN((R.inc.membership + R.totExp) / R.N)}`];
const finComment = (x, C) => [x.recv - x.newDue > 0 && x.note ? x.note : "", x.applied ? `Received after ${fD(C)}: ${x.applied}/-` : "", x.newDue ? `New Due: ${x.newDue}/-` : ""].filter(Boolean).join(" | ");

// ---------- Page ----------
function renderFinance() {
  const root = $("fin-root"); if (!root) return;
  const asOf = finAsOf || finToday(), R = finCompute(asOf), ap = isApprover();
  const td = (v, c = "") => `<td class="p-2 border ${c}">${v}</td>`, num = v => v === null ? "" : fN(v);
  const two = (rows, bold) => rows.map(r => `<tr>${td(r[0])}${td(num(r[1]), "text-right")}${td(r[2])}${td(num(r[3]), "text-right")}</tr>`).join("") + bold;
  const tot = (a, b, c, d) => `<tr class="bg-slate-100 font-bold">${td(a)}${td(fN(b), "text-right")}${td(c)}${td(d === null ? "" : fN(d), "text-right")}</tr>`;
  const card = (t, v, c) => `<div class="bg-white p-4 rounded-xl border"><p class="text-xs text-slate-500">${t}</p><p class="text-lg font-bold ${c}">৳ ${fN(v)}</p></div>`;
  const hd = (a, b, c, d) => `<thead class="bg-sky-800 text-white"><tr><th class="p-2 border text-left">${a}</th><th class="p-2 border text-right">${b}</th><th class="p-2 border text-left">${c}</th><th class="p-2 border text-right">${d}</th></tr></thead>`;
  const th = h => `<thead class="bg-sky-800 text-white"><tr>${h.map(x => `<th class="p-2 border text-left">${x}</th>`).join("")}</tr></thead>`;
  root.innerHTML = `
  <div class="flex flex-wrap items-center gap-3 mb-4"><h2 class="text-2xl font-bold">Financial Statement</h2>
    <span class="chip ${R.diff === 0 ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}">${R.diff === 0 ? "Balance Sheet মিলেছে ✓" : "পার্থক্য: " + fN(R.diff)}</span>
    <div class="ml-auto flex flex-wrap items-center gap-2 text-sm"><label>Statement Date:</label>
      <input type="date" value="${asOf}" min="${R.C}" onchange="finAsOf=this.value||null;renderFinance()" class="border rounded-lg px-3 py-2">
      ${finCanDownload() ? `<button onclick="finPDF()" class="bg-rose-600 text-white px-4 py-2 rounded-lg">📄 PDF</button><button onclick="finExcel()" class="bg-emerald-600 text-white px-4 py-2 rounded-lg">📤 Excel</button>` : ""}</div></div>
  <p class="text-xs text-slate-500 mb-3">Opening balance: ${fD(R.C)} পর্যন্ত Excel Financial Statement। এর পরের Approved কিস্তি ও নিচে যোগ করা Investment, Profit, খরচ — সব নিজে থেকে যুক্ত হয়।</p>
  <div class="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">${card("Total Assets", R.assets, "text-slate-800")}${card("Cash at Bank", R.cash, "text-emerald-600")}${card("Investments", R.inv + R.land, "text-sky-700")}${card("Subscriptions Receivable", R.recv, "text-rose-600")}${card("Surplus (Retained)", R.ret, "text-amber-600")}</div>
  <div class="bg-white rounded-xl border p-4 mb-5 overflow-x-auto"><h3 class="font-bold mb-1">Statement of Income and Expenditure</h3><p class="text-xs text-slate-500 mb-2">July 1, 2025 – ${fD(asOf)}</p>
    <table class="w-full text-sm">${hd("Revenue / Inflows", "Amount (BDT)", "Operating Expenses / Outflows", "Amount (BDT)")}<tbody>${two(finIncRows(R), tot("Total Income", R.totInc, "Total Expenses", R.totExp) + tot("Balance", R.bal, "", null))}</tbody></table></div>
  <div class="bg-white rounded-xl border p-4 mb-5 overflow-x-auto"><h3 class="font-bold mb-1">Statement of Financial Position (Balance Sheet)</h3><p class="text-xs text-slate-500 mb-2">As of ${fD(asOf)}</p>
    <table class="w-full text-sm">${hd("Assets", "Amount (BDT)", "Liabilities & Equity", "Amount (BDT)")}<tbody>${two(finBsRows(R), tot("Total Assets", R.assets, "Total Liabilities & Equity", R.le))}</tbody></table></div>
  <div class="bg-white rounded-xl border p-4 mb-5 overflow-x-auto"><h3 class="font-bold mb-2">Total Payable Amount (Individual)</h3>
    <table class="w-full text-sm">${th(["SL", "MID", "Name", "Investment", "Addition*", "Deduction**", "Total Payable"])}<tbody>${R.rows.map(x => `<tr>${td(x.m.sl)}${td(x.m.mid)}${td(x.m.name)}${td(fN(x.inv), "text-right")}${td(fN(x.add), "text-right")}${td(fN(x.ded), "text-right")}${td(fN(x.total), "text-right font-semibold")}</tr>`).join("")}
      <tr class="bg-slate-100 font-bold">${td("")}${td("")}${td("Total")}${td(fN(R.rows.reduce((s, x) => s + x.inv, 0)), "text-right")}${td(fN(R.rows.reduce((s, x) => s + x.add, 0)), "text-right")}${td(fN(R.rows.reduce((s, x) => s + x.ded, 0)), "text-right")}${td(fN(R.rows.reduce((s, x) => s + x.total, 0)), "text-right")}</tr></tbody></table>
    <p class="text-xs text-slate-500 mt-2">${finNotes(R).join("<br>")}</p></div>
  <div class="bg-white rounded-xl border p-4 mb-5 overflow-x-auto"><h3 class="font-bold mb-2">Subscription Receivable</h3>
    <table class="w-full text-sm">${th(["SL", "MID", "Name", "Receivable (Taka)", "Comment"])}<tbody>${R.rows.map(x => `<tr>${td(x.m.sl)}${td(x.m.mid)}${td(x.m.name)}${td(fN(x.recv), "text-right")}${td(finComment(x, R.C))}</tr>`).join("")}
      <tr class="bg-slate-100 font-bold">${td("")}${td("")}${td("Total")}${td(fN(R.recv), "text-right")}${td("")}</tr></tbody></table></div>
  <div class="bg-white rounded-xl border p-4 mb-5 overflow-x-auto"><h3 class="font-bold mb-2">Membership Fee</h3>
    <table class="w-full text-sm">${th(["SL", "MID", "Name", "Amount (Taka)"])}<tbody>${R.rows.map(x => `<tr>${td(x.m.sl)}${td(x.m.mid)}${td(x.m.name)}${td(fN(x.fee), "text-right")}</tr>`).join("")}
      <tr class="bg-slate-100 font-bold">${td("")}${td("")}${td("Total")}${td(fN(R.inc.membership), "text-right")}</tr></tbody></table></div>
  ${ap ? finTxPanel() : ""}`;
  if (ap) finTypeChange();
}

function finTxPanel() {
  const C = finCutoff(), list = finTx().slice().sort((a, b) => b.date.localeCompare(a.date));
  return `<div class="bg-white rounded-xl border p-4"><h3 class="font-bold mb-3">লেনদেন যোগ করুন (Investment / Profit / খরচ)</h3>
    <div class="grid md:grid-cols-5 gap-3 items-end">
      <div><label class="lbl">তারিখ</label><input type="date" id="fin-date" min="${C}" value="${finToday()}" class="inp"></div>
      <div><label class="lbl">ধরন</label><select id="fin-type" class="inp" onchange="finTypeChange()">${Object.entries(FIN_TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div>
      <div id="fin-cat-wrap"><label class="lbl">খাত</label><select id="fin-cat" class="inp"></select></div>
      <div><label class="lbl">Amount (BDT)</label><input type="number" id="fin-amount" min="0.01" step="0.01" class="inp"></div>
      <div><label class="lbl">মন্তব্য</label><input id="fin-note" class="inp"></div></div>
    <label id="fin-unpaid-wrap" class="text-sm hidden mt-2 block"><input type="checkbox" id="fin-unpaid"> এখনো পরিশোধ হয়নি (Accounts Payable-এ যাবে)</label>
    <button onclick="finAddTx()" class="bg-emerald-600 text-white text-sm px-4 py-2 rounded-lg mt-3">+ যোগ করুন</button>
    <p class="text-xs text-slate-500 mt-1">${fD(C)}-এর পরের তারিখ দিতে হবে (আগের লেনদেন Opening balance-এ আছে)।</p>
    <div class="overflow-x-auto mt-4"><table class="w-full text-xs"><thead class="bg-slate-100"><tr><th class="p-2 text-left">তারিখ</th><th class="text-left">ধরন</th><th class="text-left">খাত</th><th class="text-right">Amount</th><th class="text-left">মন্তব্য</th><th></th></tr></thead>
    <tbody>${list.map(t => `<tr class="border-b"><td class="p-2">${fD(t.date)}</td><td>${FIN_TYPES[t.type]}${t.unpaid ? " (বাকি)" : ""}</td><td>${(t.type === "expense" ? FIN_EXP : FIN_ASSET)[t.cat] || "-"}</td><td class="text-right">${fN(t.amount)}</td><td>${t.note || ""}</td>
      <td class="text-right"><button class="text-rose-600" onclick="finDelTx(${t.id})">Delete</button></td></tr>`).join("") || `<tr><td colspan="6" class="p-3 text-center text-slate-500">এখনো কোনো লেনদেন নেই</td></tr>`}</tbody></table></div></div>`;
}
function finTypeChange() {
  const t = $("fin-type").value, cat = $("fin-cat");
  const set = o => { cat.innerHTML = Object.entries(o).map(([k, v]) => `<option value="${k}">${v}</option>`).join(""); };
  if (t === "expense") set(FIN_EXP); else if (t === "invest" || t === "invest_return") set(FIN_ASSET);
  $("fin-cat-wrap").classList.toggle("hidden", !["expense", "invest", "invest_return"].includes(t));
  $("fin-unpaid-wrap").classList.toggle("hidden", t !== "expense");
}
function finAddTx() {
  if (!isApprover()) return;
  const t = { id: Date.now(), date: $("fin-date").value, type: $("fin-type").value, amount: Number($("fin-amount").value), note: $("fin-note").value.trim() };
  if (!["expense", "invest", "invest_return"].includes(t.type)) t.cat = ""; else t.cat = $("fin-cat").value;
  if (t.type === "expense") t.unpaid = $("fin-unpaid").checked;
  if (!t.date || t.date <= finCutoff()) return toast(fD(finCutoff()) + "-এর পরের তারিখ দিন");
  if (!(t.amount > 0)) return toast("সঠিক Amount দিন");
  S.fin = S.fin || { tx: [] }; S.fin.tx.push(t); saveS(); renderFinance(); toast("লেনদেন যোগ হয়েছে — Financial Statement হালনাগাদ হয়েছে");
}
function finDelTx(id) { if (!isApprover() || !confirm("এই লেনদেন মুছবেন?")) return; S.fin.tx = S.fin.tx.filter(t => t.id !== id); saveS(); renderFinance(); }

// ---------- Excel ----------
function finExcel() {
  if (!finCanDownload()) return toast("শুধু Admin / Admin (IT) download করতে পারবেন");
  const R = finCompute(finAsOf || finToday()), wb = XLSX.utils.book_new(), add = (name, aoa, w) => { const ws = XLSX.utils.aoa_to_sheet(aoa); ws["!cols"] = w.map(x => ({ wch: x })); XLSX.utils.book_append_sheet(wb, ws, name); };
  add("Financial Statement", [["Financial Statement"], ["Statement of Income and Expenditure"], ["July 1, 2025 – " + fD(R.asOf)], [], ["Revenue / Inflows", "Amount (BDT)", "Operating Expenses / Outflows", "Amount (BDT)"], ...finIncRows(R),
    ["Total Income", R.totInc, "Total Expenses", R.totExp], ["Balance", R.bal], [], ["Statement of Financial Position (Balance Sheet)"], ["As of " + fD(R.asOf)], [],
    ["Assets", "Amount (BDT)", "Liabilities & Equity", "Amount (BDT)"], ...finBsRows(R).map(r => [r[0], r[1], r[2], r[3] === null ? "" : r[3]]), ["Total Assets", R.assets, "Total Liabilities & Equity", R.le]], [38, 16, 42, 16]);
  add("Total Payable Amount", [["Total Payable Amount (Individual)"], ["Date: " + fD(R.asOf)], [], ["SL NO.", "MID", "Name", "Investment Amount (Taka)", "Addition (Profit, Bank Interest, Etc)*", "Deduction (Membership fee, Cost Etc)**", "Total Payable Amount"],
    ...R.rows.map(x => [x.m.sl, x.m.mid, x.m.name, x.inv, x.add, x.ded, x.total]), ["", "", "Total", ...[x => x.inv, x => x.add, x => x.ded, x => x.total].map(f => R.rows.reduce((s, x) => s + f(x), 0))], [], ...finNotes(R).map(n => [n])], [8, 12, 28, 22, 22, 22, 20]);
  add("Subscription Receivable", [["Subscription Receivable"], ["Date: " + fD(R.asOf)], [], ["SL NO.", "MID", "Name", "Amount (Taka)", "Comment"], ...R.rows.map(x => [x.m.sl, x.m.mid, x.m.name, x.recv, finComment(x, R.C)]), ["", "", "Total", R.recv]], [8, 12, 28, 16, 60]);
  add("Membership Fee", [["Membership Fee"], ["Date: " + fD(R.asOf)], [], ["SL NO.", "MID", "Name", "Amount (Taka)"], ...R.rows.map(x => [x.m.sl, x.m.mid, x.m.name, x.fee]), ["", "", "Total", R.inc.membership]], [8, 12, 28, 16]);
  add("Transactions", [["Date", "Type", "Category", "Amount", "Unpaid", "Note"], ...finTx().map(t => [t.date, FIN_TYPES[t.type], (t.type === "expense" ? FIN_EXP : FIN_ASSET)[t.cat] || "", t.amount, t.unpaid ? "Yes" : "", t.note || ""])], [12, 36, 38, 14, 8, 30]);
  XLSX.writeFile(wb, `PGCS-21_Financial_Statement_${R.asOf}.xlsx`); toast("Financial Statement Excel downloaded");
}

// ---------- PDF ----------
function finPDF() {
  if (!finCanDownload()) return toast("শুধু Admin / Admin (IT) download করতে পারবেন");
  const R = finCompute(finAsOf || finToday()), doc = new jsPDF(), f = fN;
  const bold = (a, b, c, d) => [{ content: a, styles: { fontStyle: "bold" } }, { content: f(b), styles: { fontStyle: "bold", halign: "right" } }, { content: c, styles: { fontStyle: "bold" } }, { content: d === null ? "" : f(d), styles: { fontStyle: "bold", halign: "right" } }];
  const body2 = rows => rows.map(r => [r[0], { content: r[1] === null ? "" : f(r[1]), styles: { halign: "right" } }, r[2], { content: r[3] === null ? "" : f(r[3]), styles: { halign: "right" } }]);
  const colL = { 0: { halign: "left" }, 2: { halign: "left" } };
  let y = pdfHead(doc, "Financial Statement");
  doc.setFontSize(10); doc.text("Statement of Income and Expenditure — July 1, 2025 – " + fD(R.asOf), 14, y - 4);
  safeTable(doc, { ...tblStyle, startY: y, head: [["Revenue / Inflows", "Amount (BDT)", "Operating Expenses / Outflows", "Amount (BDT)"]], columnStyles: colL,
    body: [...body2(finIncRows(R)), bold("Total Income", R.totInc, "Total Expenses", R.totExp), bold("Balance", R.bal, "", null)] });
  y = doc.lastAutoTable.finalY + 10; doc.setFontSize(10); doc.setFont("helvetica", "bold"); doc.text("Statement of Financial Position (Balance Sheet) — As of " + fD(R.asOf), 14, y - 3);
  safeTable(doc, { ...tblStyle, startY: y, head: [["Assets", "Amount (BDT)", "Liabilities & Equity", "Amount (BDT)"]], columnStyles: colL,
    body: [...body2(finBsRows(R)), bold("Total Assets", R.assets, "Total Liabilities & Equity", R.le)] });
  signBlock(doc);
  const page = (title, sub) => { doc.addPage(); const y0 = pdfHead(doc, title); doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.text(sub, 14, y0 - 4); return y0; };
  const tb = (y0, head, body, cs) => safeTable(doc, { ...tblStyle, startY: y0, head: [head], body, columnStyles: cs });
  const tr = { halign: "right" }, tot = (c, ...v) => [{ content: "", styles: {} }, "", { content: c, styles: { fontStyle: "bold" } }, ...v.map(x => ({ content: x, styles: { fontStyle: "bold", halign: "right" } }))];
  let y1 = page("Total Payable Amount (Individual)", "Date: " + fD(R.asOf));
  const sum = g => f(R.rows.reduce((s, x) => s + g(x), 0));
  tb(y1, ["SL", "MID", "Name", "Investment", "Addition*", "Deduction**", "Total Payable"], [...R.rows.map(x => [x.m.sl, x.m.mid, x.m.name, f(x.inv), f(x.add), f(x.ded), f(x.total)]), tot("Total", sum(x => x.inv), sum(x => x.add), sum(x => x.ded), sum(x => x.total))],
    { 2: { halign: "left" }, 3: tr, 4: tr, 5: tr, 6: tr });
  doc.setFontSize(8); doc.setFont("helvetica", "normal"); finNotes(R).forEach((n, k) => doc.text(n, 14, doc.lastAutoTable.finalY + 6 + k * 5)); signBlock(doc);
  let y2 = page("Subscription Receivable", "Date: " + fD(R.asOf));
  tb(y2, ["SL NO.", "MID", "Name", "Amount (Taka)", "Comment"], [...R.rows.map(x => [x.m.sl, x.m.mid, x.m.name, f(x.recv), finComment(x, R.C)]), tot("Total", f(R.recv), "")],
    { 2: { halign: "left" }, 3: tr, 4: { halign: "left", cellWidth: 62 } }); signBlock(doc);
  let y3 = page("Membership Fee", "Date: " + fD(R.asOf));
  tb(y3, ["SL NO.", "MID", "Name", "Amount (Taka)"], [...R.rows.map(x => [x.m.sl, x.m.mid, x.m.name, f(x.fee)]), tot("Total", f(R.inc.membership))], { 2: { halign: "left" }, 3: tr }); signBlock(doc);
  doc.save(`PGCS-21_Financial_Statement_${R.asOf}.pdf`); toast("Financial Statement PDF downloaded");
}
