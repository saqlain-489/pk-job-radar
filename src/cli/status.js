import { closeDb, getDb, parseJson } from '../db.js';
import { config } from '../config.js';
import { funnel, lastRuns } from './funnel.js';

const city = process.argv.find((a) => a.startsWith('--city='))?.split('=')[1];
const f = funnel(city);
console.log(`Funnel${city ? ` (${city})` : ''}:`);
for (const [k, v] of Object.entries(f)) console.log(`  ${k.padEnd(22)} ${v}`);

const pending = lastRuns(50).filter((r) => r.status === 'awaiting_claude');
if (pending.length) {
  console.log('\nWaiting for Claude:');
  for (const r of pending) console.log(`  ${r.id}: ${r.message}  → then npm run ${r.kind}:apply -- ${r.id}`);
}

const top = getDb()
  .prepare(
    `SELECT j.title, j.score, j.score_flags, j.first_seen, c.name FROM jobs j JOIN companies c ON c.id = j.company_id
     WHERE j.closed_at IS NULL AND j.score >= ? ORDER BY j.score DESC LIMIT 10`
  )
  .all(config.matchThreshold);
if (top.length) {
  console.log(`\nTop matches (${config.matchThreshold}+):`);
  for (const j of top) {
    const flags = parseJson(j.score_flags, []);
    console.log(`  ${String(j.score).padStart(3)}  ${j.title} — ${j.name}${flags.length ? `  [${flags.join(', ')}]` : ''}`);
  }
}
closeDb();
