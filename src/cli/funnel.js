import { getDb, parseJson } from '../db.js';
import { config } from '../config.js';
import { roleScore } from '../score/score.js';
import { outreachList } from '../outreach/drafts.js';

export const isEngineering = (title) => roleScore(title).pts >= 8;

export function funnel(city) {
  const db = getDb();
  const w = city ? 'WHERE city = ?' : '';
  const a = city ? [city] : [];
  const one = (sql, ...args) => Object.values(db.prepare(sql).get(...args))[0] || 0;
  const openJobs = db
    .prepare(`SELECT j.company_id, j.title, j.score FROM jobs j JOIN companies c ON c.id = j.company_id WHERE j.closed_at IS NULL ${city ? 'AND c.city = ?' : ''}`)
    .all(...a);
  const eng = openJobs.filter((j) => isEngineering(j.title));
  const matches = openJobs.filter((j) => j.score >= config.matchThreshold);
  return {
    maps_results: one(`SELECT SUM(results) FROM queries ${w}`, ...a),
    unique_places: one(`SELECT COUNT(*) FROM places ${w}`, ...a),
    noise_filtered: one(`SELECT COUNT(*) FROM places ${w ? w + ' AND' : 'WHERE'} filter_verdict = 'noise'`, ...a),
    companies: one(`SELECT COUNT(*) FROM companies ${w ? w + ' AND' : 'WHERE'} discover_status <> 'rozee'`, ...a),
    with_website: one(`SELECT COUNT(*) FROM companies ${w ? w + ' AND' : 'WHERE'} domain IS NOT NULL`, ...a),
    discovered: one(`SELECT COUNT(*) FROM companies ${w ? w + ' AND' : 'WHERE'} discover_status IN ('done', 'rejected', 'skipped')`, ...a),
    auto_skipped: one(`SELECT COUNT(*) FROM companies ${w ? w + ' AND' : 'WHERE'} discover_status = 'skipped'`, ...a),
    real_software: one(`SELECT COUNT(*) FROM companies ${w ? w + ' AND' : 'WHERE'} is_software = 1`, ...a),
    with_careers_or_ats: one(
      `SELECT COUNT(*) FROM companies c ${w ? w.replace('city', 'c.city') + ' AND' : 'WHERE'} c.is_software = 1 AND EXISTS (SELECT 1 FROM sources s WHERE s.company_id = c.id AND s.active = 1)`,
      ...a
    ),
    with_live_eng_jobs: new Set(eng.map((j) => j.company_id)).size,
    open_eng_jobs: eng.length,
    rozee_jobs: one(`SELECT COUNT(*) FROM jobs j JOIN companies c ON c.id = j.company_id WHERE j.extracted_by = 'rozee' AND j.closed_at IS NULL ${city ? 'AND c.city = ?' : ''}`, ...a),
    matches_60: matches.length,
    companies_with_match: new Set(matches.map((j) => j.company_id)).size,
    cold_email: outreachList().filter((c) => !city || c.city === city).length,
    pending_discovery: one(`SELECT COUNT(*) FROM companies ${w ? w + ' AND' : 'WHERE'} discover_status = 'pending'`, ...a),
  };
}

export function lastRuns(limit = 20) {
  return getDb()
    .prepare('SELECT * FROM runs ORDER BY started_at DESC LIMIT ?')
    .all(limit)
    .map((r) => ({ ...r, stats: parseJson(r.stats, {}) }));
}
