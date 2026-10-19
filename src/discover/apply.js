import fs from 'node:fs';
import path from 'node:path';
import { WORK_DIR } from '../config.js';
import { getDb, now, tx, parseJson, closeDb, endRun } from '../db.js';
import { hasFeed, atsHomeUrl } from './ats.js';
import { backupDb } from '../lib/backup.js';

const KINDS = new Set(['product', 'service', 'mixed', 'unclear']);
const STATUSES = new Set(['live', 'hr_email', 'stale', 'none']);

export function readOut(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^\s*\/\/.*$/gm, '');
  const arr = JSON.parse(raw);
  if (!Array.isArray(arr)) throw new Error(`${file} must hold a JSON array`);
  return arr;
}

// Watch sources: an ATS with a JSON feed wins (its jobs need no Claude); otherwise the careers page.
export function planSources(probe, verdict) {
  const out = [];
  const ats = probe?.ats || [];
  const feeds = ats.filter((a) => hasFeed(a.ats));
  for (const a of feeds) out.push({ kind: 'ats', url: atsHomeUrl(a.ats, a.slug), ats: a.ats, slug: a.slug });
  if (feeds.length || verdict.hiring_status === 'none' || verdict.is_software === false) return out;
  const pageAts = ats.find((a) => !hasFeed(a.ats));
  const url = verdict.careers_url || probe?.careers?.url || (pageAts && pageAts.url);
  if (url) out.push({ kind: 'page', url, ats: pageAts?.ats || null, slug: pageAts?.slug || null });
  return out;
}

export function applyDiscover(runId, { log = console.log } = {}) {
  const file = path.join(WORK_DIR, `${runId}.out.json`);
  const verdicts = readOut(file);
  const db = getDb();
  const t = now();
  const summary = { applied: 0, rejected: 0, sources: 0, missing: [] };
  tx(() => {
    for (const v of verdicts) {
      const c = db.prepare('SELECT id, probe FROM companies WHERE id = ?').get(v.id);
      if (!c) {
        summary.missing.push(v.id);
        continue;
      }
      const probe = parseJson(c.probe, {});
      const status = STATUSES.has(v.hiring_status) ? v.hiring_status : 'none';
      if (v.name) db.prepare('UPDATE companies SET name = ? WHERE id = ?').run(String(v.name).slice(0, 120), c.id);
      db.prepare(
        `UPDATE companies SET is_software = ?, kind = ?, foreign_clients = ?, size = ?, stack = ?, hiring_status = ?, careers_url = ?,
         hr_email = COALESCE(?, hr_email), whatsapp = COALESCE(NULLIF(?, ''), whatsapp), fit = ?, notes = ?, hook = ?, needs_render = ?,
         ats = ?, ats_slug = ?, discover_status = ?, discovered_at = ?, updated_at = ? WHERE id = ?`
      ).run(
        v.is_software ? 1 : 0,
        KINDS.has(v.kind) ? v.kind : 'unclear',
        v.foreign_clients == null ? null : v.foreign_clients ? 1 : 0,
        v.size || 'unknown',
        JSON.stringify(v.stack || []),
        status,
        v.careers_url || null,
        v.hr_email || probe.hr_email || null,
        probe.whatsapp || '',
        Math.max(0, Math.min(100, Number(v.fit) || 0)),
        v.notes || '',
        v.hook || null,
        probe.careers?.rendered ? 1 : 0,
        probe.ats?.[0]?.ats || null,
        probe.ats?.[0]?.slug || null,
        v.is_software ? 'done' : 'rejected',
        t, t, c.id
      );
      if (!v.is_software) summary.rejected += 1;
      db.prepare('UPDATE sources SET active = 0 WHERE company_id = ?').run(c.id);
      for (const s of planSources(probe, v)) {
        db.prepare(
          `INSERT INTO sources (company_id, kind, url, ats, slug, active) VALUES (?, ?, ?, ?, ?, 1)
           ON CONFLICT(company_id, url) DO UPDATE SET active = 1, kind = excluded.kind, ats = excluded.ats, slug = excluded.slug`
        ).run(c.id, s.kind, s.url, s.ats, s.slug);
        summary.sources += 1;
      }
      summary.applied += 1;
    }
  });
  db.prepare("UPDATE runs SET status = 'done' WHERE id = ? AND status = 'awaiting_claude'").run(runId);
  const run = db.prepare('SELECT stats FROM runs WHERE id = ?').get(runId);
  if (run) endRun(runId, 'done', { ...parseJson(run.stats, {}), ...summary, missing: summary.missing.length }, 'applied');
  log(`[discover:apply] ${JSON.stringify(summary)}`);
  return summary;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  backupDb('discover-apply');
  const runId = process.argv[2];
  if (!runId) {
    console.error('Usage: npm run discover:apply -- <runId>');
    process.exit(1);
  }
  try {
    applyDiscover(runId);
  } catch (e) {
    console.error('[discover:apply] error:', e.message);
    process.exitCode = 1;
  } finally {
    closeDb();
  }
}
