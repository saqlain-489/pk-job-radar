import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { WORK_DIR, DATA_DIR } from '../config.js';
import { getDb, closeDb, now, tx, endRun } from '../db.js';
import { readOut } from '../discover/apply.js';
import { registrableDomain, hostOf } from '../lib/domain.js';
import { backupDb } from '../lib/backup.js';
import { loadFacts, claimProblems } from './facts.js';
import { buildCvTex, LAYOUTS } from './latex.js';

const run = promisify(execFile);
export const PACKS_DIR = path.join(DATA_DIR, 'packs');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const CONFIDENCE = new Set(['good', 'ok', 'risky', 'none']);
const VIA = new Set(['email', 'form', 'link', 'rozee']);
const MAX_BODY_WORDS = 200;

const slug = (s) => String(s || '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
const words = (s) => String(s || '').split(/\s+/).filter(Boolean).length;

// A "good" address must come from the company's own site or the post itself; anything else is at best "ok".
export function checkEmail(email, company) {
  const notes = [];
  if (!email || !email.to) return { email: { to: null, found_at: null, confidence: 'none' }, notes };
  const to = String(email.to).trim().toLowerCase();
  if (!EMAIL_RE.test(to)) return { email: null, notes: [`"${email.to}" is not an email address`] };
  let confidence = CONFIDENCE.has(email.confidence) ? email.confidence : 'risky';
  if (!email.found_at) notes.push(`${to}: no source URL given`);
  if (confidence === 'good') {
    const srcDomain = registrableDomain(hostOf(email.found_at || '') || '');
    const own = [company.domain, ...(company.job_urls || []).map((u) => registrableDomain(hostOf(u) || ''))].filter(Boolean);
    if (!srcDomain || !own.includes(srcDomain)) {
      confidence = 'ok';
      notes.push(
        company.domain
          ? `${to}: found off the company's own site, so marked "ok" not "good"`
          : `${to}: we have no website on record for this company, so the address can't be confirmed as theirs ("ok", not "good")`
      );
    }
  }
  return { email: { to, found_at: email.found_at || null, confidence }, notes };
}

export function validateEntry(o, company) {
  const errors = [];
  if (!['apply', 'skip'].includes(o.decision)) errors.push('decision must be apply or skip');
  if (o.decision === 'skip') return { errors };
  const ids = new Set(company.job_ids);
  if (!Array.isArray(o.job_ids) || !o.job_ids.length || o.job_ids.some((id) => !ids.has(id))) errors.push('job_ids must be ids from this company block');
  if (!VIA.has(o.apply_via)) errors.push('apply_via must be email, form, link or rozee');
  if (o.apply_via === 'email' && !o.email?.to) errors.push('apply_via is email but there is no email.to');
  if (!o.subject || !o.body) errors.push('subject and body are required');
  if (/\[[A-Z ]+\]|\{\{|TODO|lorem/i.test(`${o.subject} ${o.body}`)) errors.push('email still has a placeholder');
  if (words(o.body) > MAX_BODY_WORDS) errors.push(`email body is ${words(o.body)} words; keep it under ${MAX_BODY_WORDS}`);
  const cv = o.cv || {};
  if (!cv.headline || !cv.summary || !cv.skills?.length || !cv.current_bullets?.length) errors.push('cv needs headline, summary, skills and current_bullets');
  return { errors };
}

async function compile(dir, name, cv, facts) {
  let pages = 0;
  for (const layout of LAYOUTS) {
    fs.writeFileSync(path.join(dir, `${name}.tex`), buildCvTex(cv, facts, layout));
    await run('lualatex', ['-interaction=nonstopmode', '-halt-on-error', `${name}.tex`], { cwd: dir, timeout: 120000 }).catch(() => {});
    const log = fs.existsSync(path.join(dir, `${name}.log`)) ? fs.readFileSync(path.join(dir, `${name}.log`), 'utf8') : '';
    const m = log.match(/Output written on .*?\((\d+) pages?/);
    if (!m) {
      const err = (log.match(/^! .*$/m) || ['no output'])[0];
      return { ok: false, error: `LaTeX failed: ${err}` };
    }
    pages = Number(m[1]);
    if (pages === 1) break;
  }
  for (const ext of ['aux', 'log', 'out']) fs.rmSync(path.join(dir, `${name}.${ext}`), { force: true });
  if (pages !== 1) return { ok: false, error: `CV is ${pages} pages even at the tightest layout; cut text` };
  const { stdout } = await run('pdftotext', [path.join(dir, `${name}.pdf`), '-']);
  return { ok: true, text: stdout };
}

const gmailLink = (facts, to, subject, body) =>
  `https://mail.google.com/mail/?authuser=${encodeURIComponent(facts.contact.email)}&view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

function answersText(o, facts) {
  const a = facts.answers || {};
  const fill = (v) => (v == null ? 'FILL IN (not in the fact bank yet)' : v);
  return [
    `Why this company: ${o.answers?.why_us || '-'}`,
    '',
    `Cover note: ${o.answers?.cover_note || '-'}`,
    '',
    `Expected salary (PKR/month): ${fill(a.expected_salary_pkr)}`,
    `Current salary (PKR/month): ${fill(a.current_salary_pkr)}`,
    `Notice period: ${fill(a.notice_period)}`,
    `Location / relocation: ${fill(a.relocation)}`,
    `Shift: ${fill(a.shift)}`,
    `Experience: ${facts.experience.current.years_text} at ${facts.experience.current.employer}, plus ${facts.experience.freelance.dates} freelance`,
    `Education: ${facts.education}`,
    `GitHub: ${facts.contact.github_url}`,
    `LinkedIn: ${facts.contact.linkedin_url}`,
  ].join('\n');
}

export async function applyPack(runId, { log = console.log, facts = loadFacts() } = {}) {
  const out = readOut(path.join(WORK_DIR, `${runId}.out.json`));
  const sent = JSON.parse(fs.readFileSync(path.join(WORK_DIR, `${runId}.companies.json`), 'utf8'));
  const byId = new Map(sent.map((c) => [c.company_id, c]));
  const missing = sent.filter((c) => !out.some((o) => o.company_id === c.company_id)).map((c) => c.name);
  const runDir = path.join(PACKS_DIR, runId);
  // Re-running after a fix rebuilds the whole pack instead of stacking duplicates.
  fs.rmSync(runDir, { recursive: true, force: true });
  fs.mkdirSync(runDir, { recursive: true });
  const ready = [];
  const skipped = [];
  const failed = [];
  let n = 0;
  for (const o of out) {
    const company = byId.get(o.company_id);
    if (!company) {
      failed.push({ name: `company ${o.company_id}`, problems: ['not in this pack'] });
      continue;
    }
    const { errors } = validateEntry(o, company);
    if (errors.length) {
      failed.push({ name: company.name, problems: errors });
      continue;
    }
    if (o.decision === 'skip') {
      skipped.push({ company, reason: o.skip_reason || 'no reason given', o });
      continue;
    }
    const { email, notes: emailNotes } = checkEmail(o.email, company);
    if (!email) {
      failed.push({ name: company.name, problems: emailNotes });
      continue;
    }
    const claimHits = [...new Set([...claimProblems(JSON.stringify(o.cv), facts), ...claimProblems(o.body, facts), ...claimProblems(JSON.stringify(o.answers || {}), facts)])];
    if (claimHits.length) {
      failed.push({ name: company.name, problems: claimHits });
      continue;
    }
    n += 1;
    const folder = path.join(runDir, `${String(n).padStart(2, '0')}-${slug(company.name)}`);
    fs.mkdirSync(folder, { recursive: true });
    const name = `${slug(facts.contact.name)}_${slug(company.name)}_${slug(o.role || o.cv.pdf_role)}`;
    const built = await compile(folder, name, o.cv, facts);
    if (!built.ok) {
      failed.push({ name: company.name, problems: [built.error] });
      fs.rmSync(folder, { recursive: true, force: true });
      n -= 1;
      continue;
    }
    const pdfHits = claimProblems(built.text, facts);
    if (pdfHits.length) {
      failed.push({ name: company.name, problems: pdfHits.map((p) => `in the PDF: ${p}`) });
      fs.rmSync(folder, { recursive: true, force: true });
      n -= 1;
      continue;
    }
    const emailTxt = [
      `To: ${email.to || '(no email: apply via ' + o.apply_via + ')'}`,
      `Email found at: ${email.found_at || '-'} (${email.confidence})`,
      `Apply link: ${o.apply_url || '-'}`,
      `Subject: ${o.subject}`,
      `Attach: ${name}.pdf`,
      '',
      o.body.trim(),
      '',
    ].join('\n');
    fs.writeFileSync(path.join(folder, 'email.txt'), emailTxt);
    fs.writeFileSync(path.join(folder, 'answers.txt'), `${answersText(o, facts)}\n`);
    ready.push({ company, o, email, folder, pdf: path.join(folder, `${name}.pdf`), notes: [...emailNotes, ...(o.notes_for_saqlain || [])] });
  }

  backupDb('pack-apply');
  const db = getDb();
  const t = now();
  tx(() => {
    db.prepare("DELETE FROM applications WHERE run_id = ? AND status IN ('ready','skipped')").run(runId);
    const ins = db.prepare(
      `INSERT INTO applications (run_id, company_id, job_ids, status, reason, apply_via, apply_url, email_to, email_found_at, email_confidence, subject, body, cv_path, folder, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const r of ready)
      ins.run(runId, r.company.company_id, JSON.stringify(r.o.job_ids), 'ready', null, r.o.apply_via, r.o.apply_url || null, r.email.to, r.email.found_at, r.email.confidence, r.o.subject, r.o.body, r.pdf, r.folder, t);
    for (const s of skipped) ins.run(runId, s.company.company_id, JSON.stringify(s.company.job_ids), 'skipped', s.reason, null, null, null, null, null, null, null, null, null, t);
  });

  fs.writeFileSync(path.join(runDir, 'README.md'), readme(runId, ready, skipped, failed, missing, facts));
  const stats = { ready: ready.length, skipped: skipped.length, failed: failed.length, missing: missing.length };
  endRun(runId, failed.length || missing.length ? 'partial' : 'done', stats);
  log(`[pack:apply] ${JSON.stringify(stats)}`);
  for (const f of failed) log(`[pack:apply] FIX ${f.name}: ${f.problems.join('; ')}`);
  if (missing.length) log(`[pack:apply] missing from the answer: ${missing.join(', ')}`);
  log(`[pack:apply] open ${path.relative(process.cwd(), path.join(runDir, 'README.md'))}`);
  return { ...stats, runDir, failed };
}

function readme(runId, ready, skipped, failed, missing, facts) {
  const rel = (p) => path.relative(path.join(PACKS_DIR, runId), p);
  const lines = [`# Apply pack ${runId}`, '', `${ready.length} ready · ${skipped.length} skipped${failed.length ? ` · ${failed.length} need a fix` : ''}`, ''];
  lines.push('Send from your personal Gmail, by hand, spread over the day (10–15 a day). Mark each one "applied" in the dashboard after sending.', '');
  for (const [i, r] of ready.entries()) {
    const o = r.o;
    lines.push(`## ${i + 1}. ${r.company.name} — ${o.role || o.cv.pdf_role}`);
    lines.push(`- Apply via: **${o.apply_via}**${o.apply_url ? ` · [post](${o.apply_url})` : ''}`);
    if (r.email.to) lines.push(`- To: ${r.email.to} (${r.email.confidence}${r.email.found_at ? `, [found here](${r.email.found_at})` : ''})`);
    lines.push(`- Subject: ${o.subject}`);
    lines.push(`- CV: [${path.basename(r.pdf)}](${rel(r.pdf)}) · [email.txt](${rel(path.join(r.folder, 'email.txt'))}) · [answers.txt](${rel(path.join(r.folder, 'answers.txt'))})`);
    if (r.email.to) lines.push(`- [Open in Gmail (${facts.contact.email})](${gmailLink(facts, r.email.to, o.subject, o.body)}), then attach the PDF`);
    for (const note of r.notes) lines.push(`- ⚠ ${note}`);
    lines.push('');
  }
  if (skipped.length) lines.push('## Skipped', ...skipped.map((s) => `- ${s.company.name}: ${s.reason}`), '');
  if (failed.length) lines.push('## Needs a fix (not built)', ...failed.map((f) => `- ${f.name}: ${f.problems.join('; ')}`), '');
  if (missing.length) lines.push('## Missing from the answer', ...missing.map((m) => `- ${m}`), '');
  return `${lines.join('\n')}\n`;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const runId = process.argv[2];
  if (!runId) {
    console.error('usage: npm run pack:apply -- <pack-run-id>');
    process.exit(1);
  }
  applyPack(runId)
    .catch((e) => {
      console.error(`[pack:apply] failed: ${e.message}`);
      process.exitCode = 1;
    })
    .finally(closeDb);
}
