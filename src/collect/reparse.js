import fs from 'node:fs';
import path from 'node:path';
import { RAW_DIR } from '../config.js';
import { closeDb } from '../db.js';
import { parseSearchPayloads, cidFromUrl } from './parsePayload.js';
import { storePlace } from './store.js';
import { backupDb } from '../lib/backup.js';

// Re-reads saved Maps payloads after a parser fix: zero Google requests.
export function reparse(runId, { log = console.log } = {}) {
  const dir = path.join(RAW_DIR, 'maps', runId);
  const files = fs.readdirSync(dir);
  let places = 0;
  for (const lf of files.filter((f) => f.endsWith('-listings.json'))) {
    const prefix = lf.replace('-listings.json', '');
    const { query, text, listings } = JSON.parse(fs.readFileSync(path.join(dir, lf), 'utf8'));
    const frames = files.filter((f) => f.startsWith(prefix + '-') && f.endsWith('.txt')).map((f) => fs.readFileSync(path.join(dir, f), 'utf8'));
    const byCid = parseSearchPayloads(frames);
    for (const l of listings) {
      const cid = cidFromUrl(l.mapsUrl);
      if (!cid) continue;
      const pl = byCid.get(cid) || {};
      storePlace({ cid, ...l, website: pl.website || '', phone: pl.phone || '', address: pl.address || '' }, { city: query.city, query: text });
      places += 1;
    }
  }
  log(`[reparse] ${runId}: ${places} places re-stored`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  backupDb('reparse');
  const runId = process.argv[2] || fs.readdirSync(path.join(RAW_DIR, 'maps')).sort().pop();
  try {
    reparse(runId);
  } finally {
    closeDb();
  }
}
