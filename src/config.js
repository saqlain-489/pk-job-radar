import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.RADAR_DATA_DIR || path.join(ROOT, 'data');
export const WORK_DIR = path.join(DATA_DIR, 'work');
export const RAW_DIR = path.join(DATA_DIR, 'raw');

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));
const bool = (v, d) => (v === undefined || v === '' ? d : /^(1|true|yes)$/i.test(v));

export const config = {
  // Maps — budget measured in the lead scraper: 30 searches/session, 2 sessions/day ≥4h apart.
  maxQueriesPerSession: num(process.env.MAX_QUERIES, 30),
  minActionDelayMs: num(process.env.MIN_ACTION_DELAY_MS, 2000),
  maxActionDelayMs: num(process.env.MAX_ACTION_DELAY_MS, 5000),
  queryDelayMs: num(process.env.QUERY_DELAY_MS, 8000),
  restEveryN: num(process.env.REST_EVERY_N, 10),
  restMinMs: num(process.env.REST_MIN_MS, 30000),
  restMaxMs: num(process.env.REST_MAX_MS, 60000),
  navRetries: num(process.env.NAV_RETRIES, 1),
  emptyQueryAlert: num(process.env.EMPTY_QUERY_ALERT, 4),
  headless: bool(process.env.HEADLESS, true),
  minHoursBetweenSessions: num(process.env.MIN_HOURS_BETWEEN_SESSIONS, 4),

  // Company websites — polite plain fetch.
  fetchTimeoutMs: num(process.env.FETCH_TIMEOUT_MS, 15000),
  fetchConcurrency: num(process.env.FETCH_CONCURRENCY, 4),
  perHostDelayMs: num(process.env.PER_HOST_DELAY_MS, 1500),
  renderFallback: bool(process.env.RENDER_FALLBACK, true),
  renderTimeoutMs: num(process.env.RENDER_TIMEOUT_MS, 25000),
  maxJobDetailPages: num(process.env.MAX_JOB_DETAIL_PAGES, 8),

  matchThreshold: num(process.env.MATCH_THRESHOLD, 60),
  outreachMinFit: num(process.env.OUTREACH_MIN_FIT, 55),
  port: num(process.env.PORT, 4317),
};

export function loadJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

export const PROFILE_FILE = fs.existsSync(path.join(ROOT, 'config/profile.local.json')) ? 'config/profile.local.json' : 'config/profile.example.json';
export const profile = loadJson(PROFILE_FILE);
export const cities = loadJson('config/cities.json');

export function ensureDirs() {
  for (const d of [DATA_DIR, WORK_DIR, RAW_DIR]) fs.mkdirSync(d, { recursive: true });
}
