import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR, ensureDirs } from './config.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  domain TEXT UNIQUE,
  name TEXT NOT NULL,
  website TEXT,
  city TEXT,
  phone TEXT,
  address TEXT,
  maps_category TEXT,
  rating REAL,
  reviews INTEGER,
  social_url TEXT,
  sources TEXT NOT NULL DEFAULT '[]',
  filter_verdict TEXT,
  filter_reason TEXT,
  contacted INTEGER NOT NULL DEFAULT 0,
  discover_status TEXT NOT NULL DEFAULT 'pending',
  probed_at TEXT,
  discovered_at TEXT,
  probe TEXT,
  is_software INTEGER,
  careers_url TEXT,
  ats TEXT,
  ats_slug TEXT,
  needs_render INTEGER NOT NULL DEFAULT 0,
  hr_email TEXT,
  whatsapp TEXT,
  hiring_status TEXT,
  kind TEXT,
  foreign_clients INTEGER,
  size TEXT,
  stack TEXT NOT NULL DEFAULT '[]',
  fit INTEGER,
  notes TEXT,
  hook TEXT,
  outreach_status TEXT NOT NULL DEFAULT 'todo',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS places (
  cid TEXT PRIMARY KEY,
  company_id INTEGER REFERENCES companies(id),
  name TEXT,
  category TEXT,
  website TEXT,
  phone TEXT,
  address TEXT,
  rating REAL,
  reviews INTEGER,
  maps_url TEXT,
  city TEXT,
  query TEXT,
  filter_verdict TEXT,
  filter_reason TEXT,
  first_seen TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS queries (
  id TEXT PRIMARY KEY,
  city TEXT NOT NULL,
  term TEXT NOT NULL,
  area TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  results INTEGER,
  run_id TEXT,
  done_at TEXT
);
CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  kind TEXT NOT NULL,
  url TEXT NOT NULL,
  ats TEXT,
  slug TEXT,
  hash TEXT,
  pending_hash TEXT,
  last_fetched TEXT,
  last_changed TEXT,
  last_status TEXT,
  error TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(company_id, url)
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  source_id INTEGER REFERENCES sources(id),
  title TEXT NOT NULL,
  url TEXT,
  location_text TEXT,
  location_type TEXT,
  city TEXT,
  country TEXT,
  experience_min REAL,
  experience_max REAL,
  salary_min INTEGER,
  salary_max INTEGER,
  employment_type TEXT,
  skills TEXT NOT NULL DEFAULT '[]',
  description TEXT,
  apply_method TEXT,
  apply_contact TEXT,
  flags TEXT NOT NULL DEFAULT '[]',
  experience_inferred INTEGER NOT NULL DEFAULT 0,
  score INTEGER,
  score_flags TEXT NOT NULL DEFAULT '[]',
  reasons TEXT NOT NULL DEFAULT '[]',
  extracted_by TEXT,
  posted_at TEXT,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  closed_at TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  status_at TEXT
);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  city TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  status TEXT NOT NULL,
  stats TEXT NOT NULL DEFAULT '{}',
  message TEXT
);
CREATE INDEX IF NOT EXISTS jobs_company ON jobs(company_id);
CREATE INDEX IF NOT EXISTS jobs_first_seen ON jobs(first_seen);
CREATE INDEX IF NOT EXISTS places_company ON places(company_id);
`;

let db;

export function getDb(file = path.join(DATA_DIR, 'radar.db')) {
  if (db) return db;
  if (file !== ':memory:') ensureDirs();
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

const ADDED_COLUMNS = [
  ['jobs', 'experience_inferred', "INTEGER NOT NULL DEFAULT 0"],
  ['jobs', 'score_flags', "TEXT NOT NULL DEFAULT '[]'"],
  ['jobs', 'posted_source', 'TEXT'],
  ['jobs', 'closes_at', 'TEXT'],
  ['sources', 'render_checked_at', 'TEXT'],
  ['sources', 'note', 'TEXT'],
];

function migrate(d) {
  for (const [table, col, type] of ADDED_COLUMNS) {
    const cols = d.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (!cols.includes(col)) d.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
  }
  d.exec("UPDATE jobs SET posted_source = 'post' WHERE posted_at IS NOT NULL AND posted_source IS NULL");
}

export function closeDb() {
  if (db) db.close();
  db = undefined;
}

export const now = () => new Date().toISOString();

export function tx(fn) {
  const d = getDb();
  d.exec('BEGIN');
  try {
    const r = fn(d);
    d.exec('COMMIT');
    return r;
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
}

export const parseJson = (s, d) => {
  if (s == null || s === '') return d;
  try {
    return JSON.parse(s);
  } catch {
    return d;
  }
};

export function startRun(kind, extra = {}) {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const taken = getDb().prepare('SELECT COUNT(*) n FROM runs WHERE id LIKE ?').get(`${kind}-${stamp}%`).n;
  const id = `${kind}-${stamp}${taken ? `-${taken + 1}` : ''}`;
  getDb()
    .prepare('INSERT INTO runs (id, kind, city, started_at, status, stats) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, kind, extra.city || null, now(), 'running', '{}');
  return id;
}

export function endRun(id, status, stats = {}, message = '') {
  getDb()
    .prepare('UPDATE runs SET ended_at = ?, status = ?, stats = ?, message = ? WHERE id = ?')
    .run(now(), status, JSON.stringify(stats), message, id);
}
