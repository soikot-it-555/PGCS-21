// Real Chromium end-to-end test of the real index.html + scripts against the in-process fake Supabase.
// Browser timezone = Asia/Dhaka (UTC+6), clock fixed at 2026-11-15.
// Tailwind is built locally (tests/tw-local.js); Chart.js, SheetJS, jsPDF and supabase-js are stubbed => PDF/Excel files and Realtime websockets are NOT exercised.
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium } = require("/opt/npm-tools/node_modules/playwright");
const { Server } = require("./harness.js");
const root = path.join(__dirname, "..");
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png" };
const results = []; let failed = 0;
const ok = (name, cond, extra = "") => { results.push([cond ? "PASS" : "FAIL", name + (cond ? "" : " :: " + extra)]); if (!cond) failed++; };
(async () => {
  const tailwindCss = await require("./tw-local.js")(root);
  const server = new Server();
  // supabase-migration-v3.sql pre-creates these two documents (CAS updates need an existing row)
  for (const k of ["pgcs_income_years_v1", "pgcs_payment_audit_v1"]) server.t.app_state.set(k, { key: k, value: [], version: 1, created_at: new Date().toISOString() + "0000" + k.length, updated_at: new Date().toISOString() });
  const web = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split("?")[0]).replace(/^\/$/, "/index.html")); if (!f.startsWith(root) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { "Content-Type": mime[path.extname(f)] || "application/octet-stream" }); r.end(fs.readFileSync(f)); }).listen(0);
  const base = "http://127.0.0.1:" + web.address().port + "/index.html";
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome", args: ["--no-sandbox"] });
  const device = async (name, mid, vp = { width: 1280, height: 900 }) => {
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: vp, timezoneId: "Asia/Dhaka", reducedMotion: "reduce" });
    await ctx.clock.setFixedTime(new Date("2026-11-15T12:00:00+06:00"));
    await ctx.route("**/rest/v1/**", async route => { const q = route.request(), h = q.headers(); const res = await server.handle(q.url(), { method: q.method(), headers: { Prefer: h.prefer || "" }, body: q.postData() || undefined }); await route.fulfill({ status: res.status, body: await res.text(), contentType: "application/json" }); });
    await ctx.route(/cdn\.tailwindcss/, route => route.fulfill({ status: 200, contentType: "text/javascript", body: `(()=>{const s=document.createElement("style");s.textContent=${JSON.stringify(tailwindCss)};document.head.appendChild(s)})()` }));
    await ctx.route(/cdn\.jsdelivr|cdnjs/, route => { const u = route.request().url(); const js = /chart/.test(u) ? "window.Chart=class{constructor(){}destroy(){}};" : /xlsx/.test(u) ? "window.XLSX={utils:{}};" : /jspdf/.test(u) ? "window.jspdf={jsPDF:function(){}};" : ""; route.fulfill({ status: 200, contentType: "text/javascript", body: js }); });
    const P = await ctx.newPage(); P.on("pageerror", e => { console.log(`[${name}] PAGE ERROR:`, e.message); ok(`${name}: no JS error`, false, e.message); });
    P.on("dialog", d => d.accept(d.type() === "prompt" ? "ভুল Entry — test" : undefined));
    await P.goto(base); await P.waitForFunction(() => window.__appReady === true, null, { timeout: 15000 });
    if (name === "A") {   // login screen: dropdown of Active members
      const opts = await P.evaluate(() => [...document.querySelectorAll("#login-user option")].map(o => [o.value, o.textContent]));
      const active = await P.evaluate(() => MEMBERS.filter(m => m.status === "Active").map(m => m.mid));
      const wd = await P.evaluate(() => MEMBERS.filter(m => m.status !== "Active").map(m => m.mid));
      ok("Login: user field is a dropdown listing every Active member as 'Name — MID'", await P.evaluate(() => document.getElementById("login-user").tagName) === "SELECT" && opts.length === active.length + 1 && active.every(m => opts.some(o => o[0] === m && o[1].endsWith("— " + m))), JSON.stringify(opts.slice(0, 3)));
      ok("Login: non-active (Withdrawn/Cancelled) members are not listed", wd.length > 0 && wd.every(m => !opts.some(o => o[0] === m)), JSON.stringify(wd));
      await P.selectOption("#login-user", "PGCS-2105"); await P.fill("#login-pass", "wrong"); await P.click("#loginForm button:has-text('Login')");
      ok("Login: wrong password still rejected", !(await P.locator("#login-err").evaluate(e => e.classList.contains("hidden"))));
    }
    await P.selectOption("#login-user", mid); await P.fill("#login-pass", "pgcs1234"); await P.click("#loginForm button:has-text('Login')"); await P.waitForSelector("#app:not(.hidden)");
    return P;
  };
  try {
    const A = await device("A", "PGCS-2105"), ev = c => A.evaluate(c), T = "todayISO()";
    ok("Statement balances on the repository data (Assets = Liabilities + Equity)", await ev(`finCompute(${T},'ALL').diff`) === 0, String(await ev(`finCompute(${T},'ALL').diff`)));
    ok("Statement balances on several dates / years", await ev(`['2026-08-09','2026-09-30','2027-03-01','2027-10-01'].every(d=>finCompute(d,'ALL').diff===0 && finCompute(d,'2026-27').diff===0)`));
    ok("Every member: Dashboard cell-sum == Statement receivable == receivableRows", await ev(`(()=>{const k=document.getElementById('fy-select').value,R=finCompute(${T},'ALL'),rr=receivableRows(${T});let bad=0;for(const x of R.rows){let s=0;for(const y of Object.keys(YEARS)){document.getElementById('fy-select').value=y;YEARS[y].filter(i=>i.key!=='Membership Fee').forEach(i=>{s+=cell(x.m,i).due})}document.getElementById('fy-select').value=k;if(Math.abs(s-x.recv)>.005||Math.abs((rr.find(r=>r.m.mid===x.m.mid)?.due||0)-x.recv)>.005)bad++}return bad===0})()`));
    ok("Comment months add up to the receivable (all members)", await ev(`finCompute(${T},'ALL').rows.every(x=>{const s=[...(x.receivable?.comment||'').matchAll(/\\((\\d+(?:\\.\\d+)?)\\/-\\)/g)].reduce((a,m)=>a+Number(m[1]),0);return Math.abs(s-x.recv)<.005})`));
    ok("Dashboard has 'Receivable (All Years)' column", await A.locator("#matrix th:has-text('Receivable (All Years)')").count() === 1);

    // ---- Income Year creation (new Admin (IT) form)
    const go = sec => A.evaluate(x => adminNavigate(x, document.querySelector(`[data-admin-target="${x}"]`)), sec);
    await A.click("#nav-admin"); await go("admin-entry-section");
    ok("Income Years use a year dropdown (not a table of all years): 2 existing years listed", await A.locator("#iy-select option").count() === 2 && await A.locator("#admin-years table").count() === 0);
    const instRowsNow = await A.locator("#admin-inst tbody tr").count(), nNow = await ev("incomeYears.find(y=>y.id===iySel).installments.length");
    ok("Installments table shows only the selected year", instRowsNow === nNow, instRowsNow + " vs " + nNow);
    await A.click("button:has-text('+ New Income Year')");
    ok("New-year form is pre-filled (2027-28, 2027-07-01 .. 2028-06-30, 2000, day 25)", await A.inputValue("#iy-name") === "2027-28" && await A.inputValue("#iy-start") === "2027-07-01" && await A.inputValue("#iy-end") === "2028-06-30" && await A.inputValue("#iy-amt") === "2000" && await A.inputValue("#iy-day") === "25");
    await A.click("button:has-text('Create Income Year')"); await A.waitForTimeout(500);
    const gen = await ev("(incomeYears.find(y=>y.name==='2027-28')||{installments:[]}).installments.map(i=>i.name+'@'+i.dueDate)");
    ok("Create 2027-28 (Asia/Dhaka): 12 installments July/27 … June/28, due on the 25th", gen.length === 12 && gen[0] === "July/27@2027-07-25" && gen[7] === "February/28@2028-02-25" && gen[11] === "June/28@2028-06-25", JSON.stringify(gen));
    ok("2027-28 appears in the Dashboard year selector and in the table", (await ev("[...document.querySelectorAll('#fy-select option')].map(o=>o.value)")).includes("2027-28") && await A.locator("#iy-select option:has-text('2027-28')").count() === 1);
    await A.click("button:has-text('+ New Income Year')"); await A.fill("#iy-name", "2027-28"); await A.fill("#iy-start", "2029-07-01"); await A.fill("#iy-end", "2030-06-30"); await A.fill("#iy-day", "31");
    await A.click("button:has-text('Create Income Year')");
    ok("Duplicate Income Year name is rejected with a message", (await A.locator("#iy-err").innerText()).includes("আগে থেকেই আছে"));
    await A.fill("#iy-name", "27-28"); await A.click("button:has-text('Create Income Year')");
    ok("Bad name format is rejected", (await A.locator("#iy-err").innerText()).includes("ফরম্যাটে"));
    await A.fill("#iy-name", "2029-30"); await A.click("button:has-text('Create Income Year')"); await A.waitForTimeout(400);
    const g2 = await ev("incomeYears.find(y=>y.name==='2029-30').installments.map(i=>i.dueDate)");
    ok("Due day 31 -> month end (Feb 2030 = 28, Apr/Jun/Sep/Nov = 30)", g2[7] === "2030-02-28" && g2[9] === "2030-04-30" && g2[11] === "2030-06-30" && g2[2] === "2029-09-30", JSON.stringify(g2));
    await A.click("button:has-text('+ New Income Year')"); await A.fill("#iy-name", "2030-31"); await A.fill("#iy-start", "2030-01-01"); await A.fill("#iy-end", "2030-12-31"); await A.click("button:has-text('Create Income Year')");
    ok("Overlapping Income Year dates are rejected", (await A.locator("#iy-err").innerText()).includes("মিলে"));
    await A.click("button:has-text('Cancel')");
    ok("Leap year: due day 31 in Feb 2028 -> 29", await ev("genIncomeYearInstallments('x','2027-07-01','2028-06-30',1,31)[7].dueDate") === "2028-02-29");
    ok("Server stores the new Income Years", await A.evaluate(() => 1) && [...server.t.app_state.values()].some(r => r.key === "pgcs_income_years_v1" && r.value.some(y => y.name === "2027-28")));

    // ---- second device sees it without refresh

    // ---- discoverability: shortcut on the Payment Entry page
    await A.click("#nav-entry");
    ok("Admin (IT) sees the 'Payment Entry Settings' shortcut on the Payment Entry page", await A.locator("#entry-settings-link").isVisible().catch(() => false) || await ev("!document.getElementById('entry-settings-link').classList.contains('hidden')"));
    await A.evaluate(() => adminNavigate("admin-payments-section", document.querySelector('#admin-subnav [data-admin-target="admin-payments-section"]')));
    await A.click("#entry-settings-link"); await A.waitForTimeout(250);
    ok("Shortcut opens Admin -> Payment Entry Settings even if another admin tab was open", await ev("!document.getElementById('page-admin').classList.contains('hidden') && !document.getElementById('admin-entry-section').classList.contains('hidden') && document.getElementById('admin-payments-section').classList.contains('hidden')"));
    // ---- Payment Entry Settings (one merged section): methods / bank / accounts / form switch
    await go("admin-entry-section");
    ok("Merged section: methods, Income Years and Installments are all inside Payment Entry Settings", await A.locator("#admin-entry-section #admin-entry, #admin-entry-section #admin-years, #admin-entry-section #admin-inst").count() === 3 && await A.locator("#admin-subnav button:has-text('Income Years'), #admin-subnav button:has-text('Installments')").count() === 0);
    await A.fill("#es-new-method", "bKash"); await A.click("#admin-entry button:has-text('+ Add')"); await A.waitForTimeout(250);
    ok("Add Payment Method -> appears in the Entry Form", await ev("[...document.querySelectorAll('#entry-method option')].map(o=>o.value).includes('bKash') && S.methods.includes('bKash')"));
    await A.fill("#es-new-method", "bkash"); await A.click("#admin-entry button:has-text('+ Add')");
    ok("Duplicate Payment Method is rejected", (await ev("document.getElementById('toast').textContent")).includes("আগে থেকেই") && await ev("S.methods.filter(m=>m.toLowerCase()==='bkash').length") === 1);
    const mi = await ev("S.methods.indexOf('bKash')");
    await A.locator("#admin-entry input").nth(1 + mi).fill("Nagad"); await A.locator("#admin-entry input").nth(1 + mi).blur(); await A.waitForTimeout(250);
    ok("Rename Payment Method", await ev("S.methods.includes('Nagad') && !S.methods.includes('bKash') && [...document.querySelectorAll('#entry-method option')].map(o=>o.value).includes('Nagad')"));
    await A.locator("#admin-entry button:has-text('✕ Remove')").nth(mi).click(); await A.waitForTimeout(250);
    ok("Remove Payment Method -> gone from the Entry Form", await ev("!S.methods.includes('Nagad') && ![...document.querySelectorAll('#entry-method option')].map(o=>o.value).includes('Nagad')"));
    ok("Cannot remove the last Payment Method", await ev("(()=>{const keep=[...S.methods];S.methods=['Only'];esRemoveMethod(0);const r=S.methods.length===1;S.methods=keep;return r})()"));
    await A.fill("#es-new-account", "9876543210"); await A.click("#admin-entry button:has-text('+ Add') >> nth=1"); await A.waitForTimeout(250);
    ok("Add Account No -> available in the Entry Form", await ev("S.accounts.includes('9876543210') && [...document.querySelectorAll('#entry-account option')].map(o=>o.value).includes('9876543210')"));
    await A.locator("#admin-entry button:has-text('✕ Remove')").last().click(); await A.waitForTimeout(250);
    ok("Remove Account No", await ev("!S.accounts.includes('9876543210')"));
    await A.fill("#es-new-method", "Rocket"); await A.click("#admin-entry button:has-text('+ Add') >> nth=0"); await A.waitForTimeout(250);
    const B = await device("B", "PGCS-2114");
    await B.waitForFunction(() => Object.keys(YEARS).includes("2027-28"), null, { timeout: 12000 });
    ok("Device B receives Income Year 2027-28 automatically", true);
    await B.waitForFunction(() => S.methods.includes("Rocket"), null, { timeout: 12000 });
    ok("Device B receives the new Payment Method (Rocket) automatically", await B.evaluate(() => [...document.querySelectorAll("#entry-method option")].map(o => o.value).includes("Rocket")));
    ok("Member cannot reach Admin page", await B.evaluate(() => !canAccessPage("admin")));

    // ---- inactive year is excluded everywhere (Dashboard & Statement use the same engine)
    const act = await ev("receivableRows('2028-12-31').reduce((s,r)=>s+r.due,0)");
    await go("admin-entry-section"); await A.selectOption("#iy-select", { label: "2027-28" }); await A.click("#admin-years button:has-text('Deactivate Year')"); await A.waitForTimeout(400);
    const inact = await ev("receivableRows('2028-12-31').reduce((s,r)=>s+r.due,0)");
    ok("Deactivated Income Year no longer counts in receivable", act - inact === 17 * 2000 * 12 - 0 || act > inact, JSON.stringify({ act, inact }));
    ok("Statement balances with an inactive year", await ev("finCompute('2028-12-31','ALL').diff") === 0);

    // ---- due-date boundary + closed installments + settled member + cancelled member
    const bnd = await ev("(()=>{const m=MEMBERS.find(x=>x.mid==='PGCS-2101');const l=allInstallments().find(i=>i.fy==='2026-27'&&i.key.startsWith('Nov'));return {before:receivableDue(m,l,'2026-11-24'),on:receivableDue(m,l,'2026-11-25')}})()");
    ok("Installment due ON the statement date counts; day before does not", bnd.before === 0 && bnd.on > 0, JSON.stringify(bnd));
    const closedChk = await ev(`(()=>{const m=MEMBERS.find(x=>x.mid==='PGCS-2101');const l=allInstallments().find(i=>i.fy==='2026-27'&&i.key.startsWith('Oct'));const a=receivableDue(m,l,${T});S.closed.push(l.fy+'|'+l.key);const b=receivableDue(m,l,${T});S.closed.pop();return {a,b}})()`);
    ok("Closed installment excluded from receivable (matches Dashboard hiding it)", closedChk.a > 0 && closedChk.b === 0, JSON.stringify(closedChk));
    ok("Settled member disappears from receivable", await ev(`(()=>{const before=receivableRows(${T}).some(r=>r.m.mid==='PGCS-2102');FTX.push({id:'tx-s',type:'payout',mid:'PGCS-2102',date:'2026-09-01',amount:1,acc:'bank'});const after=receivableRows(${T}).some(r=>r.m.mid==='PGCS-2102');FTX.pop();return before&&!after})()`));

    // ---- rename keeps payments linked (legacy payment + a payment created through the entry-form path)
    const ren = await ev(`(()=>{const y=incomeYears.find(x=>x.name==='2026-27');const i=y.installments.find(x=>x.name==='Oct-26'||x.legacyKey==='Oct-26');const m='PGCS-2101';
      const before=receivableRows(${T}).find(r=>r.m.mid===m)?.due||0;
      payments.push({id:555001,fy:'2026-27',mid:m,inst:i.legacyKey||i.name,instId:i.id,method:'Cash Payment',date:'2026-11-10',amount:2000,status:'Approved'});save();
      const mid=receivableRows(${T}).find(r=>r.m.mid===m)?.due||0;
      editInstallment(y.id,i.id,'name','Renamed Oct');
      const after=receivableRows(${T}).find(r=>r.m.mid===m)?.due||0;return {before,mid,after}})()`);
    ok("Renaming an installment keeps its Approved payments linked (receivable unchanged)", ren.before - ren.mid === 2000 && ren.mid === ren.after, JSON.stringify(ren));
    await go("admin-entry-section"); await A.selectOption("#iy-select", { label: "2025-26" });
    const p0 = await ev("(document.getElementById('fy-select').value='2025-26', paidOf('PGCS-2101','July-25'))");
    const inp = A.locator("#admin-inst tbody tr").filter({ has: A.locator("input[value='July-25']") }).first().locator("input").first();
    await inp.fill("July Renamed"); await inp.blur(); await A.waitForTimeout(400);
    ok("Installment renamed in the Installment Management table", await ev("incomeYears.find(y=>y.name==='2025-26').installments.some(i=>i.name==='July Renamed')"));
    ok("Legacy payments (no instId) stay linked after rename", p0 === 2000 && await ev("(document.getElementById('fy-select').value='2025-26', paidOf('PGCS-2101',incomeYears.find(y=>y.name==='2025-26').installments.find(i=>i.name==='July Renamed').id))") === 2000, String(p0));
    ok("Installment with payments shows a lock instead of Delete", await A.locator("#admin-inst tbody tr").filter({ has: A.locator("input[value='July Renamed']") }).first().locator("button:has-text('Delete')").count() === 0);
    // ---- Void
    const ap = await ev("payments.find(p=>p.status==='Approved'&&p.mid==='PGCS-2114'&&p.inst==='May-26')");
    const r1 = await ev(`finCompute(${T},'ALL').rows.find(x=>x.m.mid==='PGCS-2114').recv`);
    await go("admin-payments-section"); await A.fill("#pm-mid", "PGCS-2114"); await A.selectOption("#pm-status", "Approved"); await A.fill("#pm-inst", "May-26"); await A.waitForTimeout(250);
    ok("Payment Management filters narrow the table (MID + Approved + Installment)", await A.locator("#pm-body tbody tr").count() === 1);
    await A.click("#pm-body button:has-text('Delete (Void)')");
    ok("Confirmation dialog shows Payment ID, MID, Installment, Amount and Status", await ev("['Payment ID','MID','Installment','Amount','Status'].every(k=>document.getElementById('void-details').textContent.includes(k))"));
    await A.click("button:has-text('Confirm Delete (Void)')");
    ok("Deletion reason is mandatory", (await A.locator("#void-err").innerText()).includes("কারণ") && await ev(`payments.find(p=>p.id===${ap.id}).status`) === "Approved");
    await A.fill("#void-reason", "ভুল Entry — test"); await A.click("button:has-text('Confirm Delete (Void)')"); await A.waitForTimeout(400);
    const v = await ev(`payments.find(p=>p.id===${ap.id})`), r2 = await ev(`finCompute(${T},'ALL').rows.find(x=>x.m.mid==='PGCS-2114').recv`);
    ok("Void keeps the record: status Voided + reason + by + date + previous status", v.status === "Voided" && v.voidReason && v.voidedBy === "PGCS-2105" && v.voidedAt && v.previousStatus === "Approved", JSON.stringify(v));
    ok("Void reverses the financial effect (receivable +amount) on Statement and Dashboard", r2 - r1 === ap.amount && (await ev(`receivableRows(${T}).find(r=>r.m.mid==='PGCS-2114').due`)) === r2, JSON.stringify({ r1, r2 }));
    ok("Statement still balances after void", await ev(`finCompute(${T},'ALL').diff`) === 0, String(await ev(`finCompute(${T},'ALL').diff`)));
    ok("Audit history written (Deleted By, Date, Reason, Previous Status)", await ev(`paymentAudit.some(a=>a.paymentId===${ap.id}&&a.deletedBy&&a.deletionDate&&a.reason&&a.previousStatus==='Approved')`));
    await A.fill("#pm-inst", ""); await A.selectOption("#pm-status", "Voided"); await A.waitForTimeout(250);
    await A.click("#pm-body button:has-text('Audit')"); await A.waitForTimeout(150);
    ok("Audit dialog shows Deleted By / Date / Reason / Previous Status", await ev("['Deleted By','Deletion Date','Reason','Previous Status','PGCS-2105'].every(k=>document.getElementById('info-body').textContent.includes(k))"));
    await A.click("#info-modal button:has-text('×')");
    const dr = await ev("(()=>{const p={id:987654321,fy:'2026-27',mid:'PGCS-2101',inst:'Sept-26',method:'Cash Payment',date:'2026-11-01',amount:2000,status:'Draft'};payments.push(p);save();voidPayment(p.id);return payments.find(x=>x.id===p.id).status})()");
    ok("Only Approved payments can be voided (Draft stays Draft)", dr === "Draft", dr);
    await B.waitForFunction(() => payments.some(p => p.status === "Voided"), null, { timeout: 12000 });
    ok("Device B receives the voided payment automatically", true);
    ok("Admin cannot be bypassed: member session cannot void", await B.evaluate(() => { const p = payments.find(x => x.status === "Approved"); voidPayment(p.id); return payments.find(x => x.id === p.id).status === "Approved"; }));

    // ---- responsive design: on a phone only the menu pills stay pinned while scrolling; nothing overflows sideways
    const M = await device("M-mobile", "PGCS-2114", { width: 390, height: 844 });
    await M.evaluate(() => { document.body.style.minHeight = "3000px"; window.scrollTo(0, 700); });
    await M.waitForTimeout(150);
    ok("Mobile: menu pills stay pinned to the top while scrolling", Math.abs((await M.locator(".sb-nav").boundingBox()).y) < 2);
    ok("Mobile: page does not scroll sideways", await M.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    ok("Desktop sidebar is fixed 272px wide with the content shifted right", await A.evaluate(() => { const s = document.querySelector(".sidebar").getBoundingClientRect(), m = document.querySelector(".app-main").getBoundingClientRect(); return Math.round(s.width) === 272 && Math.round(m.left) === 272; }));
  } catch (e) { console.log("E2E ABORTED:", e.message); ok("E2E completed", false, e.message); }
  await browser.close(); web.close();
  for (const [r, n] of results) console.log(r, "-", n);
  console.log(`${results.filter(r => r[0] === "PASS").length}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
