// Real Chromium end-to-end test of the real index.html + scripts against the in-process fake Supabase.
// Browser timezone = Asia/Dhaka (UTC+6), clock fixed at 2026-11-15.
// CDN libraries (Tailwind, Chart.js, SheetJS, jsPDF, supabase-js) are stubbed => PDF/Excel files and Realtime websockets are NOT exercised.
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium } = require("/opt/npm-tools/node_modules/playwright");
const { Server } = require("./harness.js");
const root = path.join(__dirname, "..");
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png" };
const results = []; let failed = 0;
const ok = (name, cond, extra = "") => { results.push([cond ? "PASS" : "FAIL", name + (cond ? "" : " :: " + extra)]); if (!cond) failed++; };
(async () => {
  const server = new Server();
  // supabase-migration-v3.sql pre-creates these two documents (CAS updates need an existing row)
  for (const k of ["pgcs_income_years_v1", "pgcs_payment_audit_v1"]) server.t.app_state.set(k, { key: k, value: [], version: 1, created_at: new Date().toISOString() + "0000" + k.length, updated_at: new Date().toISOString() });
  const web = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split("?")[0]).replace(/^\/$/, "/index.html")); if (!f.startsWith(root) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { "Content-Type": mime[path.extname(f)] || "application/octet-stream" }); r.end(fs.readFileSync(f)); }).listen(0);
  const base = "http://127.0.0.1:" + web.address().port + "/index.html";
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome", args: ["--no-sandbox"] });
  const device = async (name, mid) => {
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 900 }, timezoneId: "Asia/Dhaka" });
    await ctx.clock.setFixedTime(new Date("2026-11-15T12:00:00+06:00"));
    await ctx.route("**/rest/v1/**", async route => { const q = route.request(), h = q.headers(); const res = await server.handle(q.url(), { method: q.method(), headers: { Prefer: h.prefer || "" }, body: q.postData() || undefined }); await route.fulfill({ status: res.status, body: await res.text(), contentType: "application/json" }); });
    await ctx.route(/cdn\.tailwindcss|cdn\.jsdelivr|cdnjs/, route => { const u = route.request().url(); const js = /chart/.test(u) ? "window.Chart=class{constructor(){}destroy(){}};" : /xlsx/.test(u) ? "window.XLSX={utils:{}};" : /jspdf/.test(u) ? "window.jspdf={jsPDF:function(){}};" : ""; route.fulfill({ status: 200, contentType: "text/javascript", body: js }); });
    const P = await ctx.newPage(); P.on("pageerror", e => { console.log(`[${name}] PAGE ERROR:`, e.message); ok(`${name}: no JS error`, false, e.message); });
    P.on("dialog", d => d.accept(d.type() === "prompt" ? "ভুল Entry — test" : undefined));
    await P.goto(base); await P.waitForFunction(() => window.__appReady === true, null, { timeout: 15000 });
    await P.fill("#login-user", mid); await P.fill("#login-pass", "pgcs1234"); await P.click("#loginForm button:has-text('Login')"); await P.waitForSelector("#app:not(.hidden)");
    return P;
  };
  try {
    const A = await device("A", "PGCS-2105"), ev = c => A.evaluate(c), T = "todayISO()";
    ok("Statement balances on the repository data (Assets = Liabilities + Equity)", await ev(`finCompute(${T},'ALL').diff`) === 0, String(await ev(`finCompute(${T},'ALL').diff`)));
    ok("Statement balances on several dates / years", await ev(`['2026-08-09','2026-09-30','2027-03-01','2027-10-01'].every(d=>finCompute(d,'ALL').diff===0 && finCompute(d,'2026-27').diff===0)`));
    ok("Every member: Dashboard cell-sum == Statement receivable == receivableRows", await ev(`(()=>{const k=document.getElementById('fy-select').value,R=finCompute(${T},'ALL'),rr=receivableRows(${T});let bad=0;for(const x of R.rows){let s=0;for(const y of Object.keys(YEARS)){document.getElementById('fy-select').value=y;YEARS[y].filter(i=>i.key!=='Membership Fee').forEach(i=>{s+=cell(x.m,i).due})}document.getElementById('fy-select').value=k;if(Math.abs(s-x.recv)>.005||Math.abs((rr.find(r=>r.m.mid===x.m.mid)?.due||0)-x.recv)>.005)bad++}return bad===0})()`));
    ok("Comment months add up to the receivable (all members)", await ev(`finCompute(${T},'ALL').rows.every(x=>{const s=[...(x.receivable?.comment||'').matchAll(/\\((\\d+(?:\\.\\d+)?)\\/-\\)/g)].reduce((a,m)=>a+Number(m[1]),0);return Math.abs(s-x.recv)<.005})`));
    ok("Dashboard has 'Receivable (All Years)' column", await A.locator("#matrix th:has-text('Receivable (All Years)')").count() === 1);

    // ---- Income Year creation (the form in the admin page)
    await A.click("#nav-admin"); await A.waitForSelector("#income-year-form");
    await A.fill("#iy-name", "2027-28"); await A.fill("#iy-start", "2027-07-01"); await A.fill("#iy-end", "2028-06-30"); await A.fill("#iy-amount", "2000"); await A.fill("#iy-day", "25");
    await A.click("#income-year-form button"); await A.waitForTimeout(500);
    const gen = await ev("(incomeYears.find(y=>y.name==='2027-28')||{installments:[]}).installments.map(i=>i.name+'@'+i.dueDate)");
    ok("Create 2027-28 (Asia/Dhaka): 12 installments July/27 … June/28, due on the 25th", gen.length === 12 && gen[0] === "July/27@2027-07-25" && gen[7] === "February/28@2028-02-25" && gen[11] === "June/28@2028-06-25", JSON.stringify(gen));
    ok("2027-28 appears in the Dashboard year selector", (await ev("[...document.querySelectorAll('#fy-select option')].map(o=>o.value)")).includes("2027-28"));
    await A.fill("#iy-name", "2027-28"); await A.fill("#iy-start", "2029-07-01"); await A.fill("#iy-end", "2030-06-30"); await A.fill("#iy-amount", "2000"); await A.fill("#iy-day", "31");
    await A.click("#income-year-form button");
    ok("Duplicate Income Year name is rejected", (await ev("document.getElementById('toast').textContent")).includes("আগে থেকেই আছে"));
    await A.fill("#iy-name", "2029-30"); await A.click("#income-year-form button"); await A.waitForTimeout(400);
    const g2 = await ev("incomeYears.find(y=>y.name==='2029-30').installments.map(i=>i.dueDate)");
    ok("Due day 31 -> month end (Feb 2030 = 28, Apr/Jun/Sep/Nov = 30)", g2[7] === "2030-02-28" && g2[9] === "2030-04-30" && g2[11] === "2030-06-30" && g2[2] === "2029-09-30", JSON.stringify(g2));
    ok("Leap year: due day 31 in Feb 2028 -> 29", await ev("genIncomeYearInstallments('x','2027-07-01','2028-06-30',1,31)[7].dueDate") === "2028-02-29");
    ok("Server stores the new Income Years", await A.evaluate(() => 1) && [...server.t.app_state.values()].some(r => r.key === "pgcs_income_years_v1" && r.value.some(y => y.name === "2027-28")));

    // ---- second device sees it without refresh
    const B = await device("B", "PGCS-2114");
    await B.waitForFunction(() => Object.keys(YEARS).includes("2027-28"), null, { timeout: 12000 });
    ok("Device B receives Income Year 2027-28 automatically", true);
    ok("Member cannot reach Admin page", await B.evaluate(() => !canAccessPage("admin")));

    // ---- inactive year is excluded everywhere (Dashboard & Statement use the same engine)
    const act = await ev("receivableRows('2028-12-31').reduce((s,r)=>s+r.due,0)");
    await ev(`(()=>{const y=incomeYears.find(x=>x.name==='2027-28');editIncomeYear(y.id,'status','Inactive')})()`); await A.waitForTimeout(300);
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
    const ren2 = await ev(`(()=>{const y=incomeYears.find(x=>x.name==='2025-26');const i=y.installments.find(x=>x.name==='July-25');document.getElementById('fy-select').value='2025-26';const p0=paidOf('PGCS-2101','July-25');editInstallment(y.id,i.id,'name','July Renamed');document.getElementById('fy-select').value='2025-26';return {p0,p1:paidOf('PGCS-2101',i.id)}})()`);
    ok("Legacy payments (no instId) stay linked after rename", ren2.p0 === 2000 && ren2.p1 === 2000, JSON.stringify(ren2));

    // ---- Void
    const ap = await ev("payments.find(p=>p.status==='Approved'&&p.mid==='PGCS-2114'&&p.inst==='May-26')");
    const r1 = await ev(`finCompute(${T},'ALL').rows.find(x=>x.m.mid==='PGCS-2114').recv`);
    await ev(`voidPayment(${ap.id})`); await A.waitForTimeout(400);
    const v = await ev(`payments.find(p=>p.id===${ap.id})`), r2 = await ev(`finCompute(${T},'ALL').rows.find(x=>x.m.mid==='PGCS-2114').recv`);
    ok("Void keeps the record: status Voided + reason + by + date + previous status", v.status === "Voided" && v.voidReason && v.voidedBy === "PGCS-2105" && v.voidedAt && v.previousStatus === "Approved", JSON.stringify(v));
    ok("Void reverses the financial effect (receivable +amount) on Statement and Dashboard", r2 - r1 === ap.amount && (await ev(`receivableRows(${T}).find(r=>r.m.mid==='PGCS-2114').due`)) === r2, JSON.stringify({ r1, r2 }));
    ok("Statement still balances after void", await ev(`finCompute(${T},'ALL').diff`) === 0, String(await ev(`finCompute(${T},'ALL').diff`)));
    ok("Audit history written (Deleted By, Date, Reason, Previous Status)", await ev(`paymentAudit.some(a=>a.paymentId===${ap.id}&&a.deletedBy&&a.deletionDate&&a.reason&&a.previousStatus==='Approved')`));
    const dr = await ev("(()=>{const p={id:987654321,fy:'2026-27',mid:'PGCS-2101',inst:'Sept-26',method:'Cash Payment',date:'2026-11-01',amount:2000,status:'Draft'};payments.push(p);save();voidPayment(p.id);return payments.find(x=>x.id===p.id).status})()");
    ok("Only Approved payments can be voided (Draft stays Draft)", dr === "Draft", dr);
    await B.waitForFunction(() => payments.some(p => p.status === "Voided"), null, { timeout: 12000 });
    ok("Device B receives the voided payment automatically", true);
    ok("Admin cannot be bypassed: member session cannot void", await B.evaluate(() => { const p = payments.find(x => x.status === "Approved"); voidPayment(p.id); return payments.find(x => x.id === p.id).status === "Approved"; }));
  } catch (e) { console.log("E2E ABORTED:", e.message); ok("E2E completed", false, e.message); }
  await browser.close(); web.close();
  for (const [r, n] of results) console.log(r, "-", n);
  console.log(`${results.filter(r => r[0] === "PASS").length}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
