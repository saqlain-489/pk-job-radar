import fs from 'node:fs';
import path from 'node:path';
import { config, cities, RAW_DIR } from '../config.js';
import { getDb, now, startRun, endRun, closeDb } from '../db.js';
import { launchMapsBrowser, safeGoto } from '../lib/browser.js';
import { BlockedError } from '../lib/guard.js';
import { DEFAULT_UA } from '../lib/ua.js';
import { randomDelay, jitter, sleep } from '../lib/throttle.js';
import { extractFeedFn } from './extractListing.js';
import { parseSearchPayloads, cidFromUrl } from './parsePayload.js';
import { storePlace } from './store.js';
import { backupDb } from '../lib/backup.js';

export function cityConfig(cityKey) {
  const c = cities.cities[cityKey.toLowerCase()];
  if (!c) throw new Error(`Unknown city "${cityKey}". Add it to config/cities.json (areas with lat/lng).`);
  return c;
}

// One query = one Maps search = one "tile" of ban exposure. Term-major order, so a first
// session sweeps every area with the strongest term before trying variants.
export function ensureQueue(cityKey) {
  const db = getDb();
  const c = cityConfig(cityKey);
  const ins = db.prepare('INSERT OR IGNORE INTO queries (id, city, term, area) VALUES (?, ?, ?, ?)');
  for (const term of cities.terms) for (const a of c.areas) ins.run(`${cityKey}|${term}|${a.name}`, cityKey, term, a.name);
  return db.prepare('SELECT * FROM queries WHERE city = ? AND done = 0 ORDER BY rowid').all(cityKey);
}

function searchUrl(text, lat, lng, zoom) {
  return `https://www.google.com/maps/search/${encodeURIComponent(text)}/@${lat},${lng},${zoom}z?hl=en`;
}

async function scrollFeed(page) {
  const feedSel = 'div[role="feed"]';
  try {
    await page.waitForSelector(feedSel, { timeout: 15000 });
    // The feed renders before its cards; without this an empty-but-loading feed reads as 0 results.
    await page.waitForSelector('a.hfpxzc', { timeout: 12000 });
  } catch {
    return;
  }
  let stable = 0;
  let lastCount = 0;
  for (let i = 0; i < 40 && stable < 3; i++) {
    const { count, ended } = await page.evaluate((sel) => {
      const feed = document.querySelector(sel);
      if (!feed) return { count: 0, ended: true };
      feed.scrollTop = feed.scrollHeight;
      return {
        count: feed.querySelectorAll('a.hfpxzc').length,
        ended: /reached the end of the list/i.test(document.body.innerText || ''),
      };
    }, feedSel);
    if (ended) break;
    stable = count === lastCount ? stable + 1 : 0;
    lastCount = count;
    await jitter(1500);
  }
}

// Refuses a session that would break the measured ban budget (≥4h gap, 2 sessions/day).
export function sessionGate({ force = false } = {}) {
  const db = getDb();
  const last = db.prepare("SELECT * FROM runs WHERE kind = 'collect' ORDER BY started_at DESC LIMIT 1").get();
  const today = new Date().toISOString().slice(0, 10);
  const todayCount = db.prepare("SELECT COUNT(*) n FROM runs WHERE kind = 'collect' AND substr(started_at, 1, 10) = ?").get(today).n;
  if (force) return { ok: true };
  if (last?.status === 'blocked') {
    const hrs = (Date.now() - Date.parse(last.started_at)) / 3.6e6;
    if (hrs < 24) return { ok: false, why: `last Maps session was BLOCKED ${hrs.toFixed(1)}h ago; wait 24h+ or change IP` };
  }
  if (todayCount >= 1) return { ok: false, why: `already ran ${todayCount} Maps session(s) today; a second one needs your OK (--force)` };
  if (last) {
    const hrs = (Date.now() - Date.parse(last.started_at)) / 3.6e6;
    if (hrs < config.minHoursBetweenSessions) return { ok: false, why: `last session ${hrs.toFixed(1)}h ago (< ${config.minHoursBetweenSessions}h)` };
  }
  return { ok: true };
}

export async function collect(cityKey, { max = config.maxQueriesPerSession, force = false, log = console.log } = {}) {
  const gate = sessionGate({ force });
  if (!gate.ok) throw new Error(`Maps session refused: ${gate.why}`);
  const c = cityConfig(cityKey);
  const queue = ensureQueue(cityKey).slice(0, max);
  if (!queue.length) {
    log(`[collect] ${c.name}: every query is done. Add areas/terms to config/cities.json to search more.`);
    return { status: 'done', queries: 0 };
  }
  const areas = Object.fromEntries(c.areas.map((a) => [a.name, a]));
  const runId = startRun('collect', { city: cityKey });
  const rawDir = path.join(RAW_DIR, 'maps', runId);
  fs.mkdirSync(rawDir, { recursive: true });
  const db = getDb();
  const stats = { queries: 0, listings: 0, new_places: 0, new_companies: 0, noise: 0, with_website: 0, payload_hits: 0 };
  let status = 'done';
  let message = '';
  let consecutiveEmpty = 0;
  let onePage = 0;

  log(`[collect] ${c.name}: ${queue.length} queries this session (run ${runId})`);
  const browser = await launchMapsBrowser();
  let payloads = [];
  let pending = [];
  try {
    const page = await browser.newPage();
    await page.setUserAgent(DEFAULT_UA);
    page.on('response', (res) => {
      if (!/\/search\?tbm=map/i.test(res.url())) return;
      pending.push(res.text().then((t) => t && t.length > 1000 && payloads.push(t)).catch(() => {}));
    });
    const extractFeed = extractFeedFn();

    for (const [qi, q] of queue.entries()) {
      payloads = [];
      pending = [];
      const a = areas[q.area];
      const text = `${q.term} in ${q.area}, ${c.name}`;
      let ok;
      try {
        ok = await safeGoto(page, searchUrl(text, a.lat, a.lng, c.zoom));
      } catch (e) {
        if (e instanceof BlockedError) {
          status = 'blocked';
          message = e.message;
          break;
        }
        throw e;
      }
      stats.queries += 1;
      if (!ok) {
        log(`[collect] ${text}: navigation failed, will retry next session`);
        continue;
      }
      await randomDelay(config.minActionDelayMs, config.maxActionDelayMs);
      await scrollFeed(page);
      let listings = [];
      try {
        listings = await page.evaluate(extractFeed);
      } catch {
        listings = [];
      }
      await Promise.allSettled(pending);
      payloads.forEach((p, i) => fs.writeFileSync(path.join(rawDir, `q${String(qi).padStart(2, '0')}-${i}.txt`), p));
      fs.writeFileSync(path.join(rawDir, `q${String(qi).padStart(2, '0')}-listings.json`), JSON.stringify({ query: q, text, listings }));
      const byCid = parseSearchPayloads(payloads);

      let added = 0;
      const seen = new Set();
      for (const l of listings) {
        const cid = cidFromUrl(l.mapsUrl);
        if (!cid || seen.has(cid)) continue;
        seen.add(cid);
        const pl = byCid.get(cid) || {};
        if (pl.website || pl.phone) stats.payload_hits += 1;
        stats.listings += 1;
        const r = storePlace({ cid, ...l, website: pl.website || '', phone: pl.phone || '', address: pl.address || '' }, { city: cityKey, query: text });
        if (r.isNew) stats.new_places += 1;
        if (r.verdict === 'noise') stats.noise += 1;
        if (r.createdCompany) stats.new_companies += 1;
        if (pl.website) stats.with_website += 1;
        if (r.isNew) added += 1;
      }
      db.prepare('UPDATE queries SET done = 1, results = ?, run_id = ?, done_at = ? WHERE id = ?').run(seen.size, runId, now(), q.id);
      log(`[collect] ${qi + 1}/${queue.length} "${text}": ${seen.size} listings, +${added} new places (payload ${payloads.length} frames)`);

      // Google's quiet throttle: page 2+ stops loading, so every query returns one 20-result page.
      onePage = payloads.length <= 1 && seen.size > 0 && seen.size <= 20 ? onePage + 1 : 0;
      if (onePage >= 3 && stats.queries > 3) {
        status = 'blocked';
        message = '3 queries in a row returned only one page of results: likely a Google soft throttle. Stop for today.';
        break;
      }
      if (seen.size === 0) {
        consecutiveEmpty += 1;
        if (consecutiveEmpty >= config.emptyQueryAlert) {
          status = 'error';
          message = `${consecutiveEmpty} queries in a row returned 0 results: Maps layout change or soft block. Check with HEADLESS=false.`;
          break;
        }
      } else consecutiveEmpty = 0;

      // Coverage guard: if the payload stops yielding website/phone, the parser broke; raw frames are saved for re-parse.
      if (stats.listings >= 40 && stats.payload_hits / stats.listings < 0.25) {
        status = 'error';
        message = `payload coverage ${Math.round((100 * stats.payload_hits) / stats.listings)}% < 25%: parser likely broken. Fix parsePayload.js, then npm run collect:reparse.`;
        break;
      }

      if (qi < queue.length - 1) {
        if (config.restEveryN && (qi + 1) % config.restEveryN === 0) {
          log('[collect] resting to stay under the radar…');
          await randomDelay(config.restMinMs, config.restMaxMs);
        } else await jitter(config.queryDelayMs);
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }
  if (status === 'done' && stats.queries < queue.length) status = 'partial';
  stats.payload_coverage = stats.listings ? Number((stats.payload_hits / stats.listings).toFixed(2)) : null;
  endRun(runId, status, stats, message);
  if (status === 'blocked') log(`[collect] HALTED: Google block signal (${message}). Do not retry today; change IP or wait 24h+.`);
  else if (message) log(`[collect] HALTED: ${message}`);
  log(`[collect] ${status}: ${JSON.stringify(stats)}`);
  return { runId, status, ...stats };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  backupDb('collect');
  const args = process.argv.slice(2);
  const cityKey = args.find((a) => !a.startsWith('--')) || 'lahore';
  const maxArg = args.find((a) => a.startsWith('--max='));
  collect(cityKey, { force: args.includes('--force'), ...(maxArg ? { max: Number(maxArg.split('=')[1]) } : {}) })
    .catch((e) => {
      console.error('[collect] error:', e.message);
      process.exitCode = 1;
    })
    .finally(() => {
      closeDb();
      sleep(10).then(() => process.exit());
    });
}
