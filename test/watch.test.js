import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-test-'));
process.env.RADAR_DATA_DIR = tmp;
process.env.RENDER_FALLBACK = '0';
process.env.PER_HOST_DELAY_MS = '0';

const page = (f) => fs.readFileSync(new URL(`./fixtures/pages/${f}`, import.meta.url), 'utf8');
const { contentHash } = await import('../src/lib/text.js');
const { getDb, closeDb, now } = await import('../src/db.js');
const { watch } = await import('../src/watch/run.js');
const { applyExtract } = await import('../src/watch/apply.js');
const { planSources } = await import('../src/discover/apply.js');

let server;
let current = 'careers-plain-v1.html';
let gammaP2 = 'careers-paged-p2.html';
let base;

before(async () => {
  server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    if (req.url === '/careers') return res.end(page(current));
    if (req.url === '/beta/careers') return res.end(page('careers-jsonld.html'));
    if (req.url === '/gamma/careers' || req.url === '/gamma/careers?a=1') return res.end(page('careers-paged-p1.html'));
    if (req.url === '/gamma/careers?a=2') return res.end(page(gammaP2));
    res.end(`<html><body><main><h1>${req.url}</h1><p>${'Role details. '.repeat(40)}</p></main></body></html>`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const db = getDb();
  const t = now();
  db.prepare(
    `INSERT INTO companies (id, key, domain, name, website, city, is_software, kind, foreign_clients, discover_status, created_at, updated_at)
     VALUES (1, 'acmesoft.pk', 'acmesoft.pk', 'Acme Soft', ?, 'lahore', 1, 'product', 1, 'done', ?, ?)`
  ).run(base, t, t);
  db.prepare("INSERT INTO sources (id, company_id, kind, url) VALUES (1, 1, 'page', ?)").run(`${base}/careers`);
});

after(() => {
  server.close();
  closeDb();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const quiet = () => {};
const writeOut = (runId, jobs) =>
  fs.writeFileSync(path.join(tmp, 'work', `${runId}.out.json`), JSON.stringify([{ source_id: 1, hiring_status: 'live', jobs }]));

const MERN = { title: 'Full Stack Developer (MERN)', location_type: 'hybrid', city: 'lahore', experience_min: 2, experience_max: 3, skills: ['react', 'node.js', 'mongodb'], summary: 'Build SaaS features.' };
const SQA = { title: 'SQA Engineer', location_type: 'onsite', city: 'lahore', experience_min: 1, experience_max: 2, skills: ['selenium'], summary: 'Manual and automation testing.' };
const AI = { title: 'AI Engineer (LLM, Agents)', location_type: 'remote', experience_min: 2, experience_max: 4, skills: ['python', 'llm', 'agents', 'typescript'], summary: 'Agent pipelines.' };

test('hash ignores clocks, counters, csrf tokens and footer years', () => {
  assert.equal(contentHash(page('careers-plain-v1.html')), contentHash(page('careers-plain-v1-noise.html')));
  assert.notEqual(contentHash(page('careers-plain-v1.html')), contentHash(page('careers-plain-v2.html')));
});

test('first watch sends the new page to Claude; apply stores jobs', async () => {
  const r = await watch({ log: quiet });
  assert.equal(r.packet, 1);
  assert.ok(fs.readFileSync(path.join(tmp, 'work', `${r.runId}.md`), 'utf8').includes('Full Stack Developer (MERN)'));
  writeOut(r.runId, [MERN, SQA]);
  const s = applyExtract(r.runId, { log: quiet });
  assert.equal(s.new_jobs, 2);
  const jobs = getDb().prepare('SELECT * FROM jobs WHERE closed_at IS NULL').all();
  assert.equal(jobs.length, 2);
  assert.ok(jobs.find((j) => j.title.includes('MERN')).score >= 70);
});

test('re-running watch with only noise changes makes zero Claude extraction calls', async () => {
  current = 'careers-plain-v1-noise.html';
  const r = await watch({ log: quiet });
  assert.equal(r.packet, 0);
  assert.equal(r.stats.unchanged, 1);
  assert.equal(r.stats.claude_pages, 0);
  assert.ok(!fs.existsSync(path.join(tmp, 'work', `${r.runId}.md`)));
  assert.equal(getDb().prepare('SELECT COUNT(*) n FROM jobs WHERE closed_at IS NULL').get().n, 2);
});

test('a real change goes back to Claude; vanished jobs close, first_seen is kept', async () => {
  const before = getDb().prepare("SELECT first_seen FROM jobs WHERE title LIKE '%MERN%'").get().first_seen;
  current = 'careers-plain-v2.html';
  const r = await watch({ log: quiet });
  assert.equal(r.packet, 1);
  writeOut(r.runId, [MERN, AI]);
  const s = applyExtract(r.runId, { log: quiet });
  assert.equal(s.new_jobs, 1);
  assert.equal(s.closed, 1);
  const db = getDb();
  assert.ok(db.prepare("SELECT closed_at FROM jobs WHERE title = 'SQA Engineer'").get().closed_at);
  assert.equal(db.prepare("SELECT first_seen FROM jobs WHERE title LIKE '%MERN%'").get().first_seen, before);
});

test('undated jobs get an age only once the page was already being watched', () => {
  const db = getDb();
  const ai = db.prepare("SELECT posted_at, posted_source FROM jobs WHERE title LIKE 'AI Engineer%'").get();
  assert.equal(ai.posted_source, 'first_seen');
  assert.ok(ai.posted_at);
  const mern = db.prepare("SELECT posted_at, posted_source FROM jobs WHERE title LIKE '%MERN%'").get();
  assert.equal(mern.posted_at, null);
  assert.equal(mern.posted_source, null);
});

test('an unapplied packet is re-sent next run instead of being lost', async () => {
  current = 'careers-plain-v1.html';
  const r1 = await watch({ log: quiet });
  assert.equal(r1.packet, 1);
  const r2 = await watch({ log: quiet });
  assert.equal(r2.packet, 1);
});

test('an ATS feed source replaces the careers page source', () => {
  const probe = { ats: [{ ats: 'lever', slug: '10pearls', feed: true }], careers: { url: 'https://10pearls.com/careers' } };
  const plan = planSources(probe, { is_software: true, hiring_status: 'live', careers_url: 'https://10pearls.com/careers' });
  assert.deepEqual(plan.map((s) => s.kind), ['ats']);
  const plain = planSources({ ats: [], careers: { url: 'https://x.pk/careers' } }, { is_software: true, hiring_status: 'hr_email' });
  assert.deepEqual(plain.map((s) => s.url), ['https://x.pk/careers']);
  assert.deepEqual(planSources({ ats: [] }, { is_software: true, hiring_status: 'none' }), []);
});

test('a re-read with re-worded titles keeps the old jobs instead of creating "fresh" ones', async () => {
  const db = getDb();
  current = 'careers-plain-v1-noise.html';
  const r = await watch({ log: quiet });
  assert.equal(r.packet, 1);
  const before = db.prepare("SELECT id, first_seen FROM jobs WHERE title LIKE '%MERN%'").get();
  writeOut(r.runId, [{ ...MERN, title: 'Full-Stack Developer - MERN Stack' }, { ...SQA, title: 'SQA Engr' }]);
  const s = applyExtract(r.runId, { log: quiet });
  assert.equal(s.new_jobs, 0);
  const after = db.prepare('SELECT id, first_seen, title FROM jobs WHERE id = ?').get(before.id);
  assert.equal(after.first_seen, before.first_seen);
  assert.equal(after.title, 'Full-Stack Developer - MERN Stack');
  assert.equal(db.prepare("SELECT closed_at FROM jobs WHERE title = 'SQA Engr'").get().closed_at, null);
});

test('a page with structured job data is read by code, with real post dates, and no Claude packet', async () => {
  const db = getDb();
  const t = now();
  db.prepare(
    `INSERT INTO companies (id, key, domain, name, website, city, is_software, kind, discover_status, created_at, updated_at)
     VALUES (2, 'betalabs.pk', 'betalabs.pk', 'Beta Labs', ?, 'lahore', 1, 'product', 'done', ?, ?)`
  ).run(base, t, t);
  db.prepare("INSERT INTO sources (id, company_id, kind, url) VALUES (2, 2, 'page', ?)").run(`${base}/beta/careers`);
  current = 'careers-plain-v1-noise.html';
  const r = await watch({ log: quiet });
  assert.equal(r.stats.structured_pages, 1);
  assert.equal(r.packet, 0);
  const node = db.prepare("SELECT * FROM jobs WHERE company_id = 2 AND title = 'Node.js Developer'").get();
  assert.equal(node.posted_at, '2026-10-15');
  assert.equal(node.posted_source, 'post');
  assert.equal(node.closes_at, '2026-10-30T23:59');
  assert.equal(node.extracted_by, 'jsonld');
});

test('page 2 of a job list is read, and a change on page 2 alone is noticed', async () => {
  const db = getDb();
  const t = now();
  db.prepare(
    `INSERT INTO companies (id, key, domain, name, website, city, is_software, kind, discover_status, created_at, updated_at)
     VALUES (3, 'gamma.pk', 'gamma.pk', 'Gamma Tech', ?, 'lahore', 1, 'service', 'done', ?, ?)`
  ).run(base, t, t);
  db.prepare("INSERT INTO sources (id, company_id, kind, url) VALUES (3, 3, 'page', ?)").run(`${base}/gamma/careers`);
  const r = await watch({ log: quiet });
  assert.equal(r.packet, 1);
  assert.equal(r.stats.paged, 1);
  const packet = fs.readFileSync(path.join(tmp, 'work', `${r.runId}.md`), 'utf8');
  assert.ok(packet.includes('MERN Stack Developer') && packet.includes('--- page 2'));
  fs.writeFileSync(path.join(tmp, 'work', `${r.runId}.out.json`), JSON.stringify([{ source_id: 3, hiring_status: 'live', jobs: [{ title: 'MERN Stack Developer', city: 'lahore' }] }]));
  applyExtract(r.runId, { log: quiet });
  assert.equal((await watch({ log: quiet })).packet, 0);
  gammaP2 = 'careers-plain-v2.html';
  assert.equal((await watch({ log: quiet })).packet, 1);
});

test('a job-board feed source goes through the feed reader (an unreadable feed is an error, not a crash)', async () => {
  const db = getDb();
  db.prepare("INSERT INTO sources (id, company_id, kind, url, ats, slug) VALUES (4, 3, 'ats', 'https://example.invalid/', 'nosuchats', 'x')").run();
  await watch({ log: quiet });
  assert.equal(db.prepare('SELECT error FROM sources WHERE id = 4').get().error, 'feed unreadable');
  db.prepare('UPDATE sources SET active = 0 WHERE id = 4').run();
});

test('a thinner re-read keeps the details an earlier read captured', async () => {
  const db = getDb();
  const job = db.prepare("SELECT id, experience_min, description FROM jobs WHERE title LIKE '%MERN%' AND company_id = 1").get();
  assert.ok(job.experience_min != null && job.description);
  current = 'careers-plain-v2.html';
  const r = await watch({ log: quiet });
  writeOut(r.runId, [{ title: 'Full-Stack Developer - MERN Stack', location_text: 'Lahore, Pakistan' }]);
  applyExtract(r.runId, { log: quiet });
  const after = db.prepare('SELECT experience_min, description FROM jobs WHERE id = ?').get(job.id);
  assert.equal(after.experience_min, job.experience_min);
  assert.equal(after.description, job.description);
});
