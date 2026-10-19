import { htmlToText, clip } from '../lib/text.js';

// Career pages and job plugins embed schema.org JobPosting data for Google Jobs; it carries the
// real post date and deadline that the visible page usually hides.

function parseBlocks(html) {
  const out = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(String(html || ''))) !== null) {
    const raw = m[1].trim().replace(/^<!\[CDATA\[|\]\]>$/g, '');
    for (const attempt of [raw, raw.replace(/[\u0000-\u001f]+/g, ' ')]) {
      try {
        out.push(JSON.parse(attempt));
        break;
      } catch {
        /* try the cleaned variant, then give up on this block */
      }
    }
  }
  return out;
}

function collectPostings(node, acc) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) collectPostings(n, acc);
    return;
  }
  const type = [].concat(node['@type'] || []).map(String);
  if (type.some((t) => /^JobPosting$/i.test(t))) acc.push(node);
  for (const k of ['@graph', 'itemListElement', 'item', 'mainEntity']) if (node[k]) collectPostings(node[k], acc);
}

const first = (v) => (Array.isArray(v) ? v[0] : v);

function locationOf(p) {
  const locs = [].concat(p.jobLocation || []);
  const parts = locs
    .map((l) => first(l?.address) || l?.address || {})
    .map((a) => (typeof a === 'string' ? a : [a.addressLocality, a.addressRegion, first(a.addressCountry)?.name || a.addressCountry].filter(Boolean).join(', ')))
    .filter(Boolean);
  return [...new Set(parts)].join(' / ');
}

function salaryOf(p) {
  const bs = first(p.baseSalary);
  if (!bs) return {};
  const v = bs.value && typeof bs.value === 'object' ? bs.value : { value: bs.value };
  const unit = String(v.unitText || bs.unitText || 'MONTH').toUpperCase();
  const currency = String(bs.currency || v.currency || '').toUpperCase();
  if (currency && currency !== 'PKR') return {};
  const div = unit === 'YEAR' ? 12 : unit === 'WEEK' ? 1 / 4.33 : unit === 'HOUR' ? 1 / 173 : 1;
  const lo = Number(v.minValue ?? v.value);
  const hi = Number(v.maxValue ?? v.value);
  if (!Number.isFinite(lo) || lo <= 0) return {};
  return { salary_min: Math.round(lo / div), salary_max: Math.round((Number.isFinite(hi) ? hi : lo) / div) };
}

const EMPLOYMENT = { FULL_TIME: 'full-time', PART_TIME: 'part-time', CONTRACTOR: 'contract', TEMPORARY: 'contract', INTERN: 'internship' };

export function extractJobPostings(html, pageUrl = '') {
  const acc = [];
  for (const b of parseBlocks(html)) collectPostings(b, acc);
  return acc
    .filter((p) => p.title)
    .map((p) => {
      const months = Number(p.experienceRequirements?.monthsOfExperience);
      const remote = /TELECOMMUTE/i.test(String(p.jobLocationType || '')) || /remote/i.test(String(p.applicantLocationRequirements?.name || ''));
      return {
        title: htmlToText(String(p.title)).replace(/\s+/g, ' ').trim(),
        url: p.url || pageUrl || null,
        posted_at: p.datePosted || null,
        closes_at: p.validThrough || null,
        employment_type: EMPLOYMENT[String(first(p.employmentType) || '').toUpperCase()] || null,
        location_text: locationOf(p) || null,
        location_type: remote ? 'remote' : null,
        experience_min: Number.isFinite(months) && months > 0 ? Math.round((months / 12) * 10) / 10 : null,
        description: clip(htmlToText(String(p.description || '')), 4000),
        ...salaryOf(p),
      };
    });
}
