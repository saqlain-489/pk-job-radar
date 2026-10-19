import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-recheck-'));
process.env.RADAR_DATA_DIR = tmp;

const { getDb, closeDb } = await import('../src/db.js');
const { recheck, dueForRecheck } = await import('../src/discover/recheck.js');
const { paginationLinks, extractLinks, brokenWidget } = await import('../src/discover/signals.js');
const { parseBambooEmbed } = await import('../src/discover/ats.js');

after(() => {
  closeDb();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const ago = (d) => new Date(Date.now() - d * 86400000).toISOString();
function company(id, domain, status, probedDaysAgo, extra = {}) {
  const t = ago(0);
  getDb()
    .prepare(
      `INSERT INTO companies (id, key, domain, name, website, city, discover_status, probed_at, notes, is_software, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'lahore', ?, ?, ?, ?, ?, ?)`
    )
    .run(id, domain, domain, domain, `https://${domain}/`, status, ago(probedDaysAgo), extra.notes || '', extra.is_software ?? null, t, t);
}

test('only companies that are due come back for a re-check', () => {
  company(1, 'dead-old.pk', 'skipped', 40, { notes: 'auto-skipped: no careers page, no job board, no HR email' });
  company(2, 'judged-old.pk', 'done', 35, { is_software: 1 });
  company(3, 'dead-recent.pk', 'skipped', 5, { notes: 'auto-skipped: no careers page, no job board, no HR email' });
  company(4, 'rejected-old.pk', 'rejected', 90, { is_software: 0 });
  company(5, 'down-old.pk', 'skipped', 20, { notes: 'site unreachable (HTTP 503); re-check later' });
  company(6, 'down-recent.pk', 'skipped', 10, { notes: 'site unreachable (HTTP 503); re-check later' });
  assert.deepEqual(dueForRecheck().map((c) => c.id).sort(), [1, 2, 5]);
});

test('re-check: judged companies get a watched careers page with no Claude; new ones go to Claude', async () => {
  const careers = (d) => ({ reachable: true, careers: { url: `https://${d}/careers`, job_links: [] }, ats: [], emails: [], hr_email: '' });
  const probe = async (c) => (c.id === 5 ? { reachable: false, error: 'HTTP 503', ats: [], emails: [] } : careers(c.domain));
  const r = await recheck({ probe, log: () => {} });
  assert.equal(r.due, 3);
  assert.equal(r.new_sources, 1);
  assert.equal(r.for_claude, 1);
  assert.equal(r.still_nothing, 1);
  const db = getDb();
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sources WHERE company_id = 2 AND active = 1').get().n, 1);
  assert.equal(db.prepare('SELECT discover_status FROM companies WHERE id = 1').get().discover_status, 'probed');
  assert.ok(fs.existsSync(path.join(tmp, 'work', `${r.runId}.md`)));
  assert.deepEqual(dueForRecheck().map((c) => c.id), []);
});

test('pagination links: numbered and next links on the same list, nothing else', () => {
  const html = `<a href="?a=1">1</a><a href="?a=2">2</a><a href="?a=3">3</a><a href="/careers/page/4/">Next</a>
    <a href="/blog?page=2">2</a><a href="https://other.pk/careers?a=2">2</a><a href="/careers/">Careers</a>`;
  const got = paginationLinks(extractLinks(html, 'https://x.pk/careers/'), 'https://x.pk/careers/');
  assert.deepEqual(got, ['https://x.pk/careers/?a=2', 'https://x.pk/careers/?a=3', 'https://x.pk/careers/page/4/']);
});

test('broken job widgets and the BambooHR embed are recognised', () => {
  assert.equal(brokenWidget('<p>Open jobs</p><p>[awsmjobs]</p>'), '[awsmjobs]');
  assert.equal(brokenWidget('<p>[Lahore office]</p>'), '');
  const jobs = parseBambooEmbed('<ul><li><a href="//acme.bamboohr.com/careers/41">Backend Engineer</a></li><li><a href="//acme.bamboohr.com/careers/41">Backend Engineer</a></li></ul>', 'acme');
  assert.deepEqual(jobs.map((j) => [j.ext_id, j.title]), [['41', 'Backend Engineer']]);
  assert.deepEqual(parseBambooEmbed('', 'acme'), []);
});
