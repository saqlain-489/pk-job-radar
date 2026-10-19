import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortName, draftEmail } from '../src/outreach/drafts.js';

test('cold-email greeting uses a short company name', () => {
  assert.equal(shortName('TenX Private Limited'), 'TenX');
  assert.equal(shortName('Softech Systems (Pvt.) Limited'), 'Softech Systems');
  assert.equal(shortName('Contour Software Pvt. Ltd'), 'Contour Software');
  assert.equal(shortName('Webiconz Technologies | Website Development Agency in Lahore Pakistan'), 'Webiconz Technologies');
  assert.equal(shortName('i2c Inc.'), 'i2c');
});

test('draft opens with the hook, never claims never-claim skills, and names no send action', () => {
  const d = draftEmail({ name: 'TenX Private Limited', hook: 'Your breast-cancer AI work stood out.', stack: '["ai/ml","react"]' });
  assert.match(d.body, /^Hi TenX team,\n\nYour breast-cancer AI work stood out\./);
  assert.doesNotMatch(d.body, /nestjs|fastify|typeorm/i);
  assert.equal(d.subject, 'Full-stack / AI engineer for TenX');
});
