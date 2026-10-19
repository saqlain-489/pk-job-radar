import { getDb, parseJson } from '../db.js';
import { config, profile } from '../config.js';

const OVERLAP = ['react', 'next.js', 'node.js', 'typescript', 'mern', 'express', 'ai/ml', 'postgres', 'mongodb', 'redis', 'python'];

export const shortName = (name) =>
  String(name || '')
    .replace(/\s*[|:–-]\s.*$/, '')
    .replace(/\([^)]*\b(?:pvt|private|smc|ltd|limited)\b[^)]*\)/gi, '')
    .replace(/\b(?:pvt|private|smc|limited|ltd|inc|llc)\b\.?/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

export function draftEmail(company, p = profile) {
  const name = shortName(company.name) || company.name;
  const stack = parseJson(company.stack, []).filter((s) => OVERLAP.includes(String(s).toLowerCase()));
  const first = p.name.split(' ')[0];
  const lines = [`Hi ${name} team,`, ''];
  if (company.hook) lines.push(company.hook.trim(), '');
  lines.push(
    `I'm ${first}, ${p.email_intro}`
  );
  if (stack.length) lines.push('', `${stack.slice(0, 3).join(', ')} ${stack.length > 1 ? 'are' : 'is'} what I use every day, so I could be useful quickly.`);
  lines.push(
    '',
    p.email_ask,
    '',
    'Thanks,',
    p.name,
    `${p.phone} · ${p.email} · ${p.github}`
  );
  return { subject: `Full-stack / AI engineer for ${name}`, body: lines.join('\n') };
}

// Good-fit companies with an HR inbox and nothing open to apply to.
export function outreachList({ minFit = config.outreachMinFit } = {}) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM jobs j WHERE j.company_id = c.id AND j.closed_at IS NULL AND j.score >= 40) AS open_fit_jobs
       FROM companies c
       WHERE c.is_software = 1 AND c.hr_email IS NOT NULL AND c.hr_email <> '' AND COALESCE(c.fit, 0) >= ?
       ORDER BY c.fit DESC, c.reviews DESC`
    )
    .all(minFit);
  return rows
    .filter((c) => c.open_fit_jobs === 0)
    .map((c) => ({ ...c, stack: parseJson(c.stack, []), draft: draftEmail(c) }));
}
