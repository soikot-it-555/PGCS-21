// =====================================================================
// Admin (IT) screens — Payment Management, Income Year Management, Installment Management
// Loaded after app.js and finance.js. These functions REPLACE the simpler versions in app.js
// (same names, so renderAdmin() calls them unchanged). Data model = incomeYears / payments / paymentAudit.
// Every mutating function re-checks isAdmin() (Admin (IT) only).
// =====================================================================
const NO_PERM = "শুধু Admin (IT) এই কাজ করতে পারবেন";
const fmtDT = iso => { try { return new Date(iso).toLocaleString("en-GB", { hour12: false }); } catch { return iso || ""; } };
const attr = s => esc(s).replace(/`/g, "&#96;");
const fmtD = iso => iso ? iso.split("-").reverse().join("-") : "";
const yAct = y => y.status !== "Inactive";
const iAct = i => i.status !== "Inactive";
const instOfPay = p => { const y = incomeYears.find(x => x.name === p.fy); return y?.installments.find(i => i.id === p.instId || (p.inst && (i.legacyKey === p.inst || i.name === p.inst))) || null; };
const payInstLabel = p => instOfPay(p)?.name || p.inst || "";
const instPayments = (y, i) => payments.filter(p => p.fy === y.name && (p.instId === i.id || p.inst === i.legacyKey || p.inst === i.name));

function openInfo(title, html) { $("info-title").textContent = title; $("info-body").innerHTML = html; $("info-modal").classList.remove("hidden"); }
function closeInfo() { $("info-modal").classList.add("hidden"); }
// year / installment lists changed: refresh every selector and screen
function afterYearChange() {
  const sel = $("fy-select"), keep = sel.value;
  sel.innerHTML = Object.keys(YEARS).reverse().map(y => `<option>${y}</option>`).join("");
  if (YEARS[keep]) sel.value = keep;
  $("report-month-select").innerHTML = insts().map(i => `<option>${i.key}</option>`).join("");
  renderEntryOptions(); refreshAll();
}
function iyCommit(fn) {
  if (!isAdmin()) { toast(NO_PERM); return false; }
  if (fn() === false) return false;
  saveIncomeYears(); refreshYearsFromModel(); afterYearChange(); return true;
}

// =====================================================================
// 1. PAYMENT MANAGEMENT
// =====================================================================
const pm = { mid: "", name: "", fy: "", inst: "", status: "", from: "", to: "", limit: 100, built: "" };
function pmBuild() {
  const root = $("admin-payments"); if (!root) return;
  const fyOpts = `<option value="">All FY</option>` + incomeYears.map(y => `<option>${esc(y.name)}</option>`).join("");
  root.innerHTML = `<p class="text-xs text-slate-500 mb-3">সব Payment (Draft, Approved, Rejected, Voided) দেখুন ও পরিচালনা করুন। Approved Payment মুছলে তা <b>Voided</b> হয় (ইতিহাস সংরক্ষিত থাকে) এবং আর্থিক হিসাব থেকে বাদ যায়।</p>
    <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2 mb-3 text-sm">
      <input id="pm-mid" class="border rounded-lg px-2 py-1.5" placeholder="MID" oninput="pmApply()">
      <input id="pm-name" class="border rounded-lg px-2 py-1.5" placeholder="Member Name" oninput="pmApply()">
      <select id="pm-fy" class="border rounded-lg px-2 py-1.5 bg-white" onchange="pmApply()">${fyOpts}</select>
      <input id="pm-inst" class="border rounded-lg px-2 py-1.5" placeholder="Installment" oninput="pmApply()">
      <select id="pm-status" class="border rounded-lg px-2 py-1.5 bg-white" onchange="pmApply()"><option value="">All Status</option><option>Draft</option><option>Approved</option><option>Rejected</option><option>Voided</option></select>
      <input id="pm-from" type="date" class="border rounded-lg px-2 py-1.5" title="Payment Date from" onchange="pmApply()">
      <input id="pm-to" type="date" class="border rounded-lg px-2 py-1.5" title="Payment Date to" onchange="pmApply()">
    </div><div id="pm-body"></div>`;
  pm.built = incomeYears.map(y => y.name).join("|");
}
function pmApply() {
  pm.mid = $("pm-mid").value.trim().toLowerCase(); pm.name = $("pm-name").value.trim().toLowerCase(); pm.fy = $("pm-fy").value;
  pm.inst = $("pm-inst").value.trim().toLowerCase(); pm.status = $("pm-status").value; pm.from = $("pm-from").value; pm.to = $("pm-to").value; pm.limit = 100;
  renderPaymentManagement();
}
function pmFiltered() {
  return payments.filter(p => {
    const m = member(p.mid);
    return (!pm.mid || String(p.mid).toLowerCase().includes(pm.mid)) && (!pm.name || (m?.name || "").toLowerCase().includes(pm.name)) && (!pm.fy || p.fy === pm.fy)
      && (!pm.inst || payInstLabel(p).toLowerCase().includes(pm.inst)) && (!pm.status || p.status === pm.status)
      && (!pm.from || (p.date || "") >= pm.from) && (!pm.to || (p.date || "") <= pm.to);
  }).sort((a, b) => (b.date || "").localeCompare(a.date || "") || b.id - a.id);
}
function renderPaymentManagement() {
  if (!isAdmin() || !$("admin-payments")) return;
  if (!$("pm-body") || pm.built !== incomeYears.map(y => y.name).join("|")) {       // rebuild the filter bar only when the year list changed (keeps typing focus)
    const keep = { ...pm }; pmBuild();
    $("pm-mid").value = keep.mid; $("pm-name").value = keep.name; $("pm-fy").value = keep.fy; $("pm-inst").value = keep.inst; $("pm-status").value = keep.status; $("pm-from").value = keep.from; $("pm-to").value = keep.to;
  }
  const list = pmFiltered(), shown = list.slice(0, pm.limit), approved = list.filter(p => p.status === "Approved").reduce((s, p) => s + Number(p.amount || 0), 0);
  const act = p => p.status === "Approved" ? `<button class="text-rose-600 font-semibold hover:underline" onclick="voidPayment(${p.id})">🗑 Delete (Void)</button>`
    : p.status === "Draft" ? `<button class="text-emerald-700 hover:underline" onclick="setStatus(${p.id},'Approved')">Approve</button> <button class="text-amber-700 hover:underline" onclick="setStatus(${p.id},'Rejected')">Reject</button>`
      : p.status === "Voided" ? `<button class="text-slate-600 underline" onclick="showAudit(${p.id})">Audit</button>` : "—";
  $("pm-body").innerHTML = `<p class="text-xs text-slate-600 mb-2">${list.length} টি Payment · Approved মোট <b>${fmt(approved)}</b></p>
    <div class="overflow-x-auto border rounded-lg"><table class="w-full text-xs text-left whitespace-nowrap"><thead class="bg-slate-100"><tr class="[&>th]:p-2"><th>SL</th><th>Financial Year</th><th>MID</th><th>Member Name</th><th>Installment</th><th>Payment Date</th><th class="text-right">Amount (BDT)</th><th>Payment Method</th><th>Status</th><th>Action</th></tr></thead>
    <tbody>${shown.map((p, k) => `<tr class="border-t ${p.status === "Voided" ? "bg-slate-50 text-slate-400" : ""}"><td class="p-2">${k + 1}</td><td>${esc(p.fy)}</td><td class="font-mono">${esc(p.mid)}</td><td>${esc(member(p.mid)?.name || "—")}</td><td>${esc(payInstLabel(p))}${instOfPay(p) ? "" : ' <span title="Installment পাওয়া যায়নি" class="text-amber-600">⚠</span>'}</td><td>${esc(p.date || "")}</td><td class="text-right">${fmt(p.amount)}</td><td>${esc(p.method || "")}</td><td>${statusChip(p.status)}</td><td class="space-x-1">${act(p)}</td></tr>`).join("") || `<tr><td colspan="10" class="p-4 text-center text-slate-500">কোনো Payment পাওয়া যায়নি</td></tr>`}</tbody></table></div>
    ${list.length > shown.length ? `<button class="mt-2 text-sm text-blue-600 underline" onclick="pm.limit+=200;renderPaymentManagement()">আরও দেখান (${list.length - shown.length} টি বাকি)</button>` : ""}`;
}

// ----- Approved payment deletion = soft delete (Voided) with confirmation dialog + reason + audit -----
let voidId = null;
function voidPayment(id) {
  if (!isAdmin()) return toast("শুধু Admin (IT) Approved Payment void করতে পারবেন");
  const p = payments.find(x => String(x.id) === String(id));
  if (!p || ["Voided", "Deleted"].includes(p.status)) return toast("Payment পাওয়া যায়নি বা আগে void করা হয়েছে");
  if (p.status !== "Approved") return toast("শুধু Approved Payment Void করা যায় (Draft হলে Cancel/Reject করুন)");
  voidId = p.id;
  $("void-details").innerHTML = [["Payment ID", p.id], ["MID", p.mid + " — " + (member(p.mid)?.name || "")], ["Financial Year", p.fy], ["Installment", payInstLabel(p)], ["Payment Date", p.date], ["Amount", fmt(p.amount)], ["Status", p.status]]
    .map(([k, v]) => `<div class="flex justify-between gap-3 border-b py-1"><span class="text-slate-500">${k}</span><span class="font-semibold text-right">${esc(v)}</span></div>`).join("");
  $("void-reason").value = ""; $("void-err").classList.add("hidden"); $("void-modal").classList.remove("hidden"); $("void-reason").focus();
}
function closeVoid() { voidId = null; $("void-modal").classList.add("hidden"); }
function confirmVoid() {
  const reason = $("void-reason").value.trim();
  if (reason.length < 3) { $("void-err").textContent = "মুছে ফেলার কারণ লিখুন (কমপক্ষে ৩ অক্ষর)"; $("void-err").classList.remove("hidden"); return; }
  const p = payments.find(x => x.id === voidId);
  if (!isAdmin() || !p || p.status !== "Approved") { closeVoid(); return toast("Payment Void করা যায়নি"); }
  const previousStatus = p.status;
  p.previousStatus = previousStatus; p.status = "Voided"; p.voidedAt = new Date().toISOString(); p.voidedBy = session.mid; p.voidReason = reason;
  paymentAudit.push({ id: `pa-${p.id}-${Date.now()}`, paymentId: p.id, deletedBy: session.mid, deletionDate: p.voidedAt, reason, previousStatus, mid: p.mid, installment: payInstLabel(p), amount: p.amount });
  savePaymentAudit(); save(); closeVoid(); refreshAll();
  toast(`Payment #${p.id} (${p.mid}, ${payInstLabel(p)}, ${fmt(p.amount)}) Void করা হয়েছে — হিসাব হালনাগাদ হয়েছে`);
}
function showAudit(id) {
  const p = payments.find(x => x.id === id); if (!p) return;
  const rows = paymentAudit.filter(a => a.paymentId === p.id).map(a => `<tr class="border-t"><td class="p-2">${esc(a.deletedBy)}</td><td>${esc(fmtDT(a.deletionDate))}</td><td>${esc(a.previousStatus || "")}</td><td>${esc(a.reason || "")}</td></tr>`).join("");
  openInfo(`Audit History — Payment #${p.id}`, `<p class="text-sm mb-2">${esc(p.mid)} · ${esc(payInstLabel(p))} · ${fmt(p.amount)} · ${statusChip(p.status)}</p>
    <table class="w-full text-xs text-left"><thead class="bg-slate-100"><tr class="[&>th]:p-2"><th>Deleted By</th><th>Deletion Date</th><th>Previous Status</th><th>Reason</th></tr></thead><tbody>${rows || `<tr class="border-t"><td class="p-2">${esc(p.voidedBy || "")}</td><td>${esc(fmtDT(p.voidedAt))}</td><td>${esc(p.previousStatus || "")}</td><td>${esc(p.voidReason || "")}</td></tr>`}</tbody></table>`);
}

// =====================================================================
// 2. INCOME YEAR MANAGEMENT (+ 3. INSTALLMENT MANAGEMENT)
// =====================================================================
let iySel = null, iyForm = null;
const iyYear = id => incomeYears.find(y => y.id === id);
const iyOverlap = (start, end, exceptId) => incomeYears.find(y => y.id !== exceptId && yAct(y) && start <= y.endDate && end >= y.startDate);
function iyKeepSel() {
  if (!iySel || !iyYear(iySel)) { const t = todayISO(); iySel = (incomeYears.find(y => t >= y.startDate && t <= y.endDate) || incomeYears[incomeYears.length - 1] || {}).id || null; }
}
function renderIncomeYearManagement() {
  const root = $("admin-years"); if (!root || !isAdmin()) return;
  if (iyForm && $("iy-start")) {      // a background refresh (another device saved something) must not wipe what is being typed
    if (!iyForm.edit) iyForm.name = $("iy-name").value;
    Object.assign(iyForm, { start: $("iy-start").value, end: $("iy-end").value, amount: $("iy-amt").value, day: $("iy-day").value, active: $("iy-status").value === "Active" });
  }
  iyKeepSel();
  const f = iyForm, y = iySel && iyYear(iySel);
  const form = f ? `<div class="border rounded-xl p-4 bg-slate-50 mb-4"><p class="font-semibold text-sm mb-2">${f.edit ? "Edit Income Year — " + esc(f.name) : "New Income Year / নতুন আয় বছর"}</p>
    <div class="grid md:grid-cols-3 gap-3 text-sm">
      <div><label class="lbl">Income Year Name</label><input id="iy-name" class="inp" placeholder="2027-28" value="${attr(f.name)}" ${f.edit ? "disabled" : ""}></div>
      <div><label class="lbl">Start Date</label><input id="iy-start" type="date" class="inp" value="${attr(f.start)}"></div>
      <div><label class="lbl">End Date</label><input id="iy-end" type="date" class="inp" value="${attr(f.end)}"></div>
      <div><label class="lbl">Default Monthly Installment (BDT)</label><input id="iy-amt" type="number" min="1" class="inp" value="${attr(f.amount)}"></div>
      <div><label class="lbl">Monthly Due Day (1–31)</label><input id="iy-day" type="number" min="1" max="31" class="inp" value="${attr(f.day)}"></div>
      <div><label class="lbl">Status</label><select id="iy-status" class="inp"><option ${f.active ? "selected" : ""}>Active</option><option ${f.active ? "" : "selected"}>Inactive</option></select></div>
    </div>
    ${f.edit ? `<p class="text-xs text-slate-500 mt-2">Default Amount / Due Day শুধু নতুন কিস্তি যোগ করার সময় কাজে লাগে; বিদ্যমান কিস্তি নিচের Installments অংশ থেকে বদলান। Year-এর নাম বদলানো যায় না (Payment-এর সাথে সংযোগ ঠিক রাখতে)।</p>` : `<p class="text-xs text-slate-500 mt-2">সংরক্ষণ করলে Start–End সময়ের প্রতিটি মাসের জন্য একটি করে কিস্তি স্বয়ংক্রিয়ভাবে তৈরি হবে (Due Day মাসের শেষ দিনের বেশি হলে মাসের শেষ দিন; Leap Year সহ)।</p>`}
    <p id="iy-err" class="text-rose-600 text-sm mt-2 hidden"></p>
    <div class="flex gap-2 mt-3"><button class="bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm" onclick="iySaveForm()">${f.edit ? "Save Changes" : "Create Income Year"}</button><button class="bg-slate-200 px-4 py-2 rounded-lg text-sm" onclick="iyForm=null;renderIncomeYearManagement()">Cancel</button></div></div>` : "";
  const opts = [...incomeYears].sort((a, b) => b.startDate.localeCompare(a.startDate)).map(x => `<option value="${attr(x.id)}" ${y && x.id === y.id ? "selected" : ""}>${esc(x.name)}${yAct(x) ? "" : " (Inactive)"}</option>`).join("");
  const card = y ? `<div class="border rounded-xl p-4 mb-3 grid grid-cols-2 md:grid-cols-6 gap-3 text-sm bg-white">
      <div><p class="text-xs text-slate-500">Start</p><p class="font-semibold">${fmtD(y.startDate)}</p></div><div><p class="text-xs text-slate-500">End</p><p class="font-semibold">${fmtD(y.endDate)}</p></div>
      <div><p class="text-xs text-slate-500">Default Installment</p><p class="font-semibold">${fmt(y.defaultAmount || 0)}</p></div><div><p class="text-xs text-slate-500">Due Day</p><p class="font-semibold">${y.dueDay || ""}</p></div>
      <div><p class="text-xs text-slate-500">Installments</p><p class="font-semibold">${(y.installments || []).length}</p></div>
      <div><p class="text-xs text-slate-500">Status</p><span class="chip ${yAct(y) ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}">${yAct(y) ? "Active" : "Inactive"}</span></div>
      <div class="col-span-2 md:col-span-6 space-x-3"><button class="text-blue-600 underline" onclick="iyEdit('${attr(y.id)}')">Edit Year</button><button class="${yAct(y) ? "text-amber-700" : "text-emerald-700"} underline" onclick="iyToggleYear('${attr(y.id)}')">${yAct(y) ? "Deactivate Year" : "Activate Year"}</button></div></div>` : "";
  root.innerHTML = `<div class="flex flex-wrap items-center gap-2 mb-3"><label class="text-sm font-medium">Income Year:</label>
    <select id="iy-select" class="border rounded-lg px-2 py-1.5 text-sm bg-white" onchange="iySel=this.value;iyForm=null;renderIncomeYearManagement()">${opts}</select>
    <button class="ml-auto bg-emerald-600 text-white text-sm px-3 py-1.5 rounded-lg whitespace-nowrap" onclick="iyNew()">+ New Income Year</button></div>
    <p class="text-xs text-slate-500 mb-3">বছর বেছে নিন — নিচের Year Details ও Installments শুধু সেই বছরের। নতুন Income Year তৈরি করলে তা Dashboard, Payment Entry, Financial Statement ও Receivable-এ স্বয়ংক্রিয়ভাবে আসে (সব ডিভাইসে)।</p>${form}${card}`;
  renderInstallmentManagement();
}
function iyNew() {
  const last = incomeYears.map(y => y.endDate).sort().pop(), sy = last ? Number(last.slice(0, 4)) + (last.slice(5) >= "07" ? 1 : 0) : new Date().getFullYear();
  iyForm = { edit: false, name: sy + "-" + pad2((sy + 1) % 100), start: sy + "-07-01", end: (sy + 1) + "-06-30", amount: 2000, day: 25, active: true };
  renderIncomeYearManagement();
}
function iyEdit(id) {
  const y = iyYear(id); if (!y) return toast("Income Year পাওয়া যায়নি");
  iyForm = { edit: true, id, name: y.name, start: y.startDate, end: y.endDate, amount: y.defaultAmount || 2000, day: y.dueDay || 25, active: yAct(y) }; renderIncomeYearManagement();
}
function iyOpenInst(id) {   // kept for compatibility
  iySel = id; renderIncomeYearManagement();
  $("admin-inst").scrollIntoView({ behavior: "smooth", block: "start" });
}
function iySaveForm() {
  const f = iyForm, err = m => { $("iy-err").textContent = m; $("iy-err").classList.remove("hidden"); return false; };
  const name = f.edit ? f.name : $("iy-name").value.trim(), start = $("iy-start").value, end = $("iy-end").value, amt = Number($("iy-amt").value), day = Number($("iy-day").value), active = $("iy-status").value === "Active";
  if (!/^\d{4}-\d{2}$/.test(name)) return err("Income Year Name এই ফরম্যাটে দিন: 2027-28");
  if (!validISO(start) || !validISO(end)) return err("সঠিক Start Date ও End Date দিন");
  if (start >= end) return err("End Date অবশ্যই Start Date-এর পরে হতে হবে");
  if (!(amt > 0)) return err("Default Installment Amount ০-এর বেশি হতে হবে");
  if (!Number.isInteger(day) || day < 1 || day > 31) return err("Due Day ১ থেকে ৩১-এর মধ্যে হতে হবে");
  if (!f.edit && incomeYears.some(y => y.name === name)) return err(`"${name}" নামে Income Year আগে থেকেই আছে`);
  const clash = iyOverlap(start, end, f.edit ? f.id : null);
  if (clash && active) return err(`এই সময় "${clash.name}" Income Year-এর সাথে মিলে যাচ্ছে`);
  if (f.edit && !active && yAct(iyYear(f.id)) && !confirm(`"${name}" নিষ্ক্রিয় করলে এর কিস্তি Payment Entry, Dashboard Due ও Receivable থেকে বাদ যাবে। নিশ্চিত?`)) return;
  let newId = f.id;
  const ok = iyCommit(() => {
    if (f.edit) { const y = iyYear(f.id); if (!y) return false; Object.assign(y, { startDate: start, endDate: end, defaultAmount: amt, dueDay: day, status: active ? "Active" : "Inactive" }); }
    else { newId = `iy-${slugId(name)}-${Date.now()}`; incomeYears.push({ id: newId, name, startDate: start, endDate: end, defaultAmount: amt, dueDay: day, status: active ? "Active" : "Inactive", installments: genIncomeYearInstallments(name, start, end, amt, day) }); }
  });
  if (!ok) return;
  iyForm = null; iySel = newId; renderIncomeYearManagement();
  toast(f.edit ? "Income Year হালনাগাদ হয়েছে" : `Income Year ${name} তৈরি হয়েছে — ${iyYear(newId).installments.length} টি কিস্তি স্বয়ংক্রিয়ভাবে যোগ হয়েছে`);
}
function iyToggleYear(id) {
  const y = iyYear(id); if (!y) return;
  const to = !yAct(y);
  if (!to && !confirm(`"${y.name}" নিষ্ক্রিয় করবেন? এর কিস্তি Payment Entry, Dashboard Due ও Receivable থেকে বাদ যাবে (Payment-এর ইতিহাস থাকবে)।`)) return;
  if (to) { const c = iyOverlap(y.startDate, y.endDate, y.id); if (c) return toast(`"${c.name}"-এর সাথে সময় মিলে যায়, তাই সক্রিয় করা গেল না`); }
  if (iyCommit(() => { y.status = to ? "Active" : "Inactive"; })) toast(`${y.name} ${to ? "সক্রিয়" : "নিষ্ক্রিয়"} হয়েছে`);
}

// ----- Installment Management (section "Installments") -----
function renderInstallmentManagement() {
  const root = $("admin-inst"); if (!root || !isAdmin()) return;
  iyKeepSel();
  const y = iySel && iyYear(iySel);
  if (!y) { root.innerHTML = '<p class="text-sm text-slate-500">কোনো Income Year নেই।</p>'; return; }
  root.innerHTML = `<div class="flex flex-wrap items-center gap-2 mb-2"><p class="text-sm font-semibold">${esc(y.name)} — Installments</p>
    <button class="ml-auto bg-emerald-600 text-white text-xs px-3 py-1.5 rounded-lg" onclick="iyAddInst()">+ Add Installment</button></div>
    <div class="overflow-x-auto border rounded-lg"><table class="w-full text-xs text-left"><thead class="bg-slate-100"><tr class="[&>th]:p-2"><th>SL</th><th>Installment Name</th><th>Due Date</th><th>Amount (BDT)</th><th>Payments</th><th class="text-center">Active</th><th></th></tr></thead><tbody>${(y.installments || []).map((i, k) => {
      const ps = instPayments(y, i), ap = ps.filter(paymentCounts), id = attr(i.id);
      return `<tr class="border-t"><td class="p-2">${k + 1}</td>
      <td><input class="border rounded px-2 py-1 w-40" value="${attr(i.name)}" onchange="iyEditInst('${y.id}','${id}','name',this.value)"></td>
      <td><input type="date" class="border rounded px-2 py-1" value="${attr(i.dueDate)}" onchange="iyEditInst('${y.id}','${id}','dueDate',this.value)"></td>
      <td><input type="number" min="1" class="border rounded px-2 py-1 w-24" value="${Number(i.amount)}" onchange="iyEditInst('${y.id}','${id}','amount',this.value)"></td>
      <td>${ps.length ? `<button class="text-blue-600 underline" onclick="iyViewPayments('${y.id}','${id}')">${ps.length} টি · ${fmt(ap.reduce((s, p) => s + Number(p.amount || 0), 0))}</button>` : '<span class="text-slate-400">—</span>'}</td>
      <td class="text-center"><input type="checkbox" ${iAct(i) ? "checked" : ""} onchange="iyEditInst('${y.id}','${id}','status',this.checked)"></td>
      <td>${ps.length ? '<span class="text-slate-400" title="Payment আছে — মোছা যায় না, Deactivate করুন">🔒</span>' : `<button class="text-rose-600 hover:underline" onclick="iyDeleteInst('${y.id}','${id}')">Delete</button>`}</td></tr>`; }).join("")}</tbody></table></div>
    <p class="text-xs text-slate-500 mt-2">Payment যুক্ত কিস্তি মোছা যায় না (ইতিহাস সংরক্ষণ); প্রয়োজনে Deactivate করুন। নাম বদলালেও পুরনো Payment ঠিক কিস্তির সাথেই যুক্ত থাকে।</p>`;
}
function iyEditInst(yid, iid, field, value) {
  if (!isAdmin()) return toast(NO_PERM);
  const y = iyYear(yid), i = y?.installments.find(x => x.id === iid); if (!i) return;
  const ap = instPayments(y, i).filter(paymentCounts).length, redo = () => renderInstallmentManagement();
  let v = value;
  if (field === "name") {
    v = String(value || "").trim();
    if (!v) { redo(); return toast("Installment Name খালি রাখা যাবে না"); }
    if (y.installments.some(x => x.id !== iid && x.name.toLowerCase() === v.toLowerCase())) { redo(); return toast("এই নামে কিস্তি আগে থেকেই আছে"); }
    if (v === i.name) return;
  } else if (field === "dueDate") {
    if (!validISO(v)) { redo(); return toast("সঠিক তারিখ দিন"); }
    if (v === i.dueDate) return;
    if (ap && !confirm(`এই কিস্তিতে ${ap} টি Approved Payment আছে। Due Date বদলালে Receivable-এর হিসাব বদলাতে পারে। নিশ্চিত?`)) return redo();
  } else if (field === "amount") {
    v = Number(value);
    if (!(v > 0)) { redo(); return toast("সঠিক টাকার পরিমাণ দিন"); }
    if (v === Number(i.amount)) return;
    if (ap && !confirm(`এই কিস্তিতে ${ap} টি Approved Payment আছে। Amount বদলালে সদস্যদের বকেয়া/Receivable বদলে যাবে। নিশ্চিত?`)) return redo();
  } else if (field === "status") v = value ? "Active" : "Inactive";
  else return;
  const ok = iyCommit(() => {
    if (field === "name" && !i.legacyKey) i.legacyKey = i.name;      // old name kept: older payments (matched by name) stay linked
    i[field] = v;
  });
  if (ok) toast(field === "status" ? (v === "Active" ? "কিস্তি সক্রিয় হয়েছে" : "কিস্তি নিষ্ক্রিয় হয়েছে") : "কিস্তি হালনাগাদ হয়েছে"); else redo();
}
function iyAddInst() {
  if (!isAdmin()) return toast(NO_PERM);
  const y = iyYear(iySel); if (!y) return;
  const name = (prompt("নতুন কিস্তির নাম (যেমন: Special Fund):") || "").trim(); if (!name) return;
  if (y.installments.some(x => x.name.toLowerCase() === name.toLowerCase())) return toast("এই নামে কিস্তি আগে থেকেই আছে");
  const due = (prompt("Due Date (YYYY-MM-DD):", y.startDate) || "").trim(); if (!validISO(due)) return toast("সঠিক তারিখ দিন (YYYY-MM-DD)");
  const amount = Number(prompt("Amount (BDT):", y.defaultAmount || 2000)); if (!(amount > 0)) return toast("সঠিক টাকার পরিমাণ দিন");
  if (iyCommit(() => { y.installments.push({ id: `iy-${slugId(y.name)}-x${Date.now().toString(36)}`, name, dueDate: due, amount, status: "Active" }); })) toast("নতুন কিস্তি যোগ হয়েছে");
}
function iyDeleteInst(yid, iid) {
  if (!isAdmin()) return toast(NO_PERM);
  const y = iyYear(yid), i = y?.installments.find(x => x.id === iid); if (!i) return;
  const n = instPayments(y, i).length;
  if (n) return toast(`এই কিস্তির সাথে ${n} টি Payment যুক্ত — মোছা যাবে না (Deactivate করুন)`);
  if (!confirm(`"${i.name}" কিস্তি মুছে ফেলবেন?`)) return;
  if (iyCommit(() => { y.installments = y.installments.filter(x => x.id !== iid); })) toast("কিস্তি মুছে ফেলা হয়েছে");
}
function iyViewPayments(yid, iid) {
  const y = iyYear(yid), i = y?.installments.find(x => x.id === iid); if (!i) return;
  const rows = instPayments(y, i).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  openInfo(`${y.name} — ${i.name}: Payments`, `<table class="w-full text-xs text-left"><thead class="bg-slate-100"><tr class="[&>th]:p-2"><th>SL</th><th>MID</th><th>Name</th><th>Date</th><th class="text-right">Amount</th><th>Method</th><th>Status</th></tr></thead><tbody>${rows.map((p, k) => `<tr class="border-t"><td class="p-2">${k + 1}</td><td>${esc(p.mid)}</td><td>${esc(member(p.mid)?.name || "")}</td><td>${esc(p.date || "")}</td><td class="text-right">${fmt(p.amount)}</td><td>${esc(p.method || "")}</td><td>${statusChip(p.status)}</td></tr>`).join("")}</tbody></table>`);
}

// =====================================================================
// 4. PAYMENT ENTRY SETTINGS (one section: form on/off, payment methods, bank, account numbers, Income Years, Installments)
// =====================================================================
const methodUse = m => payments.filter(p => p.method === m).length;
function renderEntrySettings() {
  const root = $("admin-entry"); if (!root || !isAdmin()) return;
  $("entry-settings-link")?.classList.remove("hidden");
  const keep = { m: $("es-new-method")?.value || "", a: $("es-new-account")?.value || "" };      // typed text survives background refreshes
  root.innerHTML = `
    <label class="text-sm font-medium"><input type="checkbox" ${S.formOpen ? "checked" : ""} onchange="setS('formOpen',this.checked)"> Enable Entry Form for Members <span class="text-xs text-slate-500">(বন্ধ থাকলে শুধু Admin Entry দিতে পারে)</span></label>
    <div class="grid lg:grid-cols-2 gap-5 mt-5">
      <div><p class="font-semibold text-sm mb-2">Payment Methods</p>
        <div class="space-y-2">${S.methods.map((m, i) => `<div class="flex gap-2"><input class="border rounded-lg px-2 py-1.5 text-sm flex-1" value="${attr(m)}" onchange="esRenameMethod(${i},this.value)"><button class="text-rose-600 text-sm px-2 hover:underline" onclick="esRemoveMethod(${i})" title="Remove">✕ Remove</button></div>`).join("")}</div>
        <div class="flex gap-2 mt-2"><input id="es-new-method" class="border rounded-lg px-2 py-1.5 text-sm flex-1" placeholder="নতুন Payment Method (যেমন: bKash)" value="${attr(keep.m)}" onkeydown="if(event.key==='Enter')esAddMethod()"><button class="bg-emerald-600 text-white text-sm px-3 py-1.5 rounded-lg" onclick="esAddMethod()">+ Add</button></div>
        <p class="text-xs text-slate-500 mt-2">নাম বদলালে বা মুছলে পুরনো Payment-এর রেকর্ড অপরিবর্তিত থাকে। কমপক্ষে একটি Method থাকতে হবে।</p></div>
      <div><p class="font-semibold text-sm mb-2">Default Bank</p>
        <input class="border rounded-lg px-2 py-1.5 text-sm w-full" value="${attr(S.bank)}" onchange="esSetBank(this.value)">
        <p class="font-semibold text-sm mt-5 mb-2">Account Numbers (Entry Form-এ যোগ করা)</p>
        <div class="space-y-2">${(S.accounts || []).map((a, i) => `<div class="flex gap-2"><input class="border rounded-lg px-2 py-1.5 text-sm flex-1 font-mono" value="${attr(a)}" onchange="esRenameAccount(${i},this.value)"><button class="text-rose-600 text-sm px-2 hover:underline" onclick="esRemoveAccount(${i})">✕ Remove</button></div>`).join("") || '<p class="text-xs text-slate-400">কোনো অতিরিক্ত Account নেই</p>'}</div>
        <div class="flex gap-2 mt-2"><input id="es-new-account" class="border rounded-lg px-2 py-1.5 text-sm flex-1 font-mono" placeholder="নতুন Account No" value="${attr(keep.a)}" onkeydown="if(event.key==='Enter')esAddAccount()"><button class="bg-emerald-600 text-white text-sm px-3 py-1.5 rounded-lg" onclick="esAddAccount()">+ Add</button></div>
        <p class="text-xs text-slate-500 mt-2">সদস্যদের নিজস্ব Account No (Members & Login থেকে) এবং ডিফল্ট Account আগের মতোই Entry Form-এ আসে।</p></div>
    </div>`;
}
function esSave(patch, msg) {
  if (!isAdmin()) return toast(NO_PERM);
  Object.assign(S, patch); saveS(); renderEntryOptions(); renderEntrySettings(); toast(msg);
}
function esAddMethod() {
  if (!isAdmin()) return toast(NO_PERM);
  const v = $("es-new-method").value.trim();
  if (!v) return toast("Payment Method-এর নাম লিখুন");
  if (S.methods.some(m => m.toLowerCase() === v.toLowerCase())) return toast("এই Payment Method আগে থেকেই আছে");
  $("es-new-method").value = ""; esSave({ methods: [...S.methods, v] }, `"${v}" যোগ হয়েছে`);
}
function esRenameMethod(i, value) {
  const v = String(value || "").trim(), old = S.methods[i];
  if (!v) { renderEntrySettings(); return toast("নাম খালি রাখা যাবে না"); }
  if (v === old) return;
  if (S.methods.some((m, k) => k !== i && m.toLowerCase() === v.toLowerCase())) { renderEntrySettings(); return toast("এই নামে Method আগে থেকেই আছে"); }
  const n = methodUse(old);
  if (n && !confirm(`"${old}" দিয়ে ${n} টি Payment আছে — সেগুলো পুরনো নামেই থাকবে। নাম বদলাবেন?`)) return renderEntrySettings();
  esSave({ methods: S.methods.map((m, k) => k === i ? v : m) }, "Payment Method হালনাগাদ হয়েছে");
}
function esRemoveMethod(i) {
  if (!isAdmin()) return toast(NO_PERM);
  if (S.methods.length <= 1) return toast("কমপক্ষে একটি Payment Method থাকতে হবে");
  const m = S.methods[i], n = methodUse(m);
  if (!confirm(`"${m}" মুছে ফেলবেন?${n ? ` (এই Method-এর ${n} টি পুরনো Payment অপরিবর্তিত থাকবে)` : ""}`)) return;
  esSave({ methods: S.methods.filter((_, k) => k !== i) }, `"${m}" মুছে ফেলা হয়েছে`);
}
function esSetBank(value) {
  const v = String(value || "").trim(); if (!v) { renderEntrySettings(); return toast("Bank-এর নাম খালি রাখা যাবে না"); }
  esSave({ bank: v }, "Default Bank হালনাগাদ হয়েছে");
}
function esAddAccount() {
  if (!isAdmin()) return toast(NO_PERM);
  const v = $("es-new-account").value.trim();
  if (!v) return toast("Account No লিখুন");
  if (accountNumbers().includes(v)) return toast("এই Account No আগে থেকেই আছে");
  $("es-new-account").value = ""; esSave({ accounts: [...(S.accounts || []), v] }, "Account No যোগ হয়েছে");
}
function esRenameAccount(i, value) {
  const v = String(value || "").trim(), old = S.accounts[i];
  if (!v) { renderEntrySettings(); return toast("Account No খালি রাখা যাবে না"); }
  if (v === old) return;
  if (accountNumbers().includes(v)) { renderEntrySettings(); return toast("এই Account No আগে থেকেই আছে"); }
  esSave({ accounts: S.accounts.map((a, k) => k === i ? v : a) }, "Account No হালনাগাদ হয়েছে");
}
function esRemoveAccount(i) {
  if (!isAdmin()) return toast(NO_PERM);
  if (!confirm(`"${S.accounts[i]}" Account মুছে ফেলবেন? (পুরনো Payment অপরিবর্তিত থাকবে)`)) return;
  esSave({ accounts: S.accounts.filter((_, k) => k !== i) }, "Account No মুছে ফেলা হয়েছে");
}

// shortcut on the Payment Entry page (Admin (IT) only): jump straight to Payment Entry Settings
function openEntrySettings() {
  if (!isAdmin()) return toast(NO_PERM);
  showPage("admin"); adminNavigate("admin-entry-section", document.querySelector('#admin-subnav [data-admin-target="admin-entry-section"]'));
}
