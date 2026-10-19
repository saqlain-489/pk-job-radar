import { getDb, now, parseJson } from '../db.js';
import { profile } from '../config.js';
import { enrichJob } from '../score/jobText.js';
import { scoreJob, postedDate } from '../score/score.js';

export const slugify = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

export function pageJobId(companyId, title, city) {
  return `page:${companyId}:${slugify(title)}${city ? `:${slugify(city)}` : ''}`;
}

const TITLE_SWAPS = [
  [/\bsr\b\.?|\bsnr\b/g, 'senior'], [/\bjr\b\.?/g, 'junior'], [/\bengr\b\.?/g, 'engineer'], [/\bdev\b(?!ops)/g, 'developer'],
  [/\bon[\s-]?site\b/g, 'onsite'], [/\bwork from home\b/g, 'remote'], [/\bfull[\s-]?stack\b/g, 'fullstack'], [/\bfront[\s-]?end\b/g, 'frontend'], [/\bback[\s-]?end\b/g, 'backend'],
  [/\bnode\.?js\b/g, 'node'], [/\breact\.?js\b/g, 'react'], [/\bnext\.?js\b/g, 'next'], [/\bmern stack\b/g, 'mern'],
];
const TITLE_NOISE = new Set(['the', 'a', 'an', 'and', 'for', 'at', 'in', 'of', 'position', 'role', 'job', 'opening', 'vacancy', 'hiring',
  'urgent', 'urgently', 'required', 'needed', 'wanted', 'immediate', 'stack', 'remote', 'onsite', 'hybrid', 'fulltime', 'full', 'time', 'pakistan',
  'lahore', 'karachi', 'islamabad', 'rawalpindi', 'faisalabad']);
const SENIORITY = new Set(['senior', 'junior', 'lead', 'principal', 'staff', 'intern', 'internship', 'trainee', 'associate', 'mid', 'head', 'manager']);

export function titleTokens(title) {
  let t = String(title || '').toLowerCase().normalize('NFKD');
  for (const [re, to] of TITLE_SWAPS) t = t.replace(re, to);
  return new Set(t.replace(/[^a-z0-9+#]+/g, ' ').split(' ').filter((w) => w && !TITLE_NOISE.has(w)));
}

// Claude may word an unchanged post slightly differently on a re-read ("Sr. React Developer" vs
// "Senior React Developer"); reusing the old id keeps its first_seen so it can't pose as fresh.
export function matchExisting(title, city, candidates) {
  const a = titleTokens(title);
  let best = null;
  let bestSim = 0;
  for (const c of candidates) {
    if (city && c.city && city.toLowerCase() !== String(c.city).toLowerCase()) continue;
    const b = titleTokens(c.title);
    const senA = [...a].filter((w) => SENIORITY.has(w)).sort().join();
    const senB = [...b].filter((w) => SENIORITY.has(w)).sort().join();
    if (senA !== senB) continue;
    const inter = [...a].filter((w) => b.has(w)).length;
    const sim = inter / (a.size + b.size - inter || 1);
    if (sim > bestSim) {
      bestSim = sim;
      best = c;
    }
  }
  return bestSim >= 0.75 ? best : null;
}

// Stable id for a page job: exact title+city first, else the closest earlier wording from the same source.
export function resolvePageJobId(companyId, sourceId, job, used = new Set()) {
  const exact = pageJobId(companyId, job.title, job.city);
  const db = getDb();
  if (db.prepare('SELECT 1 FROM jobs WHERE id = ?').get(exact)) {
    used.add(exact);
    return exact;
  }
  const candidates = db
    .prepare("SELECT id, title, city FROM jobs WHERE source_id = ? AND (closed_at IS NULL OR closed_at > datetime('now', '-60 days'))")
    .all(sourceId)
    .filter((c) => !used.has(c.id));
  const m = matchExisting(job.title, job.city, candidates);
  const id = m ? m.id : exact;
  used.add(id);
  return id;
}

export function closeExpired(t = now()) {
  return getDb()
    .prepare("UPDATE jobs SET closed_at = ? WHERE closed_at IS NULL AND closes_at IS NOT NULL AND substr(closes_at, 1, 10) < substr(?, 1, 10)")
    .run(t, t).changes;
}

function rowToJob(r) {
  return { ...r, skills: parseJson(r.skills, []), flags: parseJson(r.flags, []), experience_inferred: !!r.experience_inferred };
}

// Inserts or refreshes a job; keeps first_seen and the user's status, reopens it if it had closed.
// sourceSeenBefore: the page/feed was already checked once, so a job new to it really is new.
const KEEP_IF_BLANK = ['location_text', 'location_type', 'city', 'experience_min', 'experience_max', 'salary_min', 'salary_max',
  'employment_type', 'description', 'apply_method', 'apply_contact'];
const blank = (v) => v == null || v === '' || (Array.isArray(v) && !v.length);

// A thinner re-read (only titles visible today) must not wipe details an earlier read captured.
function mergeWithExisting(raw, row) {
  if (!row) return raw;
  const out = { ...raw };
  for (const k of KEEP_IF_BLANK) if (blank(out[k]) && !blank(row[k])) out[k] = row[k];
  if (blank(out.skills)) out.skills = parseJson(row.skills, []);
  if (blank(out.flags)) out.flags = parseJson(row.flags, []);
  if (row.url && (!out.url || out.url === out.source_url)) out.url = row.url;
  return out;
}

export function upsertJob(raw, company, { sourceId, extractedBy, t = now(), sourceSeenBefore = false }) {
  const db = getDb();
  const prev = raw.id ? db.prepare('SELECT * FROM jobs WHERE id = ?').get(raw.id) : null;
  const j = enrichJob(mergeWithExisting(raw, prev));
  const existing = prev && { id: prev.id, posted_at: prev.posted_at, posted_source: prev.posted_source, closes_at: prev.closes_at };
  if (!j.closes_at && existing?.closes_at) j.closes_at = existing.closes_at;
  if (postedDate(j.posted_at) !== null) j.posted_source = 'post';
  else if (existing?.posted_at) Object.assign(j, { posted_at: existing.posted_at, posted_source: existing.posted_source });
  else if (!existing && sourceSeenBefore) Object.assign(j, { posted_at: t, posted_source: 'first_seen' });
  else Object.assign(j, { posted_at: null, posted_source: null });
  const { score, reasons, flags: scoreFlags } = scoreJob(j, company, profile);
  const vals = {
    company_id: company.id, source_id: sourceId, title: j.title, url: j.url || null, location_text: j.location_text || null,
    location_type: j.location_type || null, city: j.city || null, country: j.country || null,
    experience_min: j.experience_min, experience_max: j.experience_max, experience_inferred: j.experience_inferred ? 1 : 0,
    salary_min: j.salary_min, salary_max: j.salary_max, employment_type: j.employment_type || null,
    skills: JSON.stringify(j.skills || []), description: (j.description || '').slice(0, 6000), apply_method: j.apply_method,
    apply_contact: j.apply_contact, flags: JSON.stringify(j.flags || []), score, reasons: JSON.stringify(reasons),
    score_flags: JSON.stringify(scoreFlags), extracted_by: extractedBy, posted_at: j.posted_at || null, posted_source: j.posted_source || null,
    closes_at: j.closes_at || null,
  };
  if (existing) {
    const sets = Object.keys(vals).map((k) => `${k} = @${k}`).join(', ');
    db.prepare(`UPDATE jobs SET ${sets}, last_seen = @t, closed_at = NULL WHERE id = @id`).run({ ...vals, t, id: j.id });
  } else {
    const cols = Object.keys(vals);
    db.prepare(
      `INSERT INTO jobs (id, ${cols.join(', ')}, first_seen, last_seen, status) VALUES (@id, ${cols.map((c) => '@' + c).join(', ')}, @t, @t, 'new')`
    ).run({ ...vals, id: j.id, t });
  }
  return { id: j.id, isNew: !existing, score };
}

export function closeMissing(sourceId, seenIds, t = now()) {
  const db = getDb();
  const open = db.prepare('SELECT id FROM jobs WHERE source_id = ? AND closed_at IS NULL').all(sourceId);
  const seen = new Set(seenIds);
  let closed = 0;
  for (const { id } of open) {
    if (seen.has(id)) continue;
    db.prepare('UPDATE jobs SET closed_at = ? WHERE id = ?').run(t, id);
    closed += 1;
  }
  return closed;
}

export function touchOpen(sourceId, t = now()) {
  getDb().prepare('UPDATE jobs SET last_seen = ? WHERE source_id = ? AND closed_at IS NULL').run(t, sourceId);
}

// Re-scores every job from stored fields; cheap, run after any scoring or profile change.
export function rescoreAll() {
  const db = getDb();
  const companies = new Map(db.prepare('SELECT * FROM companies').all().map((c) => [c.id, c]));
  const rows = db.prepare('SELECT * FROM jobs').all();
  const upd = db.prepare('UPDATE jobs SET score = ?, reasons = ?, score_flags = ? WHERE id = ?');
  for (const r of rows) {
    const { score, reasons, flags } = scoreJob(rowToJob(r), companies.get(r.company_id), profile);
    upd.run(score, JSON.stringify(reasons), JSON.stringify(flags), r.id);
  }
  return rows.length;
}
