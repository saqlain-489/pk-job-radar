import fs from 'node:fs';
import path from 'node:path';
import { WORK_DIR } from '../config.js';
import { getDb, now, tx, closeDb, endRun, parseJson } from '../db.js';
import { readOut } from '../discover/apply.js';
import { upsertJob, closeMissing, rescoreAll, resolvePageJobId, matchExisting, closeExpired } from './jobs.js';
import { backupDb } from '../lib/backup.js';

const STATUSES = new Set(['live', 'hr_email', 'stale']);

export function applyExtract(runId, { log = console.log } = {}) {
  const out = readOut(path.join(WORK_DIR, `${runId}.out.json`));
  const sentFile = path.join(WORK_DIR, `${runId}.sources.json`);
  const sentList = JSON.parse(fs.readFileSync(sentFile, 'utf8'));
  const sent = new Map(sentList.map((s) => [s.source_id, s.hash]));
  const ldBySource = new Map(sentList.map((s) => [s.source_id, s.ld || []]));
  const db = getDb();
  const t = now();
  const summary = { sources: 0, jobs: 0, new_jobs: 0, closed: 0, skipped: [] };
  tx(() => {
    for (const o of out) {
      const src = db.prepare('SELECT * FROM sources WHERE id = ?').get(o.source_id);
      if (!src || !sent.has(o.source_id)) {
        summary.skipped.push(o.source_id);
        continue;
      }
      const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(src.company_id);
      const seen = [];
      const used = new Set();
      const ld = ldBySource.get(o.source_id) || [];
      for (const j of o.jobs || []) {
        if (!j?.title) continue;
        const id = resolvePageJobId(company.id, src.id, j, used);
        const hint = matchExisting(j.title, null, ld);
        const r = upsertJob(
          {
            ...j,
            posted_at: j.posted_at || hint?.posted_at || null,
            closes_at: j.closes_at || hint?.closes_at || null,
            employment_type: j.employment_type || hint?.employment_type || null,
            location_type: j.location_type || hint?.location_type || null,
            salary_min: j.salary_min ?? hint?.salary_min ?? null,
            salary_max: j.salary_max ?? hint?.salary_max ?? null,
            id,
            url: j.url || src.url,
            source_url: src.url,
            description: j.summary || null,
            employment_type_norm: j.employment_type || hint?.employment_type || null,
            flags: Array.isArray(j.flags) ? j.flags : [],
          },
          company,
          { sourceId: src.id, extractedBy: 'claude', t, sourceSeenBefore: !!src.hash }
        );
        if (!seen.includes(r.id)) seen.push(r.id);
        summary.jobs += 1;
        if (r.isNew) summary.new_jobs += 1;
      }
      summary.closed += closeMissing(src.id, seen, t);
      db.prepare("UPDATE sources SET hash = ?, pending_hash = NULL, last_changed = ?, last_status = 'ok' WHERE id = ?").run(sent.get(o.source_id), t, src.id);
      if (STATUSES.has(o.hiring_status)) db.prepare('UPDATE companies SET hiring_status = ?, updated_at = ? WHERE id = ?').run(o.hiring_status, t, company.id);
      summary.sources += 1;
    }
  });
  closeExpired(t);
  rescoreAll();
  const run = db.prepare('SELECT stats FROM runs WHERE id = ?').get(runId);
  if (run) endRun(runId, 'done', { ...parseJson(run.stats, {}), claude_jobs: summary.jobs, new_jobs_claude: summary.new_jobs, closed_claude: summary.closed }, 'applied');
  log(`[watch:apply] ${JSON.stringify(summary)}`);
  return summary;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  backupDb('watch-apply');
  const runId = process.argv[2];
  if (!runId) {
    console.error('Usage: npm run watch:apply -- <runId>');
    process.exit(1);
  }
  try {
    applyExtract(runId);
  } catch (e) {
    console.error('[watch:apply] error:', e.message);
    process.exitCode = 1;
  } finally {
    closeDb();
  }
}
