import { getDb, now, parseJson } from '../db.js';
import { profile } from '../config.js';
import { companyDomain, isContacted } from '../lib/domain.js';
import { classifyPlace, cleanCategory } from './filter.js';

// Saves one Maps place and merges it into a company keyed by website domain (or cid when no site).
export function storePlace(p, { city, query }) {
  const db = getDb();
  const t = now();
  p = { ...p, category: cleanCategory(p.category) };
  const { verdict, reason } = classifyPlace(p);
  const existing = db.prepare('SELECT cid, company_id FROM places WHERE cid = ?').get(p.cid);
  if (existing) {
    db.prepare(
      `UPDATE places SET website = COALESCE(NULLIF(?, ''), website), phone = COALESCE(NULLIF(?, ''), phone),
       address = COALESCE(NULLIF(?, ''), address), category = ?, filter_verdict = ?, filter_reason = ? WHERE cid = ?`
    ).run(p.website || '', p.phone || '', p.address || '', p.category, verdict, reason, p.cid);
  } else {
    db.prepare(
      `INSERT INTO places (cid, name, category, website, phone, address, rating, reviews, maps_url, city, query, filter_verdict, filter_reason, first_seen)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(p.cid, p.name, p.category || '', p.website || '', p.phone || '', p.address || '', p.rating || null, p.reviewCount || null, p.mapsUrl || '', city, query, verdict, reason, t);
  }
  if (verdict === 'noise') return { verdict, isNew: !existing, companyId: null };

  const { domain, social } = companyDomain(p.website);
  const key = domain || `cid:${p.cid}`;
  const source = `maps:${query}`;
  let company = db.prepare('SELECT id, sources FROM companies WHERE key = ?').get(key);
  let createdCompany = false;
  if (company) {
    const sources = parseJson(company.sources, []);
    if (!sources.includes(source)) sources.push(source);
    db.prepare(
      `UPDATE companies SET sources = ?, phone = COALESCE(phone, NULLIF(?, '')), address = COALESCE(address, NULLIF(?, '')),
       rating = COALESCE(rating, ?), reviews = MAX(COALESCE(reviews, 0), ?), social_url = COALESCE(social_url, NULLIF(?, '')),
       maps_category = COALESCE(NULLIF(maps_category, ''), ?), updated_at = ? WHERE id = ?`
    ).run(JSON.stringify(sources), p.phone || '', p.address || '', p.rating || null, p.reviewCount || 0, social, p.category, t, company.id);
  } else {
    const contacted = isContacted(p.name, domain, profile.already_contacted) ? 1 : 0;
    const r = db
      .prepare(
        `INSERT INTO companies (key, domain, name, website, city, phone, address, maps_category, rating, reviews, social_url, sources,
         filter_verdict, filter_reason, contacted, discover_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(key, domain || null, p.name, domain ? p.website : '', city, p.phone || '', p.address || '', p.category || '', p.rating || null,
        p.reviewCount || null, social, JSON.stringify([source]), verdict, reason, contacted, domain ? 'pending' : 'no_website', t, t);
    company = { id: Number(r.lastInsertRowid) };
    createdCompany = true;
  }
  db.prepare('UPDATE places SET company_id = ? WHERE cid = ?').run(company.id, p.cid);
  return { verdict, isNew: !existing, companyId: company.id, createdCompany };
}
