import path from 'node:path';
import express from 'express';
import { config } from '../config.js';
import { getDb, now, parseJson } from '../db.js';
import { funnel, lastRuns, isEngineering } from '../cli/funnel.js';
import { outreachList } from '../outreach/drafts.js';
import { jobsCsv } from '../cli/export.js';

const JOB_STATUSES = new Set(['new', 'saved', 'applied', 'skipped']);
const OUTREACH_STATUSES = new Set(['todo', 'sent', 'skipped']);

const companyView = (c) => ({
  id: c.id, name: c.name, domain: c.domain, website: c.website, city: c.city, kind: c.kind, size: c.size,
  foreign_clients: !!c.foreign_clients, stack: parseJson(c.stack, []), fit: c.fit, notes: c.notes, hr_email: c.hr_email,
  whatsapp: c.whatsapp, careers_url: c.careers_url, ats: c.ats, hiring_status: c.hiring_status, contacted: !!c.contacted,
  rating: c.rating, reviews: c.reviews, maps_category: c.maps_category, discover_status: c.discover_status, outreach_status: c.outreach_status,
});

export function createApp() {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(path.dirname(new URL(import.meta.url).pathname), 'public')));

  app.get('/api/summary', (_req, res) => {
    const db = getDb();
    const lastWatch = db.prepare("SELECT * FROM runs WHERE kind IN ('watch', 'rozee') ORDER BY started_at DESC LIMIT 1").get();
    const pending = lastRuns(50).filter((r) => r.status === 'awaiting_claude').map((r) => ({ id: r.id, kind: r.kind, file: r.message }));
    res.json({ funnel: funnel(), last_watch: lastWatch || null, pending, threshold: config.matchThreshold });
  });

  app.get('/api/jobs', (_req, res) => {
    const db = getDb();
    const companies = new Map(db.prepare('SELECT * FROM companies').all().map((c) => [c.id, companyView(c)]));
    const watches = db.prepare("SELECT id, started_at, stats FROM runs WHERE kind IN ('watch', 'rozee') ORDER BY started_at DESC").all();
    const lastWatch = watches[0];
    // On a quiet day keep showing the last batch of new jobs instead of an empty section.
    const lastNew = watches.find((r) => {
      const st = parseJson(r.stats, {});
      return (st.new_jobs || 0) + (st.new_jobs_claude || 0) > 0;
    });
    const jobs = db
      .prepare('SELECT * FROM jobs ORDER BY closed_at IS NOT NULL, score DESC, first_seen DESC')
      .all()
      .map((j) => ({
        ...j,
        skills: parseJson(j.skills, []),
        reasons: parseJson(j.reasons, []),
        flags: parseJson(j.score_flags, []),
        engineering: isEngineering(j.title),
        is_new: !!lastNew && j.first_seen >= lastNew.started_at && !j.closed_at,
        source: j.extracted_by === 'rozee' ? 'rozee' : j.extracted_by === 'ats' ? 'jobboard' : 'site',
        company: companies.get(j.company_id),
      }));
    res.json({ jobs, last_watch: lastWatch?.started_at || null, new_since: lastNew?.started_at || null, quiet: !!lastWatch && lastNew?.id !== lastWatch.id });
  });

  app.post('/api/jobs/:id/status', (req, res) => {
    const { status } = req.body || {};
    if (!JOB_STATUSES.has(status)) return res.status(400).json({ error: 'bad status' });
    const r = getDb().prepare('UPDATE jobs SET status = ?, status_at = ? WHERE id = ?').run(status, now(), req.params.id);
    res.json({ ok: r.changes === 1 });
  });

  app.get('/api/companies', (_req, res) => {
    const db = getDb();
    const counts = new Map(
      db.prepare('SELECT company_id, COUNT(*) n, MAX(score) best FROM jobs WHERE closed_at IS NULL GROUP BY company_id').all().map((r) => [r.company_id, r])
    );
    const rows = db
      .prepare("SELECT * FROM companies WHERE discover_status IN ('done', 'rejected', 'probed', 'skipped') ORDER BY is_software DESC, fit DESC")
      .all()
      .map((c) => ({ ...companyView(c), is_software: c.is_software, open_jobs: counts.get(c.id)?.n || 0, best_score: counts.get(c.id)?.best ?? null }));
    res.json({ companies: rows });
  });

  app.get('/api/outreach', (_req, res) => {
    res.json({ companies: outreachList().map((c) => ({ ...companyView(c), draft: c.draft })) });
  });

  app.post('/api/companies/:id/outreach', (req, res) => {
    const { status } = req.body || {};
    if (!OUTREACH_STATUSES.has(status)) return res.status(400).json({ error: 'bad status' });
    const r = getDb().prepare('UPDATE companies SET outreach_status = ?, updated_at = ? WHERE id = ?').run(status, now(), Number(req.params.id));
    res.json({ ok: r.changes === 1 });
  });

  app.get('/api/runs', (_req, res) => res.json({ runs: lastRuns(30) }));

  app.get('/export.csv', (req, res) => {
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="pk-jobs-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(jobsCsv({ includeClosed: req.query.all === '1' }));
  });

  return app;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  createApp().listen(config.port, '127.0.0.1', () => console.log(`[dashboard] http://localhost:${config.port}`));
}
