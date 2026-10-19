import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-apply-'));
process.env.RADAR_DATA_DIR = tmp;
process.env.RENDER_FALLBACK = '0';

const { getDb, closeDb, now } = await import('../src/db.js');
const { WORK_DIR } = await import('../src/config.js');
const { tex } = await import('../src/apply/latex.js');
const { claimProblems } = await import('../src/apply/facts.js');
const { pickCandidates, writePackPacket } = await import('../src/apply/pack.js');
const { checkEmail, validateEntry, applyPack } = await import('../src/apply/apply.js');

const facts = JSON.parse(fs.readFileSync(new URL('../config/facts.example.json', import.meta.url), 'utf8'));
facts.skills.never = ['LangChain', 'Java', '.NET', 'GraphQL'];

after(() => {
  closeDb();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('latex escaping', () => {
  assert.equal(tex('cut 85% & R&D_team #1 {x}'), 'cut 85\\% \\& R\\&D\\_team \\#1 \\{x\\}');
  assert.equal(tex('idea → POC'), 'idea to POC');
});

test('claim guard catches never-claim skills, degree and age, not look-alikes', () => {
  assert.deepEqual(claimProblems('Built RAG with LangChain', facts), ['never-claim skill: LangChain']);
  assert.deepEqual(claimProblems('JavaScript and Node.js', facts), []);
  assert.deepEqual(claimProblems('ASP.NET and C#', facts), ['never-claim skill: .NET']);
  assert.deepEqual(claimProblems('Self-taught, in place of a formal degree', facts), []);
  assert.deepEqual(claimProblems('Bachelor of Science in CS', facts), ['degree claim']);
  assert.deepEqual(claimProblems('I am 19 years old', facts), ['age']);
});

test('email confidence: good only from the company domain or the post', () => {
  const company = { domain: 'acme.com', job_urls: ['https://www.rozee.pk/acme-job-1'] };
  assert.equal(checkEmail({ to: 'hr@acme.com', found_at: 'https://acme.com/careers', confidence: 'good' }, company).email.confidence, 'good');
  assert.equal(checkEmail({ to: 'hr@acme.com', found_at: 'https://rocketreach.co/acme', confidence: 'good' }, company).email.confidence, 'ok');
  assert.equal(checkEmail({ to: 'not an email', confidence: 'ok' }, company).email, null);
  assert.equal(checkEmail(null, company).email.confidence, 'none');
});

test('entry validation', () => {
  const company = { job_ids: ['j1'] };
  const cv = { headline: 'X', summary: 'Y', skills: [{ label: 'A', items: 'B' }], current_bullets: [{ lead: 'L', text: 'T' }] };
  const ok = { decision: 'apply', job_ids: ['j1'], apply_via: 'form', subject: 'S', body: 'Hi there', cv };
  assert.deepEqual(validateEntry(ok, company).errors, []);
  assert.ok(validateEntry({ ...ok, job_ids: ['zz'] }, company).errors.length);
  assert.ok(validateEntry({ ...ok, body: 'Dear [NAME], hi' }, company).errors.length);
  assert.ok(validateEntry({ ...ok, body: 'word '.repeat(260) }, company).errors.length);
  assert.ok(validateEntry({ ...ok, apply_via: 'email', email: null }, company).errors.length);
  assert.deepEqual(validateEntry({ decision: 'skip', skip_reason: 'too senior' }, company).errors, []);
});

function seed() {
  const db = getDb();
  const t = now();
  const day = (d) => new Date(Date.now() - d * 86400000).toISOString();
  const co = db.prepare('INSERT INTO companies (key, domain, name, website, is_software, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)');
  const job = db.prepare(
    `INSERT INTO jobs (id, company_id, title, url, description, score, status, posted_at, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const a = co.run('a', 'alpha.com', 'Alpha', 'https://alpha.com', t, t).lastInsertRowid;
  const b = co.run('b', 'beta.com', 'Beta', 'https://beta.com', t, t).lastInsertRowid;
  const c = co.run('c', 'gamma.com', 'Gamma', 'https://gamma.com', t, t).lastInsertRowid;
  const long = 'Build React and Node.js features. '.repeat(30);
  job.run('a1', a, 'Full Stack Developer', 'https://www.rozee.pk/a1', long, 90, 'new', day(1), t, t);
  job.run('a2', a, 'Backend Developer', 'https://www.rozee.pk/a2', long, 80, 'new', null, t, t);
  job.run('a3', a, 'Old Post', 'https://www.rozee.pk/a3', long, 95, 'new', day(20), t, t);
  job.run('b1', b, 'MERN Developer', 'https://www.rozee.pk/b1', long, 85, 'new', day(2), t, t);
  job.run('b2', b, 'React Developer', 'https://www.rozee.pk/b2', long, 70, 'applied', day(2), t, t);
  job.run('c1', c, 'Node Developer', 'https://www.rozee.pk/c1', long, 50, 'new', day(1), t, t);
  return { a, b, c };
}

let ids;
test('candidates: grouped by company, fresh only, skip applied companies and low scores', () => {
  ids = seed();
  const got = pickCandidates({ top: 10 });
  assert.deepEqual(got.map((c) => c.name), ['Alpha']);
  assert.deepEqual(got[0].jobs.map((j) => j.id), ['a1', 'a2']);
  assert.deepEqual(pickCandidates({ jobIds: ['b1'] }).map((c) => c.name), ['Beta']);
});

test('pack:apply builds a one-page PDF and refuses never-claim skills', async () => {
  const runId = 'pack-test';
  const companies = pickCandidates({ top: 10 });
  for (const c of companies) for (const j of c.jobs) j.full_text = j.description;
  writePackPacket(runId, companies);
  const cv = (extra = '') => ({
    pdf_role: 'Full Stack Developer',
    headline: 'Full Stack Developer | React, Node.js',
    location: 'remote_or_onsite',
    summary: `Full-stack developer who builds React and Node.js features end to end.${extra}`,
    skills: [{ label: 'Frontend', items: 'React, TypeScript' }, { label: 'Backend', items: 'Node.js, Express' }],
    current_title: 'Full-Stack Developer',
    current_bullets: [{ lead: 'Messaging', text: 'Built 21 REST endpoints and the React UI; cut cost 85%.' }],
    freelance_bullet: 'Built sites for small businesses.',
  });
  const entry = {
    company_id: ids.a,
    decision: 'apply',
    job_ids: ['a1', 'a2'],
    role: 'Full Stack Developer',
    apply_via: 'email',
    apply_url: 'https://www.rozee.pk/a1',
    email: { to: 'careers@alpha.com', found_at: 'https://alpha.com/careers', confidence: 'good' },
    subject: 'Application: Full Stack Developer (Your Name)',
    body: 'Hi Alpha team,\n\nShort and true.\n\nThanks,\nYour Name',
    cv: cv(),
    answers: { why_us: 'You build products.', cover_note: 'Short note.' },
  };
  fs.writeFileSync(path.join(WORK_DIR, `${runId}.out.json`), JSON.stringify([entry]));
  const r = await applyPack(runId, { log: () => {}, facts });
  assert.equal(r.ready, 1, JSON.stringify(r.failed));
  const folder = fs.readdirSync(r.runDir).find((d) => d.startsWith('01-'));
  const files = fs.readdirSync(path.join(r.runDir, folder));
  assert.ok(files.some((f) => f.endsWith('.pdf')));
  assert.ok(files.includes('email.txt') && files.includes('answers.txt'));
  assert.match(fs.readFileSync(path.join(r.runDir, 'README.md'), 'utf8'), /careers@alpha\.com \(good/);
  assert.equal(getDb().prepare("SELECT COUNT(*) n FROM applications WHERE status = 'ready'").get().n, 1);
  assert.deepEqual(pickCandidates({ top: 10 }), [], 'a packed company is not offered again');

  fs.writeFileSync(path.join(WORK_DIR, `${runId}.out.json`), JSON.stringify([{ ...entry, cv: cv(' Uses LangChain daily.') }]));
  const bad = await applyPack(runId, { log: () => {}, facts });
  assert.equal(bad.ready, 0);
  assert.match(bad.failed[0].problems.join(), /LangChain/);
  assert.equal(getDb().prepare("SELECT COUNT(*) n FROM applications WHERE status = 'ready'").get().n, 0, 'a re-run replaces the old rows');
});

test('claimProblems: phrases listed in never_phrases are refused, case and spacing aside', () => {
  const facts = { skills: { never: [] }, never_phrases: ['works at Acme Labs'] };
  assert.deepEqual(claimProblems('I  Works AT acme labs today.', facts), ['never-say phrase: works at Acme Labs']);
  assert.deepEqual(claimProblems('I work with Acme Labs.', facts), []);
});
