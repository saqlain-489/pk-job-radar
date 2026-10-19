import { closeDb } from '../db.js';
import { rescoreAll } from '../watch/jobs.js';
import { backupDb } from '../lib/backup.js';

backupDb('rescore');

console.log(`[rescore] ${rescoreAll()} jobs re-scored`);
closeDb();
