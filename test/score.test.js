import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseExperience, parseSalary, parseLocation, parseFlags, parseApply, enrichJob } from '../src/score/jobText.js';
import { scoreJob, roleScore } from '../src/score/score.js';

const example = JSON.parse(fs.readFileSync(new URL('../config/profile.example.json', import.meta.url), 'utf8'));
const profile = { ...example, home_city: 'Faisalabad', pay_floor_pkr: 100000 };
const lahoreProduct = { id: 1, city: 'lahore', kind: 'product', foreign_clients: 1, contacted: 0 };
const score = (job, company = lahoreProduct) => scoreJob(enrichJob(job), company, profile);

test('experience parsing', () => {
  assert.deepEqual(pick(parseExperience('Requires 2-3 years of experience with React')), { min: 2, max: 3 });
  assert.deepEqual(pick(parseExperience('Minimum 3 years experience in Node.js')), { min: 3, max: null });
  assert.deepEqual(pick(parseExperience('5+ years of professional experience')), { min: 5, max: null });
  assert.deepEqual(pick(parseExperience('Experience: 1 to 2 years')), { min: 1, max: 2 });
  assert.equal(parseExperience('Fresh graduates are welcome').min, 0);
  assert.equal(parseExperience('Founded 12 years ago, we love clean code'), null);
});
const pick = (e) => ({ min: e.min, max: e.max });

test('salary parsing to monthly PKR', () => {
  assert.deepEqual(pick2(parseSalary('Salary: PKR 80,000 - 120,000 per month')), [80000, 120000]);
  assert.deepEqual(pick2(parseSalary('Package Rs. 60k')), [60000, 60000]);
  assert.deepEqual(pick2(parseSalary('Salary 1.5 lac to 2 lac')), [150000, 200000]);
  assert.deepEqual(pick2(parseSalary('Salary: PKR 2,400,000 per annum')), [200000, 200000]);
  assert.equal(parseSalary('We have 3 offices and 120 people'), null);
});
const pick2 = (s) => [s.min, s.max];

test('location and flags', () => {
  assert.equal(parseLocation('This is a fully remote role').type, 'remote');
  assert.equal(parseLocation('Hybrid, 3 days in office', 'Lahore, Pakistan').city, 'lahore');
  assert.equal(parseLocation('On-site', 'Dubai, UAE').country, 'foreign');
  assert.deepEqual(parseFlags('A 2-year service bond applies. Night shift (US hours).', 'Software Engineer'), ['service bond', 'night shift']);
  assert.ok(parseFlags('', 'MERN Stack Intern').includes('internship'));
  assert.ok(parseFlags('Fresh graduates only', 'Junior Developer').includes('freshers only'));
});

test('direct-application leads: WhatsApp and email CV', () => {
  assert.deepEqual(parseApply('WhatsApp your CV at 0300-1234567'), { method: 'whatsapp', contact: '0300-1234567' });
  assert.deepEqual(parseApply('Send your CV to hr@acme.pk with the subject line'), { method: 'email', contact: 'hr@acme.pk' });
});

test('role classification', () => {
  assert.equal(roleScore('MERN Stack Developer').pts, 30);
  assert.equal(roleScore('Generative AI Engineer').pts, 30);
  assert.equal(roleScore('Business Development Executive').pts, 0);
  assert.equal(roleScore('Full Stack Developer (Content Platform)').pts, 30);
  assert.ok(roleScore('Laravel Developer').pts < 15);
});

test('a 2–3 year remote MERN role at a product company scores high', () => {
  const r = score({ title: 'MERN Stack Developer', description: '2-3 years experience. React, Node.js, MongoDB, TypeScript. Fully remote.', skills: [] });
  assert.ok(r.score >= 85, `got ${r.score}`);
  assert.ok(r.reasons.some((x) => /match/.test(x)));
  assert.ok(r.reasons.includes('remote'));
});

test('ordering: remote > hybrid > Lahore on-site > other city on-site', () => {
  const base = { title: 'Full Stack Developer', description: '2 years experience with React and Node.js.' };
  const remote = score({ ...base, location_type: 'remote' }).score;
  const hybrid = score({ ...base, location_type: 'hybrid', city: 'lahore' }).score;
  const lahore = score({ ...base, location_type: 'onsite', city: 'lahore' }).score;
  const karachi = score({ ...base, location_type: 'onsite', city: 'karachi' }).score;
  assert.ok(remote > hybrid && hybrid > lahore && lahore > karachi, `${remote} ${hybrid} ${lahore} ${karachi}`);
});

test('experience bands: 3+ is a stretch, 5+ is effectively skipped', () => {
  const base = { title: 'Node.js Developer', location_type: 'onsite', city: 'lahore' };
  const match = score({ ...base, description: '2+ years experience' }).score;
  const stretch = score({ ...base, description: '3+ years experience' }).score;
  const senior = score({ ...base, description: '5+ years experience' });
  assert.ok(match > stretch, `${match} vs ${stretch}`);
  assert.ok(senior.score <= 25);
  assert.ok(senior.flags.includes('5+ years'));
  assert.ok(score({ title: 'Senior React Developer', description: '' }).score < match);
});

test('missing salary is neutral; a listed salary under 100k is a strong down-score', () => {
  const base = { title: 'React Developer', description: '2 years experience. React, Next.js.', location_type: 'onsite', city: 'lahore' };
  const none = score(base).score;
  const low = score({ ...base, description: base.description + ' Salary: PKR 60,000 - 80,000.' });
  const good = score({ ...base, description: base.description + ' Salary: PKR 150,000 - 220,000.' }).score;
  assert.ok(none - low.score >= 30);
  assert.ok(low.flags.includes('below pay floor'));
  assert.ok(good > none);
});

test('internship, bond and freshers-only are penalised and flagged, never hidden', () => {
  const intern = score({ title: 'MERN Stack Intern', description: 'Internship, 3 months, stipend 25,000.' });
  assert.ok(intern.score < 40 && intern.flags.includes('internship'));
  const bond = score({ title: 'Software Engineer', description: '2 years experience. 2-year service bond.' });
  assert.ok(bond.flags.includes('service bond'));
  assert.ok(score({ title: 'Software Engineer', description: '2 years experience.' }).score - bond.score >= 15);
});

test('non-engineering and abroad on-site roles stay visible but at the bottom', () => {
  assert.ok(score({ title: 'Sales Executive', description: 'Remote.' }).score <= 10);
  const abroad = score({ title: 'Full Stack Developer', description: '2 years. On-site.', location_text: 'Riyadh, Saudi Arabia' });
  assert.ok(abroad.score <= 10 && abroad.flags.includes('outside Pakistan'));
});

test('already-contacted companies are flagged, not penalised', () => {
  const job = { title: 'Full Stack Developer', description: '2 years. Remote.' };
  const a = score(job);
  const b = score(job, { ...lahoreProduct, contacted: 1 });
  assert.equal(a.score, b.score);
  assert.ok(b.flags.includes('already contacted'));
});

test('sales/support titles with "engineer" are not engineering roles', () => {
  for (const t of ['Sales Engineer', 'Senior Technical Support Engineer', 'Associate Business Developer', 'Solutions Engineer, Mid Market', 'Account Executive']) assert.equal(roleScore(t).pts, 0, t);
  assert.ok(roleScore('Software Engineer - MERN').pts >= 28);
});

test('remote roles based abroad are outside Pakistan; Pakistani areas are not', () => {
  assert.ok(score({ title: 'Full Stack Developer', description: '2 years.', location_text: 'United States - Remote', remote: true }).flags.includes('outside Pakistan'));
  assert.ok(score({ title: 'Full Stack Developer', description: '2 years.', location_text: 'Mexico City - Hybrid' }).flags.includes('outside Pakistan'));
  assert.ok(!score({ title: 'Full Stack Developer', description: '2 years.', location_text: 'Pakistan - Remote', remote: true }).flags.includes('outside Pakistan'));
  assert.ok(!score({ title: 'Full Stack Developer', description: '2 years.', location_text: 'Johar Town' }).flags.includes('outside Pakistan'));
});

test('a named off-stack technology outranks a generic "Software Engineer" title', () => {
  assert.ok(roleScore('Software Engineer- ROR').pts < 10);
  assert.ok(roleScore('Software Engineer - Python').pts < 20);
  assert.ok(roleScore('Software Engineer - React').pts >= 28);
});

test('off-stack roles cap at 50 even with a perfect experience and location fit', () => {
  const r = score({ title: 'Shopify Developer', description: '2 years experience. React, Node.js, TypeScript, Redis. Remote.' });
  assert.ok(r.score <= 50, `got ${r.score}`);
});

test('network, embedded and security engineering are a different field', () => {
  for (const t of ['Network System Engineer', 'Embedded Systems Engineer', 'Information Security Specialist']) assert.ok(roleScore(t).pts <= 5, t);
});

test('job age: fresh posts rank up, month-old posts sink, unknown dates are neutral', () => {
  const now = Date.parse('2026-10-17T12:00:00Z');
  const base = { title: 'Full Stack Developer', description: '2 years experience. React, Node.js.', location_type: 'remote' };
  const at = (d) => scoreJob(enrichJob({ ...base, posted_at: d }), lahoreProduct, profile, now);
  const fresh = at('2026-10-15');
  const week = at('2026-10-11');
  const twoWeeks = at('2026-10-05');
  const month = at('2026-09-25');
  const stale = at('2026-08-01');
  const unknown = at(null);
  assert.ok(fresh.score > week.score && week.score > twoWeeks.score && twoWeeks.score > month.score && month.score > stale.score);
  assert.ok(fresh.reasons.some((r) => /fresh: posted 2 days ago/.test(r)));
  assert.ok(month.flags.includes('old post'));
  assert.ok(stale.flags.includes('stale post (30+ days)'));
  assert.equal(unknown.score, week.score);
  assert.ok(unknown.reasons.includes('post date unknown'));
  assert.ok(fresh.score - stale.score >= 40);
});

test('teaching jobs that name a stack are not engineering roles', () => {
  assert.equal(roleScore('Full Stack Development Instructor').pts, 0);
  assert.equal(roleScore('AI Trainer').pts, 0);
});

test('home city (Faisalabad) on-site ranks above Lahore on-site but below hybrid and remote', () => {
  const base = { title: 'MERN Stack Developer', description: '2 years experience. React, Node.js.' };
  const remote = score({ ...base, location_type: 'remote' }).score;
  const hybridLhr = score({ ...base, location_type: 'hybrid', city: 'lahore' }).score;
  const fsd = score({ ...base, location_type: 'onsite', city: 'faisalabad' });
  const lhr = score({ ...base, location_type: 'onsite', city: 'lahore' }).score;
  const khi = score({ ...base, location_type: 'onsite', city: 'karachi' }).score;
  assert.ok(remote > hybridLhr && hybridLhr > fsd.score && fsd.score > lhr && lhr > khi, `${remote} ${hybridLhr} ${fsd.score} ${lhr} ${khi}`);
  assert.ok(fsd.reasons.some((r) => /home city/.test(r)));
});
