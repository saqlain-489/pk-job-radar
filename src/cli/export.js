import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config.js';
import { getDb, closeDb, parseJson } from '../db.js';

const cell = (v) => {
  const s = Array.isArray(v) ? v.join('; ') : v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function jobsCsv({ includeClosed = false } = {}) {
  const rows = getDb()
    .prepare(
      `SELECT j.*, c.name AS company, c.domain, c.kind, c.size, c.contacted FROM jobs j JOIN companies c ON c.id = j.company_id
       ${includeClosed ? '' : 'WHERE j.closed_at IS NULL'} ORDER BY j.score DESC`
    )
    .all();
  const cols = ['score', 'title', 'company', 'domain', 'location_type', 'city', 'experience_min', 'experience_max', 'salary_min', 'salary_max',
    'employment_type', 'status', 'flags', 'reasons', 'apply_method', 'apply_contact', 'url', 'posted_at', 'posted_source', 'first_seen', 'closed_at', 'kind', 'size', 'contacted'];
  const lines = [cols.join(',')];
  for (const r of rows) {
    const v = { ...r, flags: parseJson(r.score_flags, []), reasons: parseJson(r.reasons, []), contacted: r.contacted ? 'yes' : '' };
    lines.push(cols.map((c) => cell(v[c])).join(','));
  }
  return lines.join('\n') + '\n';
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const dir = path.join(DATA_DIR, 'exports');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `jobs-${new Date().toISOString().slice(0, 10)}.csv`);
  fs.writeFileSync(file, jobsCsv({ includeClosed: process.argv.includes('--all') }));
  console.log(`[export] ${file}`);
  closeDb();
}
