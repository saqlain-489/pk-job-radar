import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-rozee-'));
process.env.RADAR_DATA_DIR = tmp;

const { parseSearch, yearsFromText, isChallenge, searchUrl } = await import('../src/rozee/parse.js');
const { companyFor, closeUnseen } = await import('../src/rozee/run.js');
const { upsertJob } = await import('../src/watch/jobs.js');
const { getDb, closeDb, now } = await import('../src/db.js');

after(() => {
  closeDb();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const html = fs.readFileSync(new URL('./fixtures/rozee-search-lahore.html', import.meta.url), 'utf8');

test('reads the job list embedded in a real Rozee search page', () => {
  const r = parseSearch(html);
  assert.equal(r.total, 27);
  assert.equal(r.jobs.length, 20);
  const mern = r.jobs.find((j) => j.title === 'MERN Developer');
  assert.equal(mern.company, 'Big Entities');
  assert.equal(mern.city, 'Lahore');
  assert.match(mern.posted_at, /^2026-10-15T/);
  assert.match(mern.closes_at, /^2026-10-20/);
  assert.equal(mern.experience_min, 2);
  assert.ok(mern.skills.includes('TypeScript') && !mern.skills.some((s) => /and/.test(s)));
  assert.match(mern.url, /^https:\/\/www\.rozee\.pk\/mern-developer-lahore-jobs-\d+$/);
  assert.deepEqual(parseSearch('<html>no results</html>').jobs, []);
});

test('experience text, challenge pages and search URLs', () => {
  assert.equal(yearsFromText('2 Years'), 2);
  assert.equal(yearsFromText('Fresh'), 0);
  assert.equal(yearsFromText('6 Months'), 0.5);
  assert.equal(yearsFromText(''), null);
  assert.ok(isChallenge({ status: 429, url: 'x', body: '' }));
  assert.ok(isChallenge({ status: 200, url: 'https://www.rozee.pk/job/jsearch/q/x?chlng=y', body: '' }));
  assert.ok(!isChallenge({ status: 200, url: 'https://www.rozee.pk/job/jsearch/q/x', body: html }));
  assert.equal(searchUrl('node js', 1181, 20), 'https://www.rozee.pk/job/jsearch/q/node%20js/fc/1181/fpn/20');
});

test('Rozee companies match known companies by name, else get their own row; unseen jobs close', () => {
  const db = getDb();
  const t = now();
  db.prepare(
    `INSERT INTO companies (key, domain, name, city, discover_status, is_software, created_at, updated_at)
     VALUES ('netixsol.com', 'netixsol.com', 'Netixsol (Pvt) Ltd', 'faisalabad', 'done', 1, ?, ?)`
  ).run(t, t);
  assert.equal(companyFor('Netixsol', 'faisalabad').domain, 'netixsol.com');
  const fresh = companyFor('Brand New Labs', 'faisalabad');
  assert.equal(fresh.key, 'rozee:brandnewlabs');
  assert.equal(companyFor('Brand New Labs', 'faisalabad').id, fresh.id);

  const old = new Date(Date.now() - 5 * 86400000).toISOString();
  upsertJob({ id: 'rozee:1', title: 'MERN Developer', city: 'faisalabad', posted_at: old }, fresh, { sourceId: null, extractedBy: 'rozee', t: old, sourceSeenBefore: true });
  upsertJob({ id: 'rozee:2', title: 'React Developer', city: 'faisalabad', posted_at: t }, fresh, { sourceId: null, extractedBy: 'rozee', t, sourceSeenBefore: true });
  assert.equal(closeUnseen('faisalabad', 3, t), 1);
  assert.ok(db.prepare("SELECT closed_at FROM jobs WHERE id = 'rozee:1'").get().closed_at);
  assert.equal(db.prepare("SELECT closed_at FROM jobs WHERE id = 'rozee:2'").get().closed_at, null);
});

test('a re-post of the same opening updates the existing job instead of adding a duplicate', async () => {
  const { repostOf } = await import('../src/rozee/run.js');
  const c = companyFor('Repost Co', 'faisalabad');
  const t = now();
  upsertJob({ id: 'rozee:10', title: 'Full Stack Agentic AI Engineer', city: 'faisalabad', posted_at: '2026-10-14T00:00:00Z' }, c, { sourceId: null, extractedBy: 'rozee', t, sourceSeenBefore: true });
  assert.equal(repostOf(c.id, { ext_id: '11', title: 'Full Stack Agentic AI Engineer | On-site', city: 'Faisalabad', posted_at: '2026-10-15T00:00:00Z' }), 'rozee:10');
  assert.equal(repostOf(c.id, { ext_id: '12', title: 'Senior QA Engineer', city: 'Faisalabad', posted_at: '2026-10-15T00:00:00Z' }), null);
});

test('older copies of the same post close, the newest stays open', async () => {
  const { closeDuplicates } = await import('../src/rozee/run.js');
  const c = companyFor('Dup Co', 'faisalabad');
  const t = now();
  upsertJob({ id: 'rozee:20', title: 'SQA Engineers (Onsite Faisalabad)', city: 'faisalabad', posted_at: '2026-10-14T00:00:00Z' }, c, { sourceId: null, extractedBy: 'rozee', t, sourceSeenBefore: true });
  upsertJob({ id: 'rozee:21', title: 'SQA Engineers (Onsite Faisalabad)', city: 'faisalabad', posted_at: '2026-10-15T00:00:00Z' }, c, { sourceId: null, extractedBy: 'rozee', t, sourceSeenBefore: true });
  closeDuplicates(t);
  const db = getDb();
  assert.ok(db.prepare("SELECT closed_at FROM jobs WHERE id = 'rozee:20'").get().closed_at);
  assert.equal(db.prepare("SELECT closed_at FROM jobs WHERE id = 'rozee:21'").get().closed_at, null);
});

test('Rozee gate: one run a day, 24h pause after a block', async () => {
  const { rozeeGate } = await import('../src/rozee/run.js');
  const db = getDb();
  assert.ok(rozeeGate().ok);
  const h = (n) => new Date(Date.now() - n * 3.6e6).toISOString();
  db.prepare("INSERT INTO runs (id, kind, started_at, status) VALUES ('rz1', 'rozee', ?, 'done')").run(h(3));
  assert.ok(!rozeeGate().ok);
  assert.ok(rozeeGate({ force: true }).ok);
  db.prepare("UPDATE runs SET started_at = ?, status = 'blocked' WHERE id = 'rz1'").run(h(22));
  assert.match(rozeeGate().why, /blocked/);
  db.prepare("UPDATE runs SET started_at = ? WHERE id = 'rz1'").run(h(25));
  assert.ok(rozeeGate().ok);
});

test('daily rotation picks the city checked longest ago', async () => {
  const { nextCity } = await import('../src/rozee/run.js');
  const db = getDb();
  const cfg = { cities: { lahore: 1185, faisalabad: 1181 }, rotation: ['lahore', 'faisalabad'] };
  db.prepare("INSERT INTO runs (id, kind, city, started_at, status) VALUES ('rzA', 'rozee', 'faisalabad', '2026-10-17T10:00:00Z', 'done')").run();
  assert.equal(nextCity(cfg), 'lahore');
  db.prepare("INSERT INTO runs (id, kind, city, started_at, status) VALUES ('rzB', 'rozee', 'lahore', '2026-10-18T10:00:00Z', 'done')").run();
  assert.equal(nextCity(cfg), 'faisalabad');
});
