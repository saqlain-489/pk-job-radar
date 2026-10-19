import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { detectAts, hasFeed } from '../src/discover/ats.js';
import { careerCandidates, extractLinks, extractEmails, pickHrEmail, jobLinks, looksThin } from '../src/discover/signals.js';

const page = (f) => fs.readFileSync(new URL(`./fixtures/pages/${f}`, import.meta.url), 'utf8');

test('detects a Workable account from a careers page link', () => {
  const found = detectAts(page('careers-workable.html'));
  assert.deepEqual(found.map((a) => `${a.ats}:${a.slug}`), ['workable:arbisoft-pk']);
  assert.ok(found[0].feed);
});

test('detects embedded Greenhouse, Lever, SmartRecruiters, Zoho and Manatal; ignores LinkedIn and API paths', () => {
  const keys = detectAts(page('careers-embeds.html')).map((a) => `${a.ats}:${a.slug}`).sort();
  assert.deepEqual(keys, ['greenhouse:tkxel', 'lever:10pearls', 'manatal:folio3', 'smartrecruiters:systems1', 'zoho:devsinc']);
});

test('only feed-backed ATSs skip Claude', () => {
  assert.ok(hasFeed('lever') && hasFeed('greenhouse') && hasFeed('workable'));
  assert.ok(!hasFeed('zoho') && !hasFeed('manatal'));
});

test('no ATS on a plain careers page', () => {
  assert.deepEqual(detectAts(page('careers-plain-v1.html')), []);
});

test('finds the careers link and job post links on the same site only', () => {
  const html = page('careers-plain-v1.html');
  const links = extractLinks(html, 'https://acmesoft.pk/');
  assert.equal(careerCandidates(links, 'https://acmesoft.pk/')[0].url, 'https://acmesoft.pk/careers');
  const posts = jobLinks(extractLinks(html, 'https://acmesoft.pk/careers'), 'https://acmesoft.pk/careers').map((l) => l.href);
  assert.deepEqual(posts, ['https://acmesoft.pk/careers/full-stack-developer', 'https://acmesoft.pk/careers/sqa-engineer']);
});

test('HR email beats generic inboxes and junk is dropped', () => {
  const emails = extractEmails('info@acme.pk hr&#64;acme.pk logo@2x.png careers@acme.pk you@example.com');
  assert.ok(!emails.includes('you@example.com'));
  assert.equal(pickHrEmail(emails), 'hr@acme.pk');
});

test('an empty SPA shell is flagged for the browser fallback', () => {
  assert.ok(looksThin('<html><body><div id="root"></div><script src="/app.js"></script></body></html>'));
  assert.ok(!looksThin(page('careers-plain-v1.html').repeat(3)));
});

test('Cloudflare-protected emails are decoded', () => {
  const hex = (email, key = 0x42) => key.toString(16).padStart(2, '0') + [...email].map((c) => (c.charCodeAt(0) ^ key).toString(16).padStart(2, '0')).join('');
  const html = `<a href="/cdn-cgi/l/email-protection#${hex('hr@webiconz.com')}">[email&#160;protected]</a><span data-cfemail="${hex('info@acme.pk', 0x1f)}"></span>`;
  const emails = extractEmails(html);
  assert.ok(emails.includes('hr@webiconz.com') && emails.includes('info@acme.pk'));
});

test('"Powered by" vendor links are not ATS accounts', () => {
  assert.deepEqual(detectAts('<a href="https://resources.bamboohr.com/x">Powered by BambooHR</a><a href="https://bridgelinx.bamboohr.com/careers">Jobs</a>').map((a) => a.slug), ['bridgelinx']);
});

test('a careers subdomain counts as a careers page link', () => {
  const links = extractLinks('<a href="https://careers.senarios.co">Explore</a><a href="https://blog.senarios.co">Blog</a>', 'https://senarios.co/');
  assert.deepEqual(careerCandidates(links, 'https://senarios.co/').map((c) => c.url), ['https://careers.senarios.co/']);
});
