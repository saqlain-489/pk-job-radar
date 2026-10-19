import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseSearchPayloads, cidFromUrl, pickPhone, pickAddress } from '../src/collect/parsePayload.js';
import { classifyPlace } from '../src/collect/filter.js';

const dir = new URL('./fixtures/maps/', import.meta.url);
const frames = fs.readdirSync(dir).filter((f) => f.endsWith('.txt')).map((f) => fs.readFileSync(new URL(f, dir), 'utf8'));
const { listings } = JSON.parse(fs.readFileSync(new URL('q00-listings.json', dir), 'utf8'));

test('real Lahore Maps payload: website or phone for nearly every listing', () => {
  const byCid = parseSearchPayloads(frames);
  const cids = listings.map((l) => cidFromUrl(l.mapsUrl)).filter(Boolean);
  assert.ok(cids.length >= 60);
  const hits = cids.filter((c) => byCid.get(c)?.website || byCid.get(c)?.phone).length;
  assert.ok(hits / cids.length >= 0.9, `coverage ${hits}/${cids.length}`);
  const tl = listings.find((l) => /^TechnoLyte/.test(l.name));
  const got = byCid.get(cidFromUrl(tl.mapsUrl));
  assert.equal(got.website, 'https://technolyte.com/');
  assert.match(got.phone, /^\+92 3\d\d \d{7}$/);
  assert.match(got.address, /Lahore/);
});

test('Pakistani phone formats', () => {
  for (const p of ['0300 1234567', '042-35714444', '(042) 3571 4444', '+92 300 1234567', '+92 42 35714444', '111-222-333']) assert.equal(pickPhone([p]), p);
  for (const p of ['2026', '4.5', '54000', '+1 (212) 555-0100']) assert.equal(pickPhone([p]), '');
});

test('address prefers the street-level Pakistani address', () => {
  assert.equal(pickAddress(['Gulberg III, Lahore', 'Office 5, Arfa Software Technology Park, Ferozepur Rd, Lahore, 54000']), 'Office 5, Arfa Software Technology Park, Ferozepur Rd, Lahore, 54000');
  assert.equal(pickAddress(['1600 Amphitheatre Pkwy, Mountain View, CA 94043']), '');
});

test('noise filter keeps software companies, drops institutes and shops', () => {
  assert.equal(classifyPlace({ name: 'Arbisoft', category: 'Software company' }).verdict, 'keep');
  assert.equal(classifyPlace({ name: 'Lahore IT Academy', category: 'Software company' }).verdict, 'noise');
  assert.equal(classifyPlace({ name: 'Code Craft', category: 'Computer training school' }).verdict, 'noise');
  assert.equal(classifyPlace({ name: 'Ali Computers', category: 'Computer repair service' }).verdict, 'noise');
  assert.equal(classifyPlace({ name: 'Al Noor Mobiles', category: 'Cell phone store' }).verdict, 'noise');
  assert.equal(classifyPlace({ name: 'Star Printers', category: 'Print shop' }).verdict, 'noise');
  assert.equal(classifyPlace({ name: 'Digital Hub', category: 'Internet marketing service' }).verdict, 'unsure');
  assert.equal(classifyPlace({ name: 'Quillsoft Solutions', category: '' }).verdict, 'unsure');
  assert.equal(classifyPlace({ name: 'Bismillah General Store', category: 'Store' }).verdict, 'noise');
});

test('category cleanup and app-dev agencies are not mistaken for phone shops', () => {
  assert.equal(classifyPlace({ name: 'TechSwivel - Mobile App Development Agency', category: 'Software company' }).verdict, 'keep');
  assert.equal(classifyPlace({ name: 'School Management Software', category: 'Software company\nOpen 24 hours' }).verdict, 'keep');
  assert.equal(classifyPlace({ name: 'Raza Enterprises', category: 'No reviews' }).verdict, 'noise');
  assert.equal(classifyPlace({ name: 'Arham Associates', category: 'No reviews' }).verdict, 'unsure');
});
