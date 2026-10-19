import path from 'node:path';
import { config } from '../config.js';
import { getDb, now, startRun, endRun, closeDb } from '../db.js';
import { mapLimit } from '../lib/http.js';
import { closeRenderBrowser } from '../lib/browser.js';
import { backupDb } from '../lib/backup.js';
import { probeCompany } from './probe.js';
import { planSources } from './apply.js';
import { skipReason, writeDiscoverPacket } from './run.js';

const DAY = 86400000;
export const RECHECK_DAYS = { unreachable: 14, dead_end: 30, no_careers: 30 };

// Companies that gave nothing last time and are due for another look. Rejected (not software) never return.
export function dueForRecheck({ at = Date.now(), limit = 40 } = {}) {
  const iso = (days) => new Date(at - days * DAY).toISOString();
  return getDb()
    .prepare(
      `SELECT * FROM companies c WHERE c.domain IS NOT NULL AND (
         (c.discover_status = 'skipped' AND (c.notes LIKE 'site unreachable%' OR c.notes LIKE 'careers page found but did not load%') AND COALESCE(c.probed_at, '') < ?)
         OR (c.discover_status = 'skipped' AND c.notes NOT LIKE 'site unreachable%' AND c.notes NOT LIKE 'careers page found but did not load%' AND COALESCE(c.probed_at, '') < ?)
         OR (c.discover_status = 'done' AND c.is_software = 1
             AND NOT EXISTS (SELECT 1 FROM sources s WHERE s.company_id = c.id AND s.active = 1)
             AND COALESCE(c.probed_at, '') < ?))
       ORDER BY COALESCE(c.fit, 50) DESC, COALESCE(c.reviews, 0) DESC LIMIT ?`
    )
    .all(iso(RECHECK_DAYS.unreachable), iso(RECHECK_DAYS.dead_end), iso(RECHECK_DAYS.no_careers), limit);
}

// Already-judged companies that now show a careers page get watch sources straight away (no Claude);
// never-judged ones that now qualify go into a normal discovery packet.
export async function recheck({ limit = 40, probe = probeCompany, log = console.log } = {}) {
  const db = getDb();
  const due = dueForRecheck({ limit });
  if (!due.length) {
    log('[recheck] nothing due.');
    return { due: 0 };
  }
  const runId = startRun('recheck');
  const stats = { due: due.length, still_nothing: 0, new_sources: 0, new_hr_email: 0, for_claude: 0 };
  const forClaude = [];
  await mapLimit(due, config.fetchConcurrency, async (c) => {
    let p;
    try {
      p = await probe(c);
    } catch (e) {
      p = { reachable: false, error: e.message, ats: [], emails: [] };
    }
    const t = now();
    const reason = skipReason(p);
    if (c.discover_status === 'skipped') {
      if (reason) {
        db.prepare('UPDATE companies SET probe = ?, probed_at = ?, notes = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(p), t, reason, t, c.id);
        stats.still_nothing += 1;
      } else {
        db.prepare("UPDATE companies SET probe = ?, probed_at = ?, discover_status = 'probed', updated_at = ? WHERE id = ?").run(JSON.stringify(p), t, t, c.id);
        forClaude.push({ c, p });
      }
      return;
    }
    const plan = reason ? [] : planSources(p, { is_software: true, hiring_status: 'live', careers_url: p.careers?.url || null });
    for (const s of plan) {
      db.prepare(
        `INSERT INTO sources (company_id, kind, url, ats, slug, active) VALUES (?, ?, ?, ?, ?, 1)
         ON CONFLICT(company_id, url) DO UPDATE SET active = 1`
      ).run(c.id, s.kind, s.url, s.ats, s.slug);
      stats.new_sources += 1;
    }
    const hr = !c.hr_email && p.hr_email ? p.hr_email : null;
    if (hr) stats.new_hr_email += 1;
    if (!plan.length && !hr) stats.still_nothing += 1;
    db.prepare(
      `UPDATE companies SET probe = ?, probed_at = ?, hr_email = COALESCE(hr_email, ?), careers_url = COALESCE(?, careers_url),
       hiring_status = CASE WHEN ? THEN 'stale' ELSE hiring_status END, updated_at = ? WHERE id = ?`
    ).run(JSON.stringify(p), t, hr, plan.length ? p.careers?.url || null : null, plan.length ? 1 : 0, t, c.id);
  });
  await closeRenderBrowser();
  stats.for_claude = forClaude.length;
  if (forClaude.length) {
    const file = writeDiscoverPacket(runId, forClaude);
    endRun(runId, 'awaiting_claude', stats, path.relative(process.cwd(), file));
    log(`[recheck] ${JSON.stringify(stats)}`);
    log(`[recheck] CLAUDE: ${forClaude.length} company(ies) now worth judging. Read ${path.relative(process.cwd(), file)}, write ${runId}.out.json, then: npm run discover:apply -- ${runId}`);
  } else {
    endRun(runId, 'done', stats, stats.new_sources ? 'new careers pages added to watch' : 'nothing new');
    log(`[recheck] ${JSON.stringify(stats)}`);
  }
  return { runId, ...stats };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  backupDb('recheck');
  const limit = Number(process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] || 40);
  recheck({ limit })
    .catch((e) => {
      console.error('[recheck] error:', e.message);
      process.exitCode = 1;
    })
    .finally(() => {
      closeDb();
      setTimeout(() => process.exit(), 10);
    });
}
