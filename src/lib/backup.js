import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR } from '../config.js';
import { getDb } from '../db.js';

export const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const KEEP = Number(process.env.KEEP_BACKUPS || 30);

// VACUUM INTO writes a consistent copy even while the app has the db open.
export function backupDb(label = 'manual') {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('Z', '').replace('T', '-').replace('.', '');
  const base = path.join(BACKUP_DIR, `radar-${stamp}-${label.replace(/[^\w-]/g, '_')}`);
  let file = `${base}.db`;
  for (let n = 2; fs.existsSync(file); n++) file = `${base}-${n}.db`;
  getDb().exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  // The copy inherits WAL mode, which needs side files to open; make it one self-contained file.
  const copy = new DatabaseSync(file);
  copy.exec('PRAGMA journal_mode = DELETE');
  copy.close();
  const old = fs.readdirSync(BACKUP_DIR).filter((f) => /^radar-.*\.db$/.test(f)).sort();
  for (const f of old.slice(0, Math.max(0, old.length - KEEP))) fs.rmSync(path.join(BACKUP_DIR, f));
  return file;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) console.log(`[backup] ${backupDb(process.argv[2] || 'manual')}`);
