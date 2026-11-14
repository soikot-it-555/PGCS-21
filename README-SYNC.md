# PGCS-21 — Two-way Supabase sync (v2)

## Modified / new files
| File | Change |
|---|---|
| `db.js` | Rewritten: record-level writes, version compare-and-set, outbox, Realtime + 5 s polling fallback, resync |
| `app.js` | `toast()` waits for DB result; remote-update handlers (`DB.subscribe`); Reset needs typing RESET |
| `finance.js` | Remote-update handlers; legacy `S.fin.tx` migration now merges by id (never drops) |
| `index.html` | supabase-js script tag; `DB.startRealtime()` after app is ready; login enabled only after initial sync |
| `service-worker.js` | Cache `pgcs-portal-v7`; Supabase (REST/Storage/Realtime) never intercepted |
| `supabase-migration-v2.sql` | **New — run once** |
| `tests/` | Mock-Supabase test harness (`node tests/run.js`) |

## Deploy
1. Supabase → SQL Editor → paste & run `supabase-migration-v2.sql` (idempotent; no rows are changed/deleted).
2. Supabase → Database → Replication: confirm `app_state`, `payments`, `fin_transactions` are in `supabase_realtime` (the SQL does this).
3. Commit the project and push to `main`; GitHub Pages redeploys. Open the site once and hard-refresh (Ctrl+Shift+R) so service worker v7 replaces v6.
4. Localhost uses the same `db.js` URL/key → same database.

## How it works
* `localStorage` = cache. Startup: fetch DB → validate → fill cache → load app → start Realtime → enable login.
* Each save is diffed per record (payment / fin tx / member / setting key / password / finance account) and sent as INSERT, UPDATE ... `WHERE version = known` or DELETE ... `WHERE version = known`. Versions are bumped by a DB trigger.
* If another device changed the record first → server copy wins, local reloaded, amber “Conflict” banner.
* Unsent changes live in `pgcs_outbox_v1` and are retried (also after closing the tab) with their original base version.
* Realtime events/resync update memory + cache only (never write back); duplicates ignored by version.
* `change_log` table keeps the previous copy of every updated/deleted row.
