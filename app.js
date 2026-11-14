// ---------- Config ----------
const DEFAULT_MEMBER_PASS = "pgcs1234";               // সদস্যদের প্রাথমিক password
const ACCESS_ROLES = {
  adminIT: "Admin (IT)",
  admin: "Admin",
  member: "Member"
};
const DEFAULT_IT_MID = "PGCS-2105";
const DUE_DAY = 25;
const MKEY = "pgcs_members_v1", SKEY = "pgcs_settings_v1";
const DEFAULT_ACCOUNTS = [
  "2914100000145", "2914010013209", "2914010013896", "0314010032207",
  "2914010014942", "2914010013220", "2914010013261", "2914010014958",
  "2914010013165", "0314010029577", "2914010013305", "2914010013331",
  "2914010013987", "2914010013241", "2914010013186", "2914010014963",
  "2914010015981"
];
const _sm = localStorage.getItem(MKEY); if (_sm) { MEMBERS.length = 0; MEMBERS.push(...JSON.parse(_sm)); }
const S = Object.assign({ formOpen: true, methods: ["Magpie-Fund Transfer", "BEFTN", "NPSB", "Cash Payment"], bank: "BASIC Bank PLC", closed: [], amt: {}, accounts: [] }, JSON.parse(localStorage.getItem(SKEY) || "{}"));
const saveMembers = () => localStorage.setItem(MKEY, JSON.stringify(MEMBERS));
const saveS = () => localStorage.setItem(SKEY, JSON.stringify(S));
function applyAmounts() { for (const y in YEARS) YEARS[y].forEach(i => { const v = S.amt[y + "|" + i.key]; if (v) i.amount = v; }); }
applyAmounts();
const KEY = "pgcs_payments_v3", PWKEY = "pgcs_passwords_v1";

let payments = JSON.parse(localStorage.getItem(KEY)) || INITIAL_PAYMENTS.map(p => ({ ...p }));
let pw = JSON.parse(localStorage.getItem(PWKEY)) || {};
let session = JSON.parse(sessionStorage.getItem("pgcs_session") || "null");
let chart = null, lastSelectedAccount = "", personalEditMode = false;
const save = () => localStorage.setItem(KEY, JSON.stringify(payments));
const $ = id => document.getElementById(id);
const fy = () => $("fy-select").value;
const insts = () => YEARS[fy()];
const accessRole = m => Object.hasOwn(ACCESS_ROLES, m?.accessRole) ? m.accessRole : m?.mid.toUpperCase() === DEFAULT_IT_MID ? "adminIT" : "member";
const currentRole = () => session?.role;
const isAdmin = () => currentRole() === "adminIT";
const isApprover = () => isAdmin() || currentRole() === "admin";
const canAccessPage = page => ({
  adminIT: ["dashboard", "entry", "approvals", "admin", "reports", "member-detail"],
  admin: ["dashboard", "entry", "approvals", "reports", "member-detail"],
  member: ["dashboard", "entry", "reports", "member-detail"]
}[currentRole()] || []).includes(page);
const fmt = n => "৳ " + Number(n).toLocaleString("en-IN");
const member = mid => MEMBERS.find(m => m.mid === mid);
const toast = msg => { $("toast").textContent = msg; $("toast").classList.remove("hidden"); setTimeout(() => $("toast").classList.add("hidden"), 3000); };

// ---------- Auth ----------
$("loginForm").addEventListener("submit", e => {
  e.preventDefault();
  const u = $("login-user").value.trim(), p = $("login-pass").value;
  const m = MEMBERS.find(x => x.mid.toLowerCase() === u.toLowerCase());
  if (!m || m.loginOff || p !== (pw[m.mid] || DEFAULT_MEMBER_PASS)) {
    $("login-err").textContent = m?.loginOff ? "এই account বন্ধ আছে — Admin (IT)-এর সাথে যোগাযোগ করুন" : "ভুল username/MID বা password";
    $("login-err").classList.remove("hidden");
    return;
  }
  session = { role: accessRole(m), mid: m.mid };
  sessionStorage.setItem("pgcs_session", JSON.stringify(session));
  startApp();
});
function logout() { sessionStorage.removeItem("pgcs_session"); location.reload(); }
function changePassword() {
  const np = prompt("নতুন password দিন (কমপক্ষে 6 অক্ষর):");
  if (!np || np.length < 6) return np === null ? 0 : toast("Password খুব ছোট");
  pw[session.mid] = np;
  localStorage.setItem(PWKEY, JSON.stringify(pw)); toast("Password পরিবর্তন হয়েছে");
}
function resetData() {
  if (!isAdmin() || !confirm("সব data Excel-এর মূল অবস্থায় ফিরবে। নিশ্চিত?")) return;
  payments = INITIAL_PAYMENTS.map(p => ({ ...p })); save(); refreshAll(); toast("Reset সম্পন্ন");
}

// ---------- Database Backup / Restore (Admin IT only) ----------
const BACKUP_KEYS = [MKEY, SKEY, KEY, PWKEY];
function downloadDatabaseBackup() {
  if (!isAdmin()) return toast("শুধু Admin (IT) Backup নিতে পারবেন");
  const data = {};
  BACKUP_KEYS.forEach(key => { data[key] = localStorage.getItem(key); });
  const backup = {
    app: "PGCS-21",
    backupVersion: 1,
    createdAt: new Date().toISOString(),
    data
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `PGCS-21_Database_Backup_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  toast("Database Backup Download হয়েছে");
}
async function restoreDatabaseBackup(file) {
  if (!isAdmin()) return toast("শুধু Admin (IT) Restore করতে পারবেন");
  if (!file) return;
  try {
    const backup = JSON.parse(await file.text());
    if (backup?.app !== "PGCS-21" || backup?.backupVersion !== 1 || !backup.data || typeof backup.data !== "object") {
      throw new Error("এটি PGCS-21-এর সঠিক Backup file নয়");
    }
    const parsed = {};
    for (const key of BACKUP_KEYS) {
      if (!(key in backup.data) || typeof backup.data[key] !== "string") throw new Error("Backup file-এ প্রয়োজনীয় data নেই: " + key);
      parsed[key] = JSON.parse(backup.data[key]);
    }
    if (!Array.isArray(parsed[MKEY]) || !parsed[SKEY] || typeof parsed[SKEY] !== "object" || Array.isArray(parsed[SKEY]) ||
        !Array.isArray(parsed[KEY]) || !parsed[PWKEY] || typeof parsed[PWKEY] !== "object" || Array.isArray(parsed[PWKEY])) {
      throw new Error("Backup file-এর data format সঠিক নয়");
    }
    if (!confirm("বর্তমান Database-এর সব data Backup file-এর data দিয়ে প্রতিস্থাপিত হবে। Restore করার আগে বর্তমান data-এর Backup নিয়ে রাখুন। আপনি কি নিশ্চিত?")) return;
    BACKUP_KEYS.forEach(key => localStorage.setItem(key, backup.data[key]));
    if (!(await DB.flush())) throw new Error("অনলাইন Database-এ Restore সেভ হয়নি — ইন্টারনেট চেক করে আবার চেষ্টা করুন");
    alert("Database Restore সম্পন্ন হয়েছে। App পুনরায় চালু হবে।");
    location.reload();
  } catch (err) {
    alert("Restore করা যায়নি: " + (err?.message || "অজানা সমস্যা"));
  }
}

// ---------- Calculations ----------
const today = new Date(); today.setHours(0, 0, 0, 0);
const isPastDue = i => new Date(i.due + "T23:59:59") < new Date();
const sameMonth = i => i.due.slice(0, 7) === today.toISOString().slice(0, 7);
const paidOf = (mid, key, st = "Approved") => payments.filter(p => p.fy === fy() && p.mid === mid && p.inst === key && p.status === st).reduce((s, p) => s + p.amount, 0);

function cell(m, i) {
  const paid = paidOf(m.mid, i.key), draft = paidOf(m.mid, i.key, "Draft"), left = Math.max(0, i.amount - paid);
  let due = 0, html;
  if (paid >= i.amount) html = `<span class="chip bg-emerald-100 text-emerald-700">✓ ${paid}</span>`;
  else if (m.status === "Withdrawn" && !paid) html = `<span class="text-slate-300">—</span>`;
  else if (isPastDue(i)) { due = left; html = `<span class="chip bg-rose-100 text-rose-700">Due ${left}</span>`; }
  else html = paid ? `<span class="chip bg-sky-100 text-sky-700">${paid}/${i.amount}</span>` : `<span class="text-slate-400">${left}</span>`;
  if (draft) html += ` <span class="chip bg-amber-100 text-amber-700">Draft ${draft}</span>`;
  if (m.status === "Withdrawn" && !paid) due = 0;
  return { html, due, paid, left, draft };
}

// ---------- Dashboard ----------
function renderStats() {
  const ap = payments.filter(p => p.fy === fy() && p.status === "Approved");
  const dr = payments.filter(p => p.fy === fy() && p.status === "Draft");
  let overdue = 0, currentMonth = 0;

  // শুধু admin-এ unchecked নয় এমন installments দেখাবো
  const visibleInsts = insts().filter(i => !S.closed.includes(fy() + "|" + i.key));

  MEMBERS.forEach(m => {
    visibleInsts.forEach(i => {
      const c = cell(m, i);
      overdue += c.due;
      if (sameMonth(i) && m.status === "Active") currentMonth += c.left;
    });
  });

  const card = (t, v, c) => `<div class="bg-white p-4 rounded-xl border"><p class="text-xs text-slate-500">${t}</p><h3 class="text-xl font-bold mt-1 ${c}">${v}</h3></div>`;
  $("stats").innerHTML = card("মোট জমা (Approved)", fmt(ap.reduce((s, p) => s + p.amount, 0)), "text-emerald-600")
    + card("মোট বকেয়া (Due)", fmt(overdue), "text-rose-600")
    + card("চলতি মাসে পরিশোধযোগ্য", fmt(currentMonth), "text-amber-600")
    + card("Draft (অপেক্ষমাণ)", `${dr.length} টি / ${fmt(dr.reduce((s, p) => s + p.amount, 0))}`, "text-amber-600")
    + card("সক্রিয় সদস্য", `${MEMBERS.filter(m => m.status === "Active").length} / ${MEMBERS.length}`, "text-slate-800");

  const totals = visibleInsts.map(i => payments.filter(p => p.fy === fy() && p.inst === i.key && p.status === "Approved").reduce((s, p) => s + p.amount, 0));
  if (chart) chart.destroy();
  chart = new Chart($("monthlyChart"), { type: "bar", data: { labels: visibleInsts.map(i => i.key), datasets: [{ label: "BDT", data: totals, backgroundColor: "#10b981", borderRadius: 4 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } } });
}

function renderMembers() {
  const q = $("search-member").value.toLowerCase();
  const list = MEMBERS.filter(m => m.name.toLowerCase().includes(q) || m.mid.toLowerCase().includes(q));

  // শুধু admin-এ unchecked নয় এমন installments দেখাবো
  const visibleInsts = insts().filter(i => !S.closed.includes(fy() + "|" + i.key));

  let head = `<thead><tr><th>MID</th><th>Name</th><th>Total Paid</th><th>Current Month Due</th><th>Total Due</th>${visibleInsts.map(i => `<th>${i.key}</th>`).join("")}<th></th></tr></thead>`;
  const f = $("filter-status").value;
  const body = list.map(m => {
    let total = 0, due = 0, cur = 0, dr = 0;
    const cells = visibleInsts.map(i => { const c = cell(m, i); total += c.paid; due += c.due; dr += c.draft; if (sameMonth(i) && m.status === "Active") cur += c.left; return `<td>${c.html}</td>`; }).join("");
    if ((f === "DUE" && !due) || (f === "DRAFT" && !dr) || (f === "FULL" && (due || !total))) return "";
    return `<tr><td class="font-mono font-semibold">${m.mid}</td><td>${m.name}${m.status === "Withdrawn" ? ' <span class="chip bg-slate-200 text-slate-600">Withdrawn</span>' : ""}</td>
      <td class="font-bold">${fmt(total)}</td><td class="${cur ? "text-amber-600" : ""}">${fmt(cur)}</td>
      <td class="font-bold ${due ? "text-rose-600" : "text-emerald-600"}">${fmt(due)}</td>${cells}
      <td><button onclick="viewIndividual('${m.mid}')" class="text-blue-600 underline">Details</button></td></tr>`;
  }).join("");
  $("matrix").innerHTML = head + `<tbody>${body || '<tr><td colspan="9" class="p-4">কোনো সদস্য পাওয়া যায়নি</td></tr>'}</tbody>`;
}

function viewIndividual(mid) {
  const m = member(mid), rows = payments.filter(p => p.fy === fy() && p.mid === mid).sort((a, b) => a.date.localeCompare(b.date));
  const total = rows.filter(p => p.status === "Approved").reduce((s, p) => s + p.amount, 0);
  $("modal-title").textContent = `${m.name} (${mid}) — জমা: ${fmt(total)}`;
  $("modal-body").innerHTML = `<table class="w-full text-sm"><tr class="bg-slate-100 text-left"><th class="p-2">কিস্তি</th><th>Method</th><th>Date</th><th>Amount</th><th>Status</th><th>Comment</th></tr>` +
    (rows.map(p => `<tr class="border-b"><td class="p-2">${p.inst}</td><td>${p.method}</td><td>${p.date}</td><td>${fmt(p.amount)}</td><td>${statusChip(p.status)}</td><td>${p.comment || "-"}</td></tr>`).join("") || `<tr><td colspan="6" class="p-3 text-center">কোনো payment নেই</td></tr>`) + "</table>";
  $("modal-pdf").onclick = () => exportIndividualPDF(mid);
  $("individual-modal").classList.remove("hidden");
}
const closeModal = () => $("individual-modal").classList.add("hidden");
const statusChip = s => `<span class="chip ${s === "Approved" ? "bg-emerald-100 text-emerald-700" : s === "Rejected" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"}">${s}</span>`;

// ---------- Members' Detail ----------
function renderMemberDetail() {
  const currentMid = session.mid;
  const m = member(currentMid);

  if (!m) {
    $("member-detail-content").innerHTML = `<div class="bg-white p-6 rounded-xl border"><p class="text-center text-slate-500">Member information not found</p></div>`;
    return;
  }

  // Calculate payment statistics
  let totalPaid = 0, totalDue = 0;
  const visibleInsts = insts().filter(i => !S.closed.includes(fy() + "|" + i.key));
  const paymentDetails = visibleInsts.map(i => {
    const c = cell(m, i);
    totalPaid += c.paid;
    totalDue += c.due;
    return { inst: i, cell: c };
  });

  const dueInstallments = paymentDetails.filter(p => p.cell.due > 0);

  const canEditPersonal = !!session;
  $("member-detail-content").innerHTML = `
    <!-- Personal Information Card -->
    <div class="bg-white rounded-xl border p-6">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-xl font-bold text-slate-800">Personal Information</h3>
        <div class="flex gap-2">
          <span class="chip ${m.status === "Active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}">${m.status}</span>
          ${canEditPersonal ? `<button onclick="togglePersonalEdit()" class="bg-slate-700 hover:bg-slate-800 text-white text-xs px-3 py-1.5 rounded-lg">${personalEditMode ? "Cancel" : "Edit"}</button>` : ""}
          ${personalEditMode && canEditPersonal ? `<button onclick="savePersonalInfo()" class="bg-emerald-600 hover:bg-emerald-700 text-white text-xs px-3 py-1.5 rounded-lg">Save</button>` : ""}
        </div>
      </div>
      <div class="grid md:grid-cols-2 gap-4">
        <div>
          <p class="text-sm text-slate-500">Name</p>
          <p class="font-semibold">${m.name}</p>
        </div>
        <div>
          <p class="text-sm text-slate-500">Member ID (MID)</p>
          <p class="font-semibold font-mono">${m.mid}</p>
        </div>
        <div>
          <p class="text-sm text-slate-500">Role</p>
          <p class="font-semibold">${m.role}</p>
        </div>
        <div>
          <p class="text-sm text-slate-500">Account Number</p>
          <p class="font-semibold font-mono">${m.accountNo || "N/A"}</p>
        </div>
        <div>
          <p class="text-sm text-slate-500">Bank</p>
          <p class="font-semibold">${S.bank}</p>
        </div>
        <div>
          <p class="text-sm text-slate-500">Serial Number</p>
          <p class="font-semibold">${m.sl}</p>
        </div>
        <div>
          <p class="text-sm text-slate-500">Mobile Number</p>
          <p class="font-semibold font-mono">${m.mobile || "—"}</p>
        </div>
        ${personalEditMode ? `
        <div>
          <p class="text-xs text-slate-500">Nominee</p>
          <input type="text" id="pi-nominee" class="border rounded p-2 w-full text-sm" value="${m.nominee || ""}">
        </div>
        <div>
          <p class="text-xs text-slate-500">Relationship with Nominee</p>
          <input type="text" id="pi-relation" class="border rounded p-2 w-full text-sm" value="${m.nomineeRelation || ""}">
        </div>
        <div>
          <p class="text-xs text-slate-500">Nominee NID</p>
          <input type="text" id="pi-nid" class="border rounded p-2 w-full text-sm font-mono" value="${m.nomineeNID || ""}">
        </div>
        <div>
          <p class="text-xs text-slate-500">Mobile Number</p>
          <input type="text" id="pi-mobile" class="border rounded p-2 w-full text-sm" value="${m.mobile || ""}">
        </div>
        <div>
          <p class="text-xs text-slate-500">Present Address</p>
          <input type="text" id="pi-present" class="border rounded p-2 w-full text-sm" value="${m.presentAddress || ""}">
        </div>
        <div>
          <p class="text-xs text-slate-500">Permanent Address</p>
          <input type="text" id="pi-permanent" class="border rounded p-2 w-full text-sm" value="${m.permanentAddress || ""}">
        </div>
        ` : `
        <div>
          <p class="text-sm text-slate-500">Nominee</p>
          <p class="font-semibold">${m.nominee || "—"}</p>
        </div>
        <div>
          <p class="text-sm text-slate-500">Relationship with Nominee</p>
          <p class="font-semibold">${m.nomineeRelation || "—"}</p>
        </div>
        <div>
          <p class="text-sm text-slate-500">Nominee NID</p>
          <p class="font-semibold font-mono">${m.nomineeNID || "—"}</p>
        </div>
        <div>
          <p class="text-sm text-slate-500">Present Address</p>
          <p class="font-semibold">${m.presentAddress || "—"}</p>
        </div>
        <div>
          <p class="text-sm text-slate-500">Permanent Address</p>
          <p class="font-semibold">${m.permanentAddress || "—"}</p>
        </div>
        `}
      </div>
    </div>

    <!-- Payment Summary Card -->
    <div class="bg-white rounded-xl border p-6">
      <h3 class="text-xl font-bold text-slate-800 mb-4">Payment Summary (${fy()})</h3>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div class="bg-emerald-50 p-4 rounded-lg">
          <p class="text-xs text-emerald-700 mb-1">Total Paid</p>
          <p class="text-2xl font-bold text-emerald-700">${fmt(totalPaid)}</p>
        </div>
        <div class="bg-rose-50 p-4 rounded-lg">
          <p class="text-xs text-rose-700 mb-1">Total Due</p>
          <p class="text-2xl font-bold text-rose-700">${fmt(totalDue)}</p>
        </div>
        <div class="bg-sky-50 p-4 rounded-lg">
          <p class="text-xs text-sky-700 mb-1">Pending Approval</p>
          <p class="text-2xl font-bold text-sky-700">${payments.filter(p => p.fy === fy() && p.mid === currentMid && p.status === "Draft").length}</p>
        </div>
        <div class="bg-amber-50 p-4 rounded-lg">
          <p class="text-xs text-amber-700 mb-1">Due Installments</p>
          <p class="text-2xl font-bold text-amber-700">${dueInstallments.length}</p>
        </div>
      </div>
      ${dueInstallments.length > 0 ? `
        <div class="mt-4 p-4 bg-amber-50 rounded-lg border border-amber-200">
          <p class="text-sm font-semibold text-amber-800 mb-2">⚠️ Due Payments:</p>
          <p class="text-sm text-amber-700">${dueInstallments.map(p => `${instLabel(p.inst)}: ${fmt(p.cell.due)}`).join(", ")}</p>
        </div>
      ` : `
        <div class="mt-4 p-4 bg-emerald-50 rounded-lg border border-emerald-200">
          <p class="text-sm font-semibold text-emerald-700">✓ All payments up to date!</p>
        </div>
      `}
    </div>

    <!-- Payment History -->
    <div class="bg-white rounded-xl border p-6">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-xl font-bold text-slate-800">Payment History</h3>
        <button onclick="exportIndividualPDF('${currentMid}')" class="bg-sky-600 hover:bg-sky-700 text-white text-sm px-4 py-2 rounded-lg">📄 Download PDF</button>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-slate-100">
            <tr>
              <th class="p-3 text-left">Installment</th>
              <th class="p-3 text-left">Due Date</th>
              <th class="p-3 text-left">Amount</th>
              <th class="p-3 text-left">Paid</th>
              <th class="p-3 text-left">Due</th>
              <th class="p-3 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            ${paymentDetails.map(p => `
              <tr class="border-b hover:bg-slate-50">
                <td class="p-3">${instLabel(p.inst)}</td>
                <td class="p-3">${p.inst.due}</td>
                <td class="p-3 font-semibold">${fmt(p.inst.amount)}</td>
                <td class="p-3 ${p.cell.paid > 0 ? "text-emerald-700 font-semibold" : ""}">${fmt(p.cell.paid)}</td>
                <td class="p-3 ${p.cell.due > 0 ? "text-rose-700 font-semibold" : ""}">${p.cell.due > 0 ? fmt(p.cell.due) : "-"}</td>
                <td class="p-3">
                  ${p.cell.paid >= p.inst.amount
                    ? '<span class="chip bg-emerald-100 text-emerald-700">✓ Paid</span>'
                    : p.cell.due > 0
                      ? '<span class="chip bg-rose-100 text-rose-700">Due</span>'
                      : '<span class="chip bg-slate-100 text-slate-600">Upcoming</span>'}
                  ${p.cell.draft > 0 ? `<span class="chip bg-amber-100 text-amber-700 ml-1">Draft ${p.cell.draft}</span>` : ""}
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Security Settings -->
    <div class="bg-white rounded-xl border p-6">
      <h3 class="text-xl font-bold text-slate-800 mb-4">Security Settings</h3>
      <div class="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
        <div>
          <p class="font-semibold">Password</p>
          <p class="text-sm text-slate-500">Change your account password</p>
        </div>
        <button onclick="changePassword()" class="bg-slate-800 hover:bg-slate-900 text-white text-sm px-4 py-2 rounded-lg">Change Password</button>
      </div>
      <div class="mt-3 p-4 bg-blue-50 rounded-lg border border-blue-200">
        <p class="text-sm text-blue-800">💡 <strong>Password Tips:</strong> Use at least 6 characters. Keep your password secure and don't share it with others.</p>
      </div>
    </div>
  `;
}


// ---------- Personal Info Edit Helpers ----------
function togglePersonalEdit() { personalEditMode = !personalEditMode; renderMemberDetail(); }
function savePersonalInfo() {
  const fields = ["nominee", "nomineeRelation", "nomineeNID", "mobile", "presentAddress", "permanentAddress"];
  const ids = ["pi-nominee", "pi-relation", "pi-nid", "pi-mobile", "pi-present", "pi-permanent"];
  fields.forEach((f, i) => { updMember(session.mid, f, $(ids[i]).value.trim()); });
  personalEditMode = false;
  renderMemberDetail();
  toast("Personal information updated");
}

// ---------- Members' Directory ----------
function renderMemberDirectory() {
  const q = ($("member-search").value || "").toLowerCase().trim();
  const list = MEMBERS.filter(m => !q || m.mid.toLowerCase().includes(q) || m.name.toLowerCase().includes(q) || (m.accountNo || "").toLowerCase().includes(q));
  $("member-directory-body").innerHTML = list.map(m => `
    <tr class="border-b hover:bg-slate-50">
      <td class="p-3 text-slate-600">${m.sl}</td>
      <td class="p-3 font-mono text-slate-800">${m.mid}</td>
      <td class="p-3 font-semibold">${m.name}</td>
      <td class="p-3 text-slate-600">${m.nominee || "—"}</td>
      <td class="p-3 text-slate-600">${m.nomineeRelation || "—"}</td>
      <td class="p-3 font-mono text-slate-600">${m.nomineeNID || "—"}</td>
      <td class="p-3 text-slate-600">${m.presentAddress || "—"}</td>
      <td class="p-3 text-slate-600">${m.permanentAddress || "—"}</td>
      <td class="p-3 font-mono text-slate-600">${m.mobile || "—"}</td>
      <td class="p-3 font-mono text-slate-600">${m.accountNo || "—"}</td>
      <td class="p-3 text-slate-600">${m.role}</td>
      <td class="p-3"><span class="chip ${m.status === "Active" ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}">${m.status}</span></td>
    </tr>`).join("");
  if (q && list.length === 0) $("member-directory-body").innerHTML = '<tr><td colspan="11" class="p-4 text-center text-slate-500">কোনো সদস্য পাওয়া যায়নি</td></tr>';
  $("member-count").textContent = list.length + " সদস্য";
}

function downloadMembersDirectoryPDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(16);
  doc.text("PGCS-21 — Members' Directory", 14, 16);
  doc.setFontSize(11);
  doc.text("Members Directory — " + new Date().toLocaleDateString("en-GB"), 14, 26);
  const rows = MEMBERS.map(m => [m.sl, m.mid, m.name, m.nominee || "—", m.nomineeRelation || "—", m.nomineeNID || "—", m.presentAddress || "—", m.permanentAddress || "—", m.mobile || "—", m.accountNo || "—", m.role, m.status]);
  doc.autoTable({
    head: [["SL", "MID", "Name", "Nominee", "Relationship", "Nominee NID", "Present Address", "Permanent Address", "Mobile", "Account No", "Role", "Status"]],
    body: rows,
    startY: 36,
    theme: "striped",
    headStyles: { fillColor: [15, 118, 110] }
  });
  doc.save("PGCS-21_Members_Directory.pdf");
  toast("Members' Directory PDF downloaded");
}

// ---------- Entry ----------
function renderEntryOptions() {
  const open = S.formOpen || isAdmin();
  $("form-closed").classList.toggle("hidden", open); $("paymentForm").classList.toggle("hidden", !open);
  $("entry-method").innerHTML = S.methods.map(x => `<option>${x}</option>`).join("");
  renderInstallmentCheckboxes();
  renderAccountOptions();
  $("entry-bank").value = S.bank; syncAmount();
}
function renderInstallmentCheckboxes() {
  const container = $("installment-checkboxes");
  if (!container) return;

  const mid = isAdmin() ? $("entry-member").value : session.mid;
  // শুধু Entry Form-এ চেক করা (unclosed) কিস্তিগুলো দেখাবো
  const availableInsts = insts().filter(i => !S.closed.includes(fy() + "|" + i.key));

  container.innerHTML = availableInsts.map(i => {
    const paid = paidOf(mid, i.key);
    const isPaid = paid >= i.amount;
    const hasDraft = paidOf(mid, i.key, "Draft") > 0;

    return `<label class="flex items-center gap-2 text-sm ${isPaid ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-white'} p-2 rounded">
      <input type="checkbox"
        class="installment-checkbox"
        value="${i.key}"
        data-amount="${i.amount}"
        ${isPaid ? 'checked disabled' : ''}
        onchange="syncAmount()">
      <span>${i.key} (৳${i.amount})${isPaid ? ' ✓' : hasDraft ? ' ⏳' : ''}</span>
    </label>`;
  }).join("");
}
function accountNumbers() {
  return [...new Set([...DEFAULT_ACCOUNTS, ...S.accounts, ...MEMBERS.map(m => m.accountNo).filter(Boolean)])];
}
function renderAccountOptions(selected = $("entry-account").value) {
  const select = $("entry-account");
  select.replaceChildren();
  accountNumbers().forEach(account => {
    const option = document.createElement("option");
    option.value = account;
    option.textContent = account;
    select.append(option);
  });
  const addOption = document.createElement("option");
  addOption.value = "__add_account__";
  addOption.textContent = "+ Add account";
  select.append(addOption);
  select.value = accountNumbers().includes(selected) ? selected : "";
  lastSelectedAccount = select.value;
}
function fillAccount() {
  const m = member($("entry-member").value);
  if (m) {
    if (m.accountNo && !accountNumbers().includes(m.accountNo)) renderAccountOptions(m.accountNo);
    $("entry-account").value = m.accountNo || "";
  }
  // Member পরিবর্তন হলে installment checkboxes আবার render করতে হবে
  renderInstallmentCheckboxes();
  syncAmount();
}
function handleAccountChange() {
  const select = $("entry-account");
  if (select.value !== "__add_account__") {
    lastSelectedAccount = select.value;
    return;
  }
  const account = prompt("নতুন Account No দিন:");
  if (account === null) return renderAccountOptions(lastSelectedAccount);
  const value = account.trim();
  if (!/^\d+$/.test(value)) {
    renderAccountOptions(lastSelectedAccount);
    return toast("সঠিক Account No দিন (শুধু সংখ্যা)");
  }
  if (accountNumbers().includes(value)) {
    renderAccountOptions(value);
    return toast("এই Account No আগে থেকেই আছে");
  }
  S.accounts.push(value);
  saveS();
  renderAccountOptions(value);
}
function syncAmount() {
  const checkboxes = document.querySelectorAll(".installment-checkbox:checked:not([disabled])");
  let totalAmount = 0;
  checkboxes.forEach(cb => {
    totalAmount += Number(cb.dataset.amount || 0);
  });
  $("entry-amount").value = totalAmount || "";
}
function getSelectedInstallments() {
  const checkboxes = document.querySelectorAll(".installment-checkbox:checked:not([disabled])");
  return Array.from(checkboxes).map(cb => cb.value);
}
$("paymentForm").addEventListener("submit", e => {
  e.preventDefault();
  if (!canAccessPage("entry") || (!isAdmin() && $("entry-member").value !== session.mid)) return toast("আপনার Entry করার অনুমতি নেই");

  const selectedInstallments = getSelectedInstallments();
  if (selectedInstallments.length === 0) return toast("অন্তত একটি কিস্তি Select করুন");

  const mid = isAdmin() ? $("entry-member").value : session.mid;
  const method = $("entry-method").value;
  const date = $("entry-date").value;
  const totalAmount = Number($("entry-amount").value);
  const account = $("entry-account").value;
  const bank = $("entry-bank").value;
  const comment = $("entry-comment").value;
  const submittedBy = isAdmin() ? "admin" : session.mid;

  // প্রতিটি selected installment এর জন্য আলাদা payment entry তৈরি করা
  const timestamp = Date.now();
  selectedInstallments.forEach((instKey, index) => {
    const inst = insts().find(i => i.key === instKey);
    if (!inst) return;

    payments.push({
      id: timestamp + index,
      fy: fy(),
      mid,
      inst: instKey,
      method,
      date,
      amount: inst.amount,
      account,
      bank,
      comment: comment + (selectedInstallments.length > 1 ? ` (${selectedInstallments.join(", ")} একসাথে)` : ""),
      status: "Draft",
      submittedBy
    });
  });

  save();
  e.target.reset();
  renderEntryOptions();
  fillAccount();
  refreshAll();
  toast(`${selectedInstallments.length} টি কিস্তির জন্য Draft হিসেবে জমা হয়েছে — Admin approve করলে Final হবে`);
});

// ---------- Approvals ----------
function renderApprovals() {
  if (!isApprover()) return;
  const adminIT = isAdmin();
  $("approvals-title").textContent = adminIT ? "Pending Approvals" : "Draft Approval";
  const rows = payments.filter(p => p.status === "Draft");
  $("approvals-table").innerHTML = `<tr class="bg-slate-100"><th class="p-3">FY</th><th>সদস্য</th><th>কিস্তি</th><th>Date</th><th>Amount</th><th>Method</th><th>Status</th><th></th></tr>` +
    (rows.map(p => `<tr class="border-b"><td class="p-3">${p.fy}</td><td>${member(p.mid).name}</td><td>${p.inst}</td><td>${p.date}</td><td>${fmt(p.amount)}</td><td>${p.method}</td><td>${statusChip(p.status)}</td>
      <td class="space-x-2"><button onclick="setStatus(${p.id},'Approved')" class="text-emerald-700 font-semibold">Approve</button><button onclick="setStatus(${p.id},'Rejected')" class="text-amber-700">Reject</button>${adminIT ? `<button onclick="delPayment(${p.id})" class="text-rose-600">Delete</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="8" class="p-4 text-center text-slate-500">কিছু নেই</td></tr>`);
  const n = payments.filter(p => p.status === "Draft").length;
  $("nav-approvals-label").textContent = `Approvals (${n})`;
}
function setStatus(id, s) {
  if (!isApprover() || !["Approved", "Rejected"].includes(s)) return;
  const payment = payments.find(p => p.id === id && p.status === "Draft");
  if (!payment) return toast("শুধু Draft অনুমোদন বা Cancel করা যাবে");
  payment.status = s; save(); refreshAll(); toast(s);
}
function delPayment(id) {
  if (!isAdmin()) return;
  if (confirm("মুছে ফেলবেন?")) { payments = payments.filter(p => p.id !== id); save(); refreshAll(); }
}

// ---------- Reports ----------
function summaryRows() {
  return MEMBERS.map(m => {
    let paid = 0, due = 0; insts().forEach(i => { const c = cell(m, i); paid += c.paid; due += c.due; });
    return { m, paid, due };
  });
}
function dueMatrix() {
  return MEMBERS.map(m => {
    const per = insts().map(i => cell(m, i).due);
    const paid = insts().reduce((sum, i) => sum + cell(m, i).paid, 0);
    return { m, paid, per, due: per.reduce((sum, amount) => sum + amount, 0) };
  });
}
function exportFullExcel() {
  const wb = XLSX.utils.book_new(), rows = summaryRows();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.map(r => ({ "SL NO.": r.m.sl, MID: r.m.mid, Name: r.m.name, "Paid (Taka)": r.paid, "Due (Taka)": r.due, Status: r.m.status }))), `${fy()} Total`);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dueMatrix().map(x => ({ MID: x.m.mid, Name: x.m.name, Paid: x.paid, ...Object.fromEntries(insts().map((i, k) => [i.key + " Due", x.per[k]])), "Total Due": x.due }))), "Month-wise Due");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(payments.filter(p => p.fy === fy()).map(p => ({ MID: p.mid, Name: member(p.mid).name, Installment: p.inst, Method: p.method, Date: p.date, Amount: p.amount, Bank: p.bank, Comment: p.comment, Status: p.status }))), "Payments");
  XLSX.writeFile(wb, `PGCS_${fy()}.xlsx`);
}
const instLabel = i => { if (!/^\d/.test(i.due) || i.key === "BPPF" || i.key === "Membership Fee") return i.key; const d = new Date(i.due + "T00:00:00"); return d.toLocaleString("en", { month: "long" }) + "/" + String(d.getFullYear()).slice(2); };
function pdfHead(doc, title) {
  const W = doc.internal.pageSize.getWidth(), lw = 130, lh = lw * LH.h / LH.w;
  doc.addImage(LH.data, "PNG", (W - lw) / 2, 8, lw, lh);
  let y = 8 + lh + 14; doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.text(title, W / 2, y, { align: "center" });
  doc.setFontSize(9);
  ["Bank Name: BASIC Bank PLC", "Account No: 2914-010019169", "Account Name: MD. NAZIM UDDIN and SOIKOT RAIHAN, MD. SAKIB SHAHRIYER", "Account Type: Joint Account (SBA)"].forEach((t, k) => doc.text(t, 14, y + 10 + k * 6));
  return y + 38;
}
const tblStyle = { theme: "grid", styles: { fontSize: 8.5, halign: "center", valign: "middle", lineColor: [0, 0, 0], lineWidth: 0.2, textColor: 0 },
  headStyles: { fillColor: [22, 96, 130], textColor: 255 }, bodyStyles: { fillColor: [255, 255, 255] }, alternateRowStyles: { fillColor: [190, 230, 247] } };
function signBlock(doc) {
  let y = doc.lastAutoTable.finalY + 22; if (y > 255) { doc.addPage(); y = 30; }
  const W = doc.internal.pageSize.getWidth(); doc.setFontSize(9);
  doc.setFont("helvetica", "bold"); doc.text("Prepared and Checked By", 30, y); doc.text("Checked and Approved By", W - 75, y);
  doc.setFont("helvetica", "normal");
  [["Soikot Raihan", "Member and Account Holder", "MID: PGCS-2105", 45], ["Imran Hassan", "President", "MID: PGCS-2101", W - 60]].forEach(([n, r, m, x]) => {
    doc.text(n, x, y + 24, { align: "center" }); doc.text(r, x, y + 30, { align: "center" }); doc.text(m, x, y + 36, { align: "center" }); });
}
function dueText(m) {
  const d = insts().map(i => ({ l: instLabel(i), v: cell(m, i).due })).filter(x => x.v > 0);
  if (!d.length) return "";
  const names = d.length > 1 ? d.slice(0, -1).map(x => x.l).join(", ") + " & " + d[d.length - 1].l : d[0].l;
  return `${names} Payment Due (${d.reduce((s, x) => s + x.v, 0)}/-)`;
}
function exportSummaryPDF() {
  const doc = new jsPDF(), y = pdfHead(doc, `The Amount of Payments in the ${fy()} Financial Year`);
  const rows = dueMatrix().filter(x => x.m.status === "Active" || x.paid > 0);
  doc.autoTable({ ...tblStyle, startY: y, head: [["SL NO.", "MID", "Name", "Amount (Taka)", "Comment"]],
    body: [...rows.map(x => [String(x.m.sl).padStart(2, "0"), x.m.mid, x.m.name, x.paid + "/-", dueText(x.m) + (x.m.status === "Withdrawn" ? " Withdraw Membership" : "")]),
      [{ content: "Total", colSpan: 3, styles: { halign: "right", fontStyle: "bold" } }, { content: rows.reduce((s, x) => s + x.paid, 0) + "/-", styles: { fontStyle: "bold" } }, ""]],
    columnStyles: { 2: { halign: "left" }, 4: { cellWidth: 60 } } });
  signBlock(doc); doc.save(`PGCS_${fy()}_Summary.pdf`);
}
function exportIndividualPDF(mid) {
  const m = member(mid), doc = new jsPDF(), y = pdfHead(doc, `Individual Payment Statement (${fy()})`);
  doc.setFontSize(9); doc.text(`Name: ${m.name}   |   MID: ${m.mid}   |   A/C: ${m.accountNo}   |   Status: ${m.status}`, 14, y - 6);
  let paid = 0, due = 0;
  const body = insts().map(i => { const c = cell(m, i), ps = payments.filter(p => p.fy === fy() && p.mid === mid && p.inst === i.key); paid += c.paid; due += c.due;
    return [instLabel(i), i.due, i.amount, c.paid, c.due, (c.paid >= i.amount ? "Paid" : c.due ? "Due" : "Upcoming") + (c.draft ? ` (Draft ${c.draft})` : ""), ps.map(p => `${p.date} ${p.method}${p.status !== "Approved" ? " [" + p.status + "]" : ""}`).join("; ") || "-"]; });
  doc.autoTable({ ...tblStyle, startY: y, styles: { ...tblStyle.styles, fontSize: 7.5 }, head: [["Installment", "Due Date", "Amount", "Paid", "Due", "Status", "Payment Details"]],
    body: [...body, [{ content: "Total", colSpan: 3, styles: { halign: "right", fontStyle: "bold" } }, paid, due, "", ""]] });
  signBlock(doc); doc.save(`PGCS_${fy()}_${mid}_Statement.pdf`);
}
function exportMonthlyPDF() {
  const k = $("report-month-select").value, i = insts().find(x => x.key === k), doc = new jsPDF(), y = pdfHead(doc, `${instLabel(i)} Installment Report`);
  doc.autoTable({ ...tblStyle, startY: y, head: [["SL NO.", "MID", "Name", "Method", "Date", "Paid", "Due"]],
    body: MEMBERS.filter(m => m.status === "Active" || cell(m, i).paid).map(m => { const ps = payments.filter(p => p.fy === fy() && p.mid === m.mid && p.inst === k && p.status === "Approved"), c = cell(m, i);
      return [String(m.sl).padStart(2, "0"), m.mid, m.name, ps.map(p => p.method).join(", ") || "-", ps.map(p => p.date).join(", ") || "-", c.paid + "/-", c.due ? c.due + "/-" : "-"]; }),
    columnStyles: { 2: { halign: "left" } } });
  signBlock(doc); doc.save(`PGCS_${k}_Report.pdf`);
}
function exportDashboardTablePDF() {
  const doc = new jsPDF(), y = pdfHead(doc, `Member Payment Status - ${fy()} Financial Year`);

  // Filter করা members (search এবং status filter অনুযায়ী)
  const q = $("search-member").value.toLowerCase();
  const filterStatus = $("filter-status").value;
  const visibleInsts = insts().filter(i => !S.closed.includes(fy() + "|" + i.key));

  const filteredMembers = MEMBERS.filter(m => {
    if (q && !(m.name.toLowerCase().includes(q) || m.mid.toLowerCase().includes(q))) return false;

    let total = 0, due = 0, draft = 0;
    visibleInsts.forEach(i => {
      const c = cell(m, i);
      total += c.paid;
      due += c.due;
      draft += c.draft;
    });

    if (filterStatus === "DUE" && !due) return false;
    if (filterStatus === "DRAFT" && !draft) return false;
    if (filterStatus === "FULL" && (due || !total)) return false;

    return true;
  });

  // Table header
  const headers = ["MID", "Name", "Total Paid", "Total Due", "Comments"];

  // Table body
  const body = filteredMembers.map(m => {
    let totalPaid = 0, totalDue = 0;
    const dueDetails = [];

    visibleInsts.forEach(i => {
      const c = cell(m, i);
      totalPaid += c.paid;
      totalDue += c.due;

      // Due থাকলে comment-এ যোগ করা
      if (c.due > 0) {
        dueDetails.push(`${instLabel(i)}: ${c.due}/-`);
      }
    });

    // Comment text তৈরি করা
    let comment = "";
    if (dueDetails.length > 0) {
      comment = dueDetails.join(", ") + " Payment Due";
    } else if (totalPaid > 0) {
      comment = "All Payments Completed";
    } else {
      comment = "No Payments Yet";
    }

    if (m.status === "Withdrawn") {
      comment += " | Withdraw Membership";
    }

    return [
      m.mid,
      m.name,
      totalPaid + "/-",
      totalDue + "/-",
      comment
    ];
  });

  // Add totals row
  const totalPaid = filteredMembers.reduce((sum, m) => {
    return sum + visibleInsts.reduce((s, i) => s + cell(m, i).paid, 0);
  }, 0);
  const totalDue = filteredMembers.reduce((sum, m) => {
    return sum + visibleInsts.reduce((s, i) => s + cell(m, i).due, 0);
  }, 0);

  body.push([
    { content: "Total", colSpan: 2, styles: { halign: "right", fontStyle: "bold" } },
    { content: totalPaid + "/-", styles: { fontStyle: "bold" } },
    { content: totalDue + "/-", styles: { fontStyle: "bold" } },
    ""
  ]);

  doc.autoTable({
    ...tblStyle,
    startY: y,
    head: [headers],
    body: body,
    styles: { ...tblStyle.styles, fontSize: 8 },
    columnStyles: {
      0: { cellWidth: 28, halign: "center" },
      1: { cellWidth: 40, halign: "left" },
      2: { cellWidth: 25, halign: "center" },
      3: { cellWidth: 25, halign: "center" },
      4: { cellWidth: 65, halign: "left" }
    }
  });

  signBlock(doc);
  doc.save(`PGCS_${fy()}_Dashboard_Table.pdf`);
  toast("Dashboard Table PDF Downloaded");
}
const { jsPDF } = window.jspdf;

// ---------- Navigation ----------
function showPage(id) {
  if (!canAccessPage(id)) return toast("No permission to view this page");
  document.querySelectorAll(".page-section").forEach(s => s.classList.add("hidden"));
  $("page-" + id).classList.remove("hidden");
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
  $("nav-" + id).classList.add("active");
  if (id === "member-detail") {
    renderMemberDetail();
    const role = currentRole();
    const showDir = role === "adminIT" || role === "admin";
    $("member-directory-container").classList.toggle("hidden", !showDir);
    if (showDir) renderMemberDirectory();
  }
}
function renderAdmin() {
  if (!isAdmin()) return;
  const k = i => fy() + "|" + i.key;
  $("admin-form").innerHTML = `<div class="border rounded-xl p-3 mb-4 bg-slate-50"><p class="font-semibold mb-2">Database Backup & Restore</p>
    <div class="flex flex-wrap gap-2"><button type="button" class="bg-emerald-600 text-white rounded-lg px-3 py-2" onclick="downloadDatabaseBackup()">⬇ Download Database Backup</button>
    <label class="bg-blue-600 text-white rounded-lg px-3 py-2 cursor-pointer">⬆ Restore Database Backup<input type="file" accept=".json,application/json" class="hidden" onchange="restoreDatabaseBackup(this.files[0]);this.value=''"></label></div>
    <p class="text-xs text-slate-600 mt-2">Backup file-এ সদস্য, Payment, Settings এবং Password data থাকবে। নিরাপদ স্থানে রাখুন। Restore করলে বর্তমান data প্রতিস্থাপিত হবে।</p></div>
    <div class="border rounded-xl p-3 mb-4 bg-slate-50">
      <p class="font-semibold mb-2">Add New Member</p>
      <div class="grid md:grid-cols-2 gap-3">
        <div><label class="lbl">MID (Username)</label><input class="inp" id="m-mid" value="" onchange="validateAddMember()"></div>
        <div><label class="lbl">Name</label><input class="inp" id="m-name" value="" onchange="validateAddMember()"></div>
        <div><label class="lbl">Membership Role</label><input class="inp" id="m-role" value="Member" onchange="validateAddMember()"></div>
        <div><label class="lbl">Role Name</label>
          <select class="border rounded p-1 w-full" id="m-roleName" onchange="validateAddMember()">${Object.entries(ACCESS_ROLES).map(([v,l])=>`<option value="${v}">${l}</option>`).join("")}</select></div>
        <div><label class="lbl">Status</label>
          <select class="border rounded p-1 w-full" id="m-status" onchange="validateAddMember()"><option value="Active">Active</option><option value="Withdrawn">Withdrawn</option></select></div>
        <div><label class="lbl">Password (6+ chars)</label><input type="password" class="inp" id="m-pw" placeholder="Leave blank for default" onchange="validateAddMember()"></div>
        <div><label class="lbl">Mobile Number</label><input class="inp" id="m-mobile" value="" onchange="validateAddMember()"></div>
        <div><label class="lbl">Login</label><input type="checkbox" id="m-login" checked onchange="validateAddMember()"></div>
      </div>
      <button onclick="doAddMember()" class="bg-emerald-600 text-white text-sm px-4 py-2 rounded-lg mt-2">+ Add Member</button>
    </div>
    <label class="text-sm"><input type="checkbox" ${S.formOpen ? "checked" : ""} onchange="setS('formOpen',this.checked)"> Enable Entry Form for Members</label>
    <div class="grid md:grid-cols-2 gap-3 my-3"><div><label class="lbl">Payment Method (comma separated)</label><input class="inp" value="${S.methods.join(", ")}" onchange="setS('methods',this.value.split(',').map(x=>x.trim()).filter(Boolean))"></div>
    <div><label class="lbl">Default Bank</label><input class="inp" value="${S.bank}" onchange="setS('bank',this.value)"></div></div>
    <div class="flex items-center justify-between mb-2"><p class="text-sm font-semibold">${fy()} — Installment Management</p>
    <button onclick="addInstallment()" class="bg-emerald-600 text-white text-xs px-3 py-1.5 rounded-lg">+ Add New Installment</button></div>
    <div class="overflow-x-auto border rounded-lg"><table class="w-full text-xs"><thead class="bg-slate-100"><tr><th class="p-2 text-left">Installment Name</th><th class="text-left">Due Date</th><th class="text-left">Amount (TK)</th><th class="text-center">Show in Entry Form</th><th></th></tr></thead>
    <tbody>${insts().map(i => `<tr class="border-b"><td class="p-2"><input type="text" class="border rounded px-2 py-1 w-full" value="${i.key}" onchange="editInstName('${i.key}',this.value)"></td>
      <td><input type="date" class="border rounded px-2 py-1" value="${i.due}" onchange="editInstDue('${i.key}',this.value)"></td>
      <td><input type="number" class="border rounded px-2 py-1 w-28" value="${i.amount}" onchange="setAmt('${k(i)}',this.value)"></td>
      <td class="text-center"><input type="checkbox" ${S.closed.includes(k(i)) ? "" : "checked"} onchange="toggleInst('${k(i)}',this.checked)"></td>
      <td><button onclick="deleteInstallment('${i.key}')" class="text-rose-600 hover:underline">Delete</button></td></tr>`).join("")}</tbody></table></div>`;
  const inp = (mid, f, v, w = "w-32") => `<input class="border rounded p-1 ${w}" value="${v}" onchange="updMember('${mid}','${f}',this.value)">`;
  $("admin-users").innerHTML = `<tr class="bg-slate-100"><th class="p-2">MID (Username)</th><th>Name</th><th>Account No</th><th>Membership Role</th><th>Role Name</th><th>Status</th><th>Password</th><th>Login</th><th>Mobile</th><th></th></tr>` +
    MEMBERS.map(m => `<tr class="border-b"><td class="p-2 font-mono">${m.mid}</td><td>${inp(m.mid, "name", m.name, "w-44")}</td><td>${inp(m.mid, "accountNo", m.accountNo)}</td><td>${inp(m.mid, "role", m.role, "w-40")}</td>
      <td><select class="border rounded p-1" onchange="setAccessRole('${m.mid}',this.value)">${Object.entries(ACCESS_ROLES).map(([value, label]) => `<option value="${value}" ${accessRole(m) === value ? "selected" : ""}>${label}</option>`).join("")}</select></td>
      <td><select class="border rounded p-1" onchange="updMember('${m.mid}','status',this.value)"><option ${m.status === "Active" ? "selected" : ""}>Active</option><option ${m.status === "Withdrawn" ? "selected" : ""}>Withdrawn</option></select></td>
      <td>${pw[m.mid] ? "Custom" : "Default"} <button class="text-blue-600 underline" onclick="setPw('${m.mid}')">Set</button> <button class="text-slate-500 underline" onclick="resetPw('${m.mid}')">Reset</button></td>
      <td><label><input type="checkbox" ${m.loginOff ? "" : "checked"} onchange="updMember('${m.mid}','loginOff',!this.checked)"> Login</label></td>
      <td><button class="text-rose-600" onclick="delMember('${m.mid}')">Delete</button></td></tr>`).join("");
}
function setS(k, v) { if (!isAdmin()) return; S[k] = v; saveS(); renderEntryOptions(); toast("Saved"); }
function toggleInst(k, on) { if (!isAdmin()) return; S.closed = S.closed.filter(x => x !== k); if (!on) S.closed.push(k); saveS(); renderEntryOptions(); refreshAll(); }
function setAmt(k, v) { if (!isAdmin()) return; S.amt[k] = Number(v); saveS(); applyAmounts(); refreshAll(); toast("Saved"); }
function addInstallment() {
  if (!isAdmin()) return;
  const key = prompt("Enter New Installment Name (e.g., July, BPPF):");
  if (!key || !key.trim()) return;
  const trimmedKey = key.trim();
  if (insts().find(i => i.key === trimmedKey)) return toast("Installment name already exists");
  const due = prompt("Due Date (YYYY-MM-DD ফরম্যাটে, যেমন: 2025-07-25):");
  if (!due || !/^\d{4}-\d{2}-\d{2}$/.test(due)) return toast("Enter correct date (YYYY-MM-DD)");
  const amount = prompt("Amount (টাকা):");
  if (!amount || isNaN(amount) || Number(amount) <= 0) return toast("সঠিক টাকার পরিমাণ দিন");
  YEARS[fy()].push({ key: trimmedKey, due, amount: Number(amount) });
  S.amt[fy() + "|" + trimmedKey] = Number(amount);
  saveS();
  refreshAll();
  toast("নতুন কিস্তি যোগ হয়েছে");
}
function editInstName(oldKey, newKey) {
  if (!isAdmin() || !newKey || !newKey.trim()) return;
  const trimmedKey = newKey.trim();
  if (trimmedKey === oldKey) return;
  if (insts().find(i => i.key === trimmedKey)) {
    renderAdmin();
    return toast("Installment name already exists");
  }
  const inst = insts().find(i => i.key === oldKey);
  if (!inst) return;
  inst.key = trimmedKey;
  const oldK = fy() + "|" + oldKey;
  const newK = fy() + "|" + trimmedKey;
  if (S.amt[oldK]) { S.amt[newK] = S.amt[oldK]; delete S.amt[oldK]; }
  if (S.closed.includes(oldK)) { S.closed = S.closed.filter(x => x !== oldK); S.closed.push(newK); }
  payments.forEach(p => { if (p.fy === fy() && p.inst === oldKey) p.inst = trimmedKey; });
  save();
  saveS();
  refreshAll();
  toast("Installment name changed");
}
function editInstDue(key, newDue) {
  if (!isAdmin() || !newDue || !/^\d{4}-\d{2}-\d{2}$/.test(newDue)) return;
  const inst = insts().find(i => i.key === key);
  if (!inst) return;
  inst.due = newDue;
  saveS();
  refreshAll();
  toast("Due Date আপডেট হয়েছে");
}
function deleteInstallment(key) {
  if (!isAdmin()) return;
  if (payments.some(p => p.fy === fy() && p.inst === key)) {
    return toast("এই কিস্তির Payment আছে — মুছে ফেলা যাবে না");
  }
  if (!confirm(`"${key}" কিস্তি মুছে ফেলবেন?`)) return;
  const idx = insts().findIndex(i => i.key === key);
  if (idx !== -1) {
    insts().splice(idx, 1);
    const k = fy() + "|" + key;
    delete S.amt[k];
    S.closed = S.closed.filter(x => x !== k);
    saveS();
    refreshAll();
    toast("কিস্তি মুছে ফেলা হয়েছে");
  }
}
function updMember(mid, f, v) {
  if (!["name", "accountNo", "role", "status", "loginOff", "mobile", "nominee", "nomineeRelation", "nomineeNID", "presentAddress", "permanentAddress"].includes(f)) return;
if (!isAdmin() && !["mobile", "nominee", "nomineeRelation", "nomineeNID", "presentAddress", "permanentAddress"].includes(f)) return;
  const m = member(mid);
  if (!m) return toast("সদস্য পাওয়া যায়নি");
  if (f === "loginOff" && v && accessRole(m) === "adminIT" && MEMBERS.filter(x => accessRole(x) === "adminIT").length === 1) {
    renderAdmin();
    return toast("একমাত্র Admin (IT)-এর Login বন্ধ করা যাবে না");
  }
  m[f] = v; saveMembers(); refreshAll();
}
function setAccessRole(mid, role) {
  if (!isAdmin() || !Object.hasOwn(ACCESS_ROLES, role)) return;
  const m = member(mid);
  if (!m) return toast("সদস্য পাওয়া যায়নি");
  if (accessRole(m) === "adminIT" && role !== "adminIT" && MEMBERS.filter(x => accessRole(x) === "adminIT").length === 1) {
    renderAdmin();
    return toast("অন্তত একজন Admin (IT) থাকতে হবে");
  }
  m.accessRole = role;
  saveMembers();
  if (session?.mid === mid) {
    session.role = role;
    sessionStorage.setItem("pgcs_session", JSON.stringify(session));
    startApp();
  } else {
    refreshAll();
  }
}
function setPw(mid) { if (!isAdmin()) return; const p = prompt(`${mid} - New password (6+ chars):`); if (p && p.length >= 6) { pw[mid] = p; localStorage.setItem(PWKEY, JSON.stringify(pw)); renderAdmin(); toast("Password সেট হয়েছে"); } }
function resetPw(mid) { if (!isAdmin()) return; delete pw[mid]; localStorage.setItem(PWKEY, JSON.stringify(pw)); renderAdmin(); toast("Default password (" + DEFAULT_MEMBER_PASS + ")"); }
function doAddMember() {
  if (!isAdmin()) return;
  const mid = $("#m-mid").value.trim();
  if (!mid || member(mid)) return toast("MID is not valid or already exists");
  const name = $("#m-name").value.trim();
  if (!name) return toast("Name is required");
  const role = $("#m-role").value.trim() || "Member";
  const accessRole = $("#m-roleName").value;
  const status = $("#m-status").value;
  if (!["Active", "Withdrawn"].includes(status)) return toast("Choose correct Status");
  const password = $("#m-pw").value.trim();
  const mobile = $("#m-mobile").value.trim();
  const loginOff = !$("#m-login").checked;
  const newMember = {
    sl: Math.max(...MEMBERS.map(m => m.sl)) + 1,
    mid, name, accountNo: "", mobile, status, role, accessRole, loginOff
  };
  MEMBERS.push(newMember);
  saveMembers();
  if (password.length >= 6) {
    pw[mid] = password;
    localStorage.setItem(PWKEY, JSON.stringify(pw));
  }
  $("#m-mid").value = "";
  $("#m-name").value = "";
  $("#m-role").value = "Member";
  $("#m-pw").value = "";
  $("#m-mobile").value = "";
  $("#m-login").checked = true;
  renderAdmin();
  toast("New member added successfully");
}

function validateAddMember() {
  const mid = $("#m-mid").value.trim();
  if (mid && member(mid)) return toast("MID already exists");
  const name = $("#m-name").value.trim();
  if (!name) return toast("Name is required");
  const status = $("#m-status").value;
  if (!["Active", "Withdrawn"].includes(status)) return toast("Choose correct Status");
}

function addMember() {
  if (!isAdmin()) return;
  doAddMember();
}
function delMember(mid) {
  if (!isAdmin()) return;
  const m = member(mid);
  if (m && accessRole(m) === "adminIT" && MEMBERS.filter(x => accessRole(x) === "adminIT").length === 1) return toast("The only Admin (IT) cannot be deleted");
  if (payments.some(p => p.mid === mid)) return toast("Payment থাকা সদস্য মোছা যাবে না — Status 'Withdrawn' করুন");
  if (confirm(mid + " মুছবেন?")) { MEMBERS.splice(MEMBERS.findIndex(m => m.mid === mid), 1); saveMembers(); refreshAll(); }
}
function refreshAll() { renderStats(); renderMembers(); renderApprovals(); renderAdmin(); }

function startApp() {
  const currentMember = member(session?.mid);
  if (!currentMember) {
    sessionStorage.removeItem("pgcs_session");
    session = null;
    $("app").classList.add("hidden");
    $("login-screen").classList.remove("hidden");
    return;
  }
  session.role = accessRole(currentMember);
  sessionStorage.setItem("pgcs_session", JSON.stringify(session));
  $("login-screen").classList.add("hidden"); $("app").classList.remove("hidden");
  $("who").textContent = `${ACCESS_ROLES[currentRole()]} — ${currentMember.name} (${session.mid})`;
  $("reset-btn").classList.toggle("hidden", !isAdmin());
  ["dashboard", "entry", "approvals", "admin", "reports"].forEach(page => {
    $("nav-" + page).classList.toggle("hidden", !canAccessPage(page));
  });
  $("fy-select").innerHTML = Object.keys(YEARS).reverse().map(y => `<option>${y}</option>`).join("");
  const opts = () => insts().map(i => `<option>${i.key}</option>`).join("");
  $("fy-select").onchange = () => { renderEntryOptions(); $("report-month-select").innerHTML = opts(); syncAmount(); refreshAll(); };
  $("entry-member").innerHTML = (isAdmin() ? MEMBERS : [member(session.mid)]).map(m => `<option value="${m.mid}">${m.name} (${m.mid})</option>`).join("");
  $("entry-member").disabled = !isAdmin(); $("entry-member").onchange = fillAccount;
  $("entry-account").onchange = handleAccountChange;
  $("report-member-select").innerHTML = MEMBERS.map(m => `<option value="${m.mid}">${m.name} (${m.mid})</option>`).join("");
  $("entry-note").textContent = isAdmin() ? "Admin (IT) হিসেবে যেকোনো সদস্যের entry দিতে পারবেন; approve না করা পর্যন্ত Draft থাকবে।" : "আপনি শুধু নিজের payment যোগ করতে পারবেন। Admin অনুমোদন করলে Final database-এ দেখাবে।";
  $("fy-select").onchange();
  fillAccount();
  showPage(isAdmin() ? "dashboard" : currentRole() === "admin" ? "approvals" : "entry");
}
if (session) startApp();
