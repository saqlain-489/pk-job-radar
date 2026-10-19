import { config } from '../config.js';
import { fetchPage, fetchHomepage } from '../lib/http.js';
import { renderPage } from '../lib/browser.js';
import { htmlToText, clip } from '../lib/text.js';
import { detectAts } from './ats.js';
import {
  extractLinks, careerCandidates, extractEmails, pickHrEmail, extractWhatsapp, stackKeywords,
  clientPlaces, sizeHints, productHints, jobLinks, looksThin,
} from './signals.js';

async function getWithRender(url, first) {
  const r = first || (await fetchPage(url));
  if (config.renderFallback && (!r.ok || looksThin(r.body))) {
    const rr = await renderPage(r.url || url);
    if (rr.ok && rr.body && rr.body.length > (r.body || '').length) return { ...rr, rendered: true };
  }
  return r;
}

const careerish = (text) => /\b(career|job|opening|position|vacanc|hiring|join (us|our team)|apply|resume|cv)\b/i.test(text);

// Plain-code half of discovery: everything a person would check on a company site, minus judgment.
export async function probeCompany(company) {
  const out = { website: company.website, reachable: false, rendered: false, careers: null, ats: [], emails: [] };
  const home0 = await fetchHomepage(company.website);
  const home = await getWithRender(home0.url || company.website, home0);
  if (!home.ok || !home.body) {
    out.error = home.error || `HTTP ${home.status}`;
    return out;
  }
  out.reachable = true;
  out.final_url = home.url;
  out.rendered = !!home.rendered;
  const homeText = htmlToText(home.body, { dropChrome: false });
  const title = (home.body.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  const desc = (home.body.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i) || [])[1] || '';
  out.title = clip(title.replace(/\s+/g, ' ').trim(), 140);
  out.description = clip(desc, 240);
  out.home_excerpt = clip(homeText.replace(/\n+/g, ' · '), 900);

  const links = extractLinks(home.body, home.url);
  let ats = detectAts(home.body);
  let emails = extractEmails(home.body);
  const candidates = careerCandidates(links, home.url);

  let careers = null;
  for (const c of candidates.slice(0, 2)) {
    const r = await getWithRender(c.url);
    if (r.ok && r.body) {
      careers = { url: r.url || c.url, html: r.body, rendered: !!r.rendered, via: 'link', link_text: c.text };
      break;
    }
  }
  if (!careers && !ats.length) {
    const base = new URL(home.url).origin;
    for (const p of ['/careers', '/jobs', '/career']) {
      const r = await fetchPage(base + p, { noCurl: true });
      if (r.ok && r.body && careerish(htmlToText(r.body).slice(0, 4000)) && !/404|not found/i.test(htmlToText(r.body).slice(0, 300))) {
        careers = { url: r.url, html: r.body, rendered: false, via: 'guess' };
        break;
      }
    }
  }
  if (careers) {
    ats = [...ats, ...detectAts(careers.html)];
    emails = [...new Set([...emails, ...extractEmails(careers.html)])];
    const cText = htmlToText(careers.html, { dropChrome: true });
    const cLinks = extractLinks(careers.html, careers.url);
    out.careers = {
      url: careers.url,
      via: careers.via,
      rendered: careers.rendered,
      excerpt: clip(cText.replace(/\n+/g, ' · '), 1500),
      job_links: jobLinks(cLinks, careers.url).slice(0, 12).map((l) => ({ text: l.text, url: l.href })),
    };
  }

  if (!pickHrEmail(emails)) {
    const contact = links.find((l) => /contact/i.test(l.text + ' ' + l.href) && l.href.startsWith(new URL(home.url).origin));
    if (contact) {
      const r = await fetchPage(contact.href);
      if (r.ok) emails = [...new Set([...emails, ...extractEmails(r.body)])];
    }
  }

  const uniqAts = new Map(ats.map((a) => [`${a.ats}:${a.slug}`, a]));
  out.ats = [...uniqAts.values()];
  out.emails = emails.slice(0, 8);
  out.hr_email = pickHrEmail(emails);
  out.whatsapp = extractWhatsapp(home.body + (careers?.html || ''));
  const allText = `${homeText}\n${out.careers?.excerpt || ''}`;
  out.stack = stackKeywords(allText);
  out.client_places = clientPlaces(allText);
  out.size_hints = sizeHints(allText);
  out.product_hints = productHints(allText);
  out.career_candidates = candidates.slice(0, 4).map((c) => c.url);
  out.linkedin = (links.find((l) => /linkedin\.com\/company\/[^/?#]+/i.test(l.href)) || {}).href?.split('?')[0] || '';
  return out;
}
