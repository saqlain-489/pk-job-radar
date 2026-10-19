import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-fixes-'));
process.env.RADAR_DATA_DIR = tmp;
process.env.KEEP_BACKUPS = '3';

const page = (f) => fs.readFileSync(new URL(`./fixtures/pages/${f}`, import.meta.url), 'utf8');
const { matchExisting, titleTokens } = await import('../src/watch/jobs.js');
const { extractJobPostings } = await import('../src/watch/jsonld.js');
const { skipReason } = await import('../src/discover/run.js');
const { backupDb, BACKUP_DIR } = await import('../src/lib/backup.js');
const { getDb, closeDb } = await import('../src/db.js');

after(() => {
  closeDb();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('re-worded titles match the existing job; different roles do not', () => {
  const existing = [
    { id: 'a', title: 'Senior React Developer', city: 'lahore' },
    { id: 'b', title: 'Full Stack Developer (MERN)', city: 'lahore' },
    { id: 'c', title: 'React Developer', city: 'lahore' },
  ];
  assert.equal(matchExisting('Sr. React Developer', 'lahore', existing)?.id, 'a');
  assert.equal(matchExisting('Full-Stack Developer - MERN Stack', null, existing)?.id, 'b');
  assert.equal(matchExisting('ReactJS Developer', 'lahore', existing)?.id, 'c');
  assert.equal(matchExisting('Junior React Developer', 'lahore', existing), null);
  assert.equal(matchExisting('Flutter Developer', 'lahore', existing), null);
  assert.equal(matchExisting('Senior React Developer', 'karachi', existing), null);
  assert.deepEqual([...titleTokens('Sr. Node.js Dev - Lahore (Urgent)')].sort(), ['developer', 'node', 'senior']);
});

test('structured job data gives dates, deadline, salary, remote and experience', () => {
  const jobs = extractJobPostings(page('careers-jsonld.html'), 'https://betalabs.pk/careers');
  assert.equal(jobs.length, 2);
  const node = jobs[0];
  assert.equal(node.title, 'Node.js Developer');
  assert.equal(node.posted_at, '2026-10-15');
  assert.equal(node.closes_at, '2026-10-30T23:59');
  assert.equal(node.employment_type, 'full-time');
  assert.match(node.location_text, /Lahore/);
  assert.equal(node.experience_min, 2);
  assert.deepEqual([node.salary_min, node.salary_max], [150000, 220000]);
  assert.equal(jobs[1].location_type, 'remote');
  assert.deepEqual(extractJobPostings(page('careers-plain-v1.html')), []);
  assert.deepEqual(extractJobPostings('<script type="application/ld+json">{broken</script>'), []);
});

test('dead-end companies are skipped before Claude reads them', () => {
  assert.match(skipReason({ reachable: false, error: 'HTTP 403' }), /unreachable/);
  assert.match(skipReason({ reachable: true, careers: null, ats: [], hr_email: '' }), /auto-skipped/);
  assert.equal(skipReason({ reachable: true, careers: { url: 'x' }, ats: [], hr_email: '' }), null);
  assert.equal(skipReason({ reachable: true, careers: null, ats: [], hr_email: 'hr@x.pk' }), null);
  assert.equal(skipReason({ reachable: true, careers: null, ats: [{ ats: 'lever' }], hr_email: '' }), null);
});

test('backups are real readable copies and old ones rotate out', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  getDb().prepare("INSERT INTO runs (id, kind, started_at, status) VALUES ('r1', 'watch', '2026-10-17', 'done')").run();
  let file;
  for (let i = 0; i < 5; i++) {
    file = backupDb(`t${i}`);
  }
  const copy = new DatabaseSync(file, { readOnly: true });
  assert.equal(copy.prepare('SELECT COUNT(*) n FROM runs').get().n, 1);
  copy.close();
  assert.equal(fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.db')).length, 3);
});

test('a careers page that exists but would not load is labelled for an early re-check', () => {
  assert.match(skipReason({ reachable: true, careers: null, ats: [], hr_email: '', career_candidates: ['https://careers.x.pk/'] }), /did not load/);
});
