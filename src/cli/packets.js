import fs from 'node:fs';
import path from 'node:path';
import { WORK_DIR } from '../config.js';

// Splits a Claude packet into parts for parallel helper agents, and merges + checks their answers.
// discover/recheck packets use "### [id N]" blocks; watch packets use "## [source N]" blocks.

const kindOf = (runId) => (runId.startsWith('watch-') ? 'watch' : 'discover');
const BLOCK = { discover: /\n(?=### \[id \d+\])/, watch: /\n(?=## \[source \d+\])/ };
const ID = { discover: /^### \[id (\d+)\]/, watch: /^## \[source (\d+)\]/ };
const KEY = { discover: 'id', watch: 'source_id' };

function blocks(runId) {
  const kind = kindOf(runId);
  const text = fs.readFileSync(path.join(WORK_DIR, `${runId}.md`), 'utf8');
  const parts = text.split(BLOCK[kind]);
  const header = parts.shift();
  return { kind, header, blocks: parts.map((b) => ({ id: Number(b.match(ID[kind])[1]), text: b })) };
}

export function split(runId, target = 100000) {
  const { header, blocks: bs } = blocks(runId);
  const total = bs.reduce((n, b) => n + b.text.length, 0);
  const n = Math.max(1, Math.ceil(total / target));
  const size = total / n;
  const groups = [[]];
  let cur = 0;
  for (const b of bs) {
    if (cur > size && groups.length < n) {
      groups.push([]);
      cur = 0;
    }
    groups.at(-1).push(b);
    cur += b.text.length;
  }
  groups.forEach((g, i) => {
    fs.writeFileSync(path.join(WORK_DIR, `${runId}.part${i + 1}.md`), header + '\n' + g.map((b) => b.text).join('\n'));
    fs.writeFileSync(path.join(WORK_DIR, `${runId}.part${i + 1}.ids`), g.map((b) => b.id).join(','));
  });
  return groups.map((g, i) => ({ part: i + 1, items: g.length, chars: g.reduce((s, b) => s + b.text.length, 0) }));
}

export function merge(runId) {
  const { kind, blocks: bs } = blocks(runId);
  const byId = new Map(bs.map((b) => [b.id, b.text]));
  const files = fs.readdirSync(WORK_DIR).filter((f) => new RegExp(`^${runId}\\.part\\d+\\.out\\.json$`).test(f)).sort();
  const all = files.flatMap((f) => JSON.parse(fs.readFileSync(path.join(WORK_DIR, f), 'utf8')));
  const key = KEY[kind];
  const got = new Set(all.map((o) => o[key]));
  const issues = [];
  for (const id of byId.keys()) if (!got.has(id)) issues.push(`missing ${key} ${id}`);
  if (all.length !== got.size) issues.push(`${all.length - got.size} duplicate objects`);
  if (kind === 'discover') {
    for (const v of all) {
      const b = (byId.get(v.id) || '').toLowerCase();
      if (v.careers_url && !b.includes(String(v.careers_url).toLowerCase().replace(/\/$/, ''))) issues.push(`id ${v.id}: careers_url not on the page (${v.careers_url})`);
      if (v.hr_email && !b.includes(String(v.hr_email).toLowerCase())) issues.push(`id ${v.id}: hr_email not on the page (${v.hr_email})`);
      if (v.is_software === false && v.hook) issues.push(`id ${v.id}: hook on a non-software company`);
      if (typeof v.fit !== 'number') issues.push(`id ${v.id}: fit missing`);
    }
  } else {
    for (const o of all) for (const j of o.jobs || []) if (!j.title) issues.push(`source ${o.source_id}: job without a title`);
  }
  fs.writeFileSync(path.join(WORK_DIR, `${runId}.out.json`), JSON.stringify(all, null, 1));
  const jobs = kind === 'watch' ? all.reduce((n, o) => n + (o.jobs || []).length, 0) : undefined;
  return { kind, parts: files.length, objects: all.length, expected: byId.size, jobs, issues };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const [cmd, runId] = process.argv.slice(2);
  const target = Number(process.argv.find((a) => a.startsWith('--target='))?.split('=')[1] || 100000);
  if (cmd === 'split' && runId) console.table(split(runId, target));
  else if (cmd === 'merge' && runId) {
    const r = merge(runId);
    console.log(JSON.stringify({ ...r, issues: r.issues.length }, null, 0));
    for (const i of r.issues.slice(0, 30)) console.log('  ' + i);
    if (r.issues.length) process.exitCode = 1;
  } else {
    console.error('Usage: npm run packets -- split <runId> [--target=100000] | merge <runId>');
    process.exitCode = 1;
  }
}
