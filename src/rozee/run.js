import path from 'node:path';
import { loadJson, profile } from '../config.js';
import { getDb, now, startRun, endRun, closeDb } from '../db.js';
import { fetchPage } from '../lib/http.js';
import { randomDelay } from '../lib/throttle.js';
import { htmlToText } from '../lib/text.js';
import { normName, isContacted } from '../lib/domain.js';
import { backupDb } from '../lib/backup.js';
import { upsertJob, rescoreAll, closeExpired, matchExisting } from '../watch/jobs.js';
import { parseSearch, isChallenge, searchUrl } from './parse.js';

export const rozeeConfig = () => loadJson('config/rozee.json');

// Rozee companies are matched to ones we already know by name; otherwise they get their own row.
export function companyFor(name, cityKey) {
  const db = getDb();
  const key = normName(name);
  if (!key) return null;
  const known = db.prepare('SELECT * FROM companies WHERE key = ?').get(`rozee:${key}`);
  if (known) return known;
  const all = db.prepare("SELECT * FROM companies WHERE discover_status <> 'rejected'").all();
  const same = all.find((c) => normName(c.name) === key);
  if (same) return same;
  const t = now();
  const r = db
    .prepare(
      `INSERT INTO companies (key, name, city, sources, contacted, discover_status, created_at, updated_at)
       VALUES (?, ?, ?, '["rozee"]', ?, 'rozee', ?, ?)`
    )
    .run(`rozee:${key}`, name, cityKey, isContacted(name, '', profile.already_contacted) ? 1 : 0, t, t);
  return db.prepare('SELECT * FROM companies WHERE id = ?').get(Number(r.lastInsertRowid));
}

// Companies re-post the same opening every few days under a new Rozee id; keep one job, newest date.
export function repostOf(companyId, j) {
  const open = getDb()
    .prepare("SELECT id, title, city, posted_at FROM jobs WHERE company_id = ? AND extracted_by = 'rozee' AND closed_at IS NULL AND id <> ?")
    .all(companyId, `rozee:${j.ext_id}`);
  const m = matchExisting(j.title, (j.city || '').toLowerCase() || null, open);
  if (!m) return null;
  return !m.posted_at || !j.posted_at || j.posted_at >= m.posted_at ? m.id : null;
}

// Older copies of the same post (from before re-post matching, or two ids seen in one run) close.
export function closeDuplicates(t = now()) {
  const db = getDb();
  const open = db.prepare("SELECT id, company_id, title, city, posted_at FROM jobs WHERE extracted_by = 'rozee' AND closed_at IS NULL ORDER BY posted_at DESC").all();
  const kept = new Map();
  let closed = 0;
  for (const j of open) {
    const mine = kept.get(j.company_id) || [];
    if (matchExisting(j.title, j.city, mine)) {
      db.prepare('UPDATE jobs SET closed_at = ? WHERE id = ?').run(t, j.id);
      closed += 1;
    } else mine.push(j);
    kept.set(j.company_id, mine);
  }
  return closed;
}

// A job missing from every search of its city for a few days is gone (or expired) on Rozee.
export function closeUnseen(cityKey, days, t = now()) {
  const cutoff = new Date(Date.parse(t) - days * 86400000).toISOString();
  return getDb()
    .prepare("UPDATE jobs SET closed_at = ? WHERE extracted_by = 'rozee' AND closed_at IS NULL AND lower(city) = ? AND last_seen < ?")
    .run(t, cityKey, cutoff).changes;
}

// Measured 2026-10-17: 12 searches were fine, a second run 10 minutes later got HTTP 403.
export function rozeeGate({ force = false, at = Date.now() } = {}) {
  if (force) return { ok: true };
  const cfg = rozeeConfig();
  const last = getDb().prepare("SELECT * FROM runs WHERE kind = 'rozee' ORDER BY started_at DESC LIMIT 1").get();
  if (!last) return { ok: true };
  const hrs = (at - Date.parse(last.started_at)) / 3.6e6;
  if (last.status === 'blocked' && hrs < 24) return { ok: false, why: `Rozee blocked the last run ${hrs.toFixed(1)}h ago; wait 24h` };
  if (hrs < (cfg.minHoursBetweenRuns ?? 20)) return { ok: false, why: `last Rozee run was ${hrs.toFixed(1)}h ago (one run per day)` };
  return { ok: true };
}

// One city per daily run (Rozee tolerates ~12 searches/day): the one checked longest ago.
export function nextCity(cfg = rozeeConfig()) {
  const list = cfg.rotation?.length ? cfg.rotation : Object.keys(cfg.cities);
  const last = new Map(
    getDb()
      .prepare("SELECT city, MAX(started_at) at FROM runs WHERE kind = 'rozee' AND status IN ('done', 'partial') GROUP BY city")
      .all()
      .map((r) => [r.city, r.at])
  );
  return [...list].sort((a, b) => String(last.get(a) || '').localeCompare(String(last.get(b) || '')))[0];
}

export async function rozee({ cities = ['faisalabad'], queries, force = false, log = console.log } = {}) {
  const gate = rozeeGate({ force });
  if (!gate.ok) {
    log(`[rozee] skipped: ${gate.why}`);
    return { status: 'skipped', why: gate.why };
  }
  const cfg = rozeeConfig();
  const qs = queries?.length ? queries : cfg.queries;
  const runId = startRun('rozee', { city: cities.join(',') });
  const t = now();
  const stats = { requests: 0, jobs_seen: 0, new_jobs: 0, closed: 0, by_city: {} };
  let status = 'done';
  let message = '';
  outer: for (const cityKey of cities) {
    const cityId = cfg.cities[cityKey];
    if (!cityId) throw new Error(`No Rozee city id for "${cityKey}" in config/rozee.json`);
    const seen = new Set();
    for (const q of qs) {
      for (let page = 0; page < cfg.maxPagesPerQuery; page++) {
        if (stats.requests >= cfg.maxRequestsPerRun) {
          status = 'partial';
          message = `stopped at the ${cfg.maxRequestsPerRun}-request budget`;
          break outer;
        }
        if (stats.requests) await randomDelay(cfg.delayMinMs, cfg.delayMaxMs);
        const res = await fetchPage(searchUrl(q, cityId, page * 20), { noCurl: true });
        stats.requests += 1;
        if (isChallenge(res)) {
          status = 'blocked';
          message = `Rozee challenged the request (HTTP ${res.status}); stopped for today`;
          break outer;
        }
        if (!res.ok) break;
        const { total, jobs } = parseSearch(res.body);
        for (const j of jobs) {
          if (seen.has(j.ext_id)) continue;
          seen.add(j.ext_id);
          const company = companyFor(j.company || 'Unknown company', cityKey);
          if (!company) continue;
          const id = repostOf(company.id, j) || `rozee:${j.ext_id}`;
          const r = upsertJob(
            {
              ...j,
              id,
              description: htmlToText(j.description).slice(0, 5000) + (j.via ? `\n(Rozee copied this post from ${j.via})` : ''),
              location_text: j.city,
              city: (j.city || cityKey).toLowerCase(),
              employment_type_norm: null,
            },
            company,
            { sourceId: null, extractedBy: 'rozee', t, sourceSeenBefore: true }
          );
          if (r.isNew) stats.new_jobs += 1;
        }
        if ((page + 1) * 20 >= total) break;
      }
    }
    stats.by_city[cityKey] = seen.size;
    stats.jobs_seen += seen.size;
    if (status === 'done') stats.closed += closeUnseen(cityKey, cfg.closeAfterDays, t);
  }
  stats.duplicates_closed = closeDuplicates(t);
  stats.expired = closeExpired(t);
  rescoreAll();
  endRun(runId, status, stats, message);
  log(`[rozee] ${status}: ${JSON.stringify(stats)}${message ? ` — ${message}` : ''}`);
  return { runId, status, ...stats };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  backupDb('rozee');
  const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
  const pick = arg('city') || arg('cities') || 'auto';
  const cities = (pick === 'auto' ? nextCity() : pick).split(',').map((s) => s.trim().toLowerCase());
  const queries = arg('queries')?.split(',').map((s) => s.trim());
  rozee({ cities, queries, force: process.argv.includes('--force') })
    .catch((e) => {
      console.error('[rozee] error:', e.message);
      process.exitCode = 1;
    })
    .finally(() => {
      closeDb();
      setTimeout(() => process.exit(), 10);
    });
}
