// =====================================================================
// PGCS-21 — Supabase Online Database Layer
// app.js-এর ভেতরের লজিক না বদলিয়ে localStorage-এর সব সেভকে Supabase-এ পাঠায়,
// এবং পেজ খোলার সময় Supabase থেকে সর্বশেষ ডেটা নামিয়ে আনে।
// =====================================================================
(function () {
  "use strict";

  // ▼▼▼ শুধু এই দুটি লাইন বদলান (Supabase → Project Settings → API Keys) ▼▼▼
  const SUPABASE_URL = "https://lknftxkkplztbcovprma.supabase.co";
  const SUPABASE_KEY = "sb_publishable_6MByUD2x5QZxOjrI34fqRw_npSJXcl7";
  // ▲▲▲ service_role / secret key কখনো এখানে বসাবেন না ▲▲▲

  const MEMBERS_KEY = "pgcs_members_v1";
  const SETTINGS_KEY = "pgcs_settings_v1";
  const PW_KEY = "pgcs_passwords_v1";
  const PAY_KEY = "pgcs_payments_v3";
  const STATE_KEYS = [MEMBERS_KEY, SETTINGS_KEY, PW_KEY];
  const UPSERT = { Prefer: "resolution=merge-duplicates,return=minimal" };

  // sb_publishable_ key JWT নয়, তাই Authorization: Bearer হিসেবে পাঠানো যাবে না (শুধু apikey)
  const authHeaders = () => SUPABASE_KEY.startsWith("sb_")
    ? { apikey: SUPABASE_KEY }
    : { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY };

  const ls = window.localStorage;
  const origSet = Storage.prototype.setItem;
  const rawSet = (k, v) => origSet.call(ls, k, v);
  const configured = !/YOUR-/.test(SUPABASE_URL + SUPABASE_KEY);

  let ready = false;
  let lastPay = new Map(); // payment id -> JSON string (সর্বশেষ যা Database-এ আছে বলে জানি)
  let lastPw = {};
  let chain = Promise.resolve(true);

  // ---------- REST helper ----------
  async function api(path, { method = "GET", body, headers = {} } = {}) {
    try {
      const res = await fetch(SUPABASE_URL + "/rest/v1/" + path, {
        method,
        cache: "no-store",
        headers: {
          ...authHeaders(),
          "Content-Type": "application/json",
          ...headers
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error("Supabase " + res.status + ": " + errText.slice(0, 200));
      }
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    } catch (e) {
      if (e.message.includes("Failed to fetch")) {
        throw new Error("Network error: ইন্টারনেট সংযোগ চেক করুন অথবা Supabase URL/Key সঠিক আছে কিনা যাচাই করুন");
      }
      throw e;
    }
  }
  const upsertState = (key, value) =>
    api("app_state?on_conflict=key", {
      method: "POST", headers: UPSERT,
      body: [{ key, value, updated_at: new Date().toISOString() }]
    });

  async function fetchAllPayments() {
    const out = [];
    for (let off = 0; ; off += 1000) {
      const rows = await api("payments?select=id,data&order=id.asc&limit=1000&offset=" + off);
      out.push(...rows);
      if (rows.length < 1000) break;
    }
    return out;
  }

  // ---------- Payments: প্রতিটি payment আলাদা row, শুধু পরিবর্তিতগুলো পাঠানো হয় ----------
  async function pushPayments(str) {
    let arr;
    try { arr = JSON.parse(str); } catch { return; }
    if (!Array.isArray(arr)) return;
    const next = new Map(arr.map(p => [p.id, JSON.stringify(p)]));
    const up = [], del = [];
    const now = new Date().toISOString();
    for (const [id, s] of next) if (lastPay.get(id) !== s) up.push({ id, data: JSON.parse(s), updated_at: now });
    for (const id of lastPay.keys()) if (!next.has(id)) del.push(id);
    for (let i = 0; i < up.length; i += 200)
      await api("payments?on_conflict=id", { method: "POST", headers: UPSERT, body: up.slice(i, i + 200) });
    for (let i = 0; i < del.length; i += 100)
      await api("payments?id=in.(" + del.slice(i, i + 100).join(",") + ")", { method: "DELETE", headers: { Prefer: "return=minimal" } });
    lastPay = next;
  }

  // ---------- Passwords: দুজন একসাথে বদলালেও একজনেরটা মুছবে না (merge) ----------
  async function pushPasswords(str) {
    const next = JSON.parse(str) || {};
    const rows = await api("app_state?select=value&key=eq." + PW_KEY);
    const merged = { ...((rows && rows[0] && rows[0].value) || {}) };
    for (const k of Object.keys(next)) if (next[k] !== lastPw[k]) merged[k] = next[k];
    for (const k of Object.keys(lastPw)) if (!(k in next)) delete merged[k];
    await upsertState(PW_KEY, merged);
    lastPw = next;
  }

  // ---------- Save queue ----------
  function banner(msg) {
    let b = document.getElementById("db-banner");
    if (!b) {
      b = document.createElement("div");
      b.id = "db-banner";
      b.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:100;background:#be123c;color:#fff;padding:10px 16px;text-align:center;font-size:14px";
      document.body.appendChild(b);
    }
    b.textContent = msg;
    b.style.display = msg ? "block" : "none";
  }
  function enqueue(key, str) {
    chain = chain.then(async () => {
      try {
        if (key === PAY_KEY) await pushPayments(str);
        else if (key === PW_KEY) await pushPasswords(str);
        else await upsertState(key, JSON.parse(str));
        banner("");
        return true;
      } catch (e) {
        console.error("Database save failed:", e);
        banner("⚠️ Save failed on Online Database! Check internet; next save will retryার চেষ্টা হবে। দরকারে পেজ Refresh করুন।");
        return false;
      }
    });
  }

  // app.js যে localStorage.setItem ডাকে, সেটিকে আটকে Supabase-এও পাঠানো
  Storage.prototype.setItem = function (k, v) {
    origSet.call(this, k, v);
    if (this === ls && ready && (k === PAY_KEY || STATE_KEYS.includes(k))) enqueue(k, String(v));
  };

  // ---------- Retry helper ----------
  async function withRetry(fn, retries = 3, delayMs = 2000) {
    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (e) {
        if (i === retries - 1) throw e;
        console.warn("Database: retry " + (i + 1) + "/" + retries + " after error:", e.message);
        await new Promise(r => setTimeout(r, delayMs * (i + 1)));
      }
    }
  }

  // ---------- Startup ----------
  async function init() {
    if (!configured) throw new Error("db.js ফাইলে Supabase URL ও Key বসানো হয়নি");

    // সংযোগ/Key যাচাই: আসল table-এ একটি ছোট query (root /rest/v1/ এখন anon key-তে 401 দেয়, তাই সেটা ব্যবহার করা হয় না)
    let probe;
    try {
      probe = await fetch(SUPABASE_URL + "/rest/v1/app_state?select=key&limit=1", { headers: authHeaders(), cache: "no-store" });
    } catch (e) {
      throw new Error("Supabase URL-এ সংযোগ হচ্ছে না। ইন্টারনেট চেক করুন।");
    }
    if (!probe.ok) {
      const t = (await probe.text()).slice(0, 160);
      if (probe.status === 404 || /PGRST205|does not exist|schema cache/i.test(t))
        throw new Error("Table পাওয়া যায়নি — Supabase SQL Editor-এ supabase-setup.sql একবার Run করুন। (" + t + ")");
      if (probe.status === 401 || probe.status === 403)
        throw new Error("Key গ্রহণ হয়নি বা RLS policy নেই (" + probe.status + "): " + t);
      throw new Error("Supabase " + probe.status + ": " + t);
    }

    const [state, pays] = await withRetry(() =>
      Promise.all([api("app_state?select=key,value"), fetchAllPayments()])
    );
    const sm = new Map(state.map(r => [r.key, r.value]));

    if (!sm.has("_initialized")) {
      // First time: load this browser data (or Excel master data if not present) into Databasease-এ তোলা হবে
      const localPay = JSON.parse(ls.getItem(PAY_KEY) || "null") ||
        (typeof INITIAL_PAYMENTS !== "undefined" ? INITIAL_PAYMENTS : []);
      lastPay = new Map();
      await pushPayments(JSON.stringify(localPay));
      rawSet(PAY_KEY, JSON.stringify(localPay));
      for (const k of STATE_KEYS) {
        const raw = ls.getItem(k);
        if (raw) await upsertState(k, JSON.parse(raw));
      }
      lastPw = JSON.parse(ls.getItem(PW_KEY) || "{}");
      await upsertState("_initialized", { at: new Date().toISOString() });
    } else {
      // পরের বার থেকে: Database-ই একমাত্র সত্য, local শুধু cache
      for (const k of STATE_KEYS) {
        if (sm.has(k)) rawSet(k, JSON.stringify(sm.get(k)));
        else ls.removeItem(k);
      }
      const arr = pays.map(r => r.data);
      rawSet(PAY_KEY, JSON.stringify(arr));
      lastPay = new Map(arr.map(p => [p.id, JSON.stringify(p)]));
      lastPw = sm.get(PW_KEY) || {};
    }
    ready = true;
  }

  window.DB = { init, flush: () => chain };
})();
