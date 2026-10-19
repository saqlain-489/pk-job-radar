import * as cheerio from 'cheerio';
import { registrableDomain, hostOf } from '../lib/domain.js';

export const CAREER_RE = /\b(careers?|jobs?|join(?:\s+(?:us|our\s+team|the\s+team))?|hiring|vacanc(?:y|ies)|openings?|work\s+with\s+us|positions?|opportunit(?:y|ies)|we'?re\s+hiring|life\s+at)\b/i;
const CAREER_HREF = /\/(careers?|jobs?|join-?us|join-?our-?team|hiring|vacanc|openings?|work-?with-?us|opportunities|life-at)\b/i;
const NOT_CAREER = /blog|news|privacy|terms|login|signin|cart|wp-content|\.(pdf|jpg|png|zip)$/i;

export function extractLinks(html, baseUrl) {
  const $ = cheerio.load(String(html || ''));
  const out = [];
  $('a[href]').each((_, el) => {
    const href = ($(el).attr('href') || '').trim();
    if (!href || href.startsWith('#') || /^javascript:/i.test(href)) return;
    let abs;
    try {
      abs = new URL(href, baseUrl).toString();
    } catch {
      return;
    }
    out.push({ href: abs, text: $(el).text().replace(/\s+/g, ' ').trim().slice(0, 120) });
  });
  return out;
}

// Ranks links that look like a careers page; same-site links only.
export function careerCandidates(links, baseUrl) {
  const site = registrableDomain(hostOf(baseUrl));
  const seen = new Set();
  const out = [];
  for (const l of links) {
    if (!/^https?:/i.test(l.href) || NOT_CAREER.test(l.href)) continue;
    const sameSite = registrableDomain(hostOf(l.href)) === site;
    if (!sameSite) continue;
    const textHit = CAREER_RE.test(l.text) && l.text.length <= 40;
    const u = new URL(l.href);
    const hrefHit = CAREER_HREF.test(u.pathname) || /^(careers?|jobs?|hiring|join|talent)\./i.test(u.hostname);
    if (!textHit && !hrefHit) continue;
    const url = l.href.split('#')[0];
    if (seen.has(url)) continue;
    seen.add(url);
    const score = (hrefHit ? 2 : 0) + (textHit ? 2 : 0) + (/career|jobs?\b/i.test(l.text + l.href) ? 1 : 0);
    out.push({ url, text: l.text, score });
  }
  return out.sort((a, b) => b.score - a.score);
}

const EMAIL_RE = /[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,10}/gi;
const JUNK_EMAIL = /(example\.(com|org)|@(domain|email|company|yourcompany)\.com|yourdomain|^(you|your|yourname|email|user|username)@|sentry|wixpress|\.(png|jpe?g|gif|svg|webp)$|@2x|godaddy|cloudflare|^u00|placeholder|test@|john@|jane@|name@)/i;
const HR_LOCAL = /^(hr|hrm|careers?|jobs?|recruit(ment|ing|er)?|hiring|talent|people|join|cv|resumes?|apply|work)\b/i;

// Cloudflare "email protection" hides addresses as hex XOR-ed with the first byte.
export function decodeCfEmail(hex) {
  const key = parseInt(hex.slice(0, 2), 16);
  let out = '';
  for (let i = 2; i + 1 < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return out;
}

export function extractEmails(html) {
  const cf = [...String(html || '').matchAll(/(?:data-cfemail="|email-protection#)([0-9a-f]{8,})/gi)].map((m) => decodeCfEmail(m[1]));
  const s = (String(html || '') + ' ' + cf.join(' '))
    .replace(/&#64;|&#x40;|\[at\]|\(at\)/gi, '@')
    .replace(/%40/g, '@');
  const set = new Set();
  for (const m of s.matchAll(EMAIL_RE)) {
    const e = m[0].toLowerCase().replace(/^(mailto:|u003e)/, '').replace(/\.+$/, '');
    if (!JUNK_EMAIL.test(e) && e.length < 80) set.add(e);
  }
  return [...set];
}

export function pickHrEmail(emails) {
  return emails.find((e) => HR_LOCAL.test(e.split('@')[0])) || '';
}

export function extractWhatsapp(html) {
  const m = String(html || '').match(/(?:wa\.me\/|api\.whatsapp\.com\/send\?phone=)(\+?\d{10,13})/i);
  return m ? m[1] : '';
}

const STACK = [
  ['react', /\breact(\.js|js)?\b/i], ['next.js', /\bnext\.?js\b/i], ['node.js', /\bnode(\.js|js)?\b/i], ['typescript', /\btypescript\b/i],
  ['mern', /\bmern\b/i], ['express', /\bexpress(\.js|js)\b/i], ['nestjs', /\bnest\.?js\b/i], ['angular', /\bangular\b/i], ['vue', /\bvue(\.js)?\b/i],
  ['python', /\bpython\b/i], ['django', /\bdjango\b/i], ['fastapi', /\bfastapi\b/i], ['php', /\bphp\b/i], ['laravel', /\blaravel\b/i],
  ['wordpress', /\bwordpress\b/i], ['shopify', /\bshopify\b/i], ['.net', /(\.net\b|\basp\.net|\bc#)/i], ['java', /\bjava\b(?!script)/i],
  ['flutter', /\bflutter\b/i], ['react native', /\breact native\b/i], ['ios', /\b(ios|swift)\b/i], ['android', /\b(android|kotlin)\b/i],
  ['ai/ml', /\b(artificial intelligence|machine learning|\bai\b|\bml\b|llm|genai|generative ai|chatgpt|openai|computer vision|nlp)\b/i],
  ['aws', /\baws\b|amazon web services/i], ['azure', /\bazure\b/i], ['devops', /\bdevops\b/i], ['blockchain', /\bblockchain|web3\b/i],
  ['salesforce', /\bsalesforce\b/i], ['odoo/erp', /\b(odoo|erp)\b/i], ['seo/marketing', /\b(seo|social media marketing|digital marketing)\b/i],
  ['postgres', /\bpostgres(ql)?\b/i], ['mongodb', /\bmongo(db)?\b/i], ['redis', /\bredis\b/i],
];

export const stackKeywords = (text) => STACK.filter(([, re]) => re.test(text)).map(([k]) => k);

const CLIENT_PLACES = /\b(usa|united states|u\.s\.|uk|united kingdom|canada|australia|europe|germany|netherlands|uae|dubai|saudi|ksa|qatar|singapore|new zealand|ireland|sweden|norway|denmark|switzerland|silicon valley|new york|london|toronto|sydney)\b/gi;

export function clientPlaces(text) {
  return [...new Set((String(text).match(CLIENT_PLACES) || []).map((s) => s.toLowerCase()))].slice(0, 8);
}

export function sizeHints(text) {
  const out = [];
  const re = /(\d{1,4})\s*\+?\s*(employees|team members|engineers|developers|professionals|experts|people|resources|strong team)/gi;
  for (const m of String(text).matchAll(re)) {
    out.push(m[0].replace(/\s+/g, ' '));
    if (out.length >= 3) break;
  }
  return out;
}

const PRODUCT_RE = /\b(our product|saas|sign up|signup|free trial|pricing|book a demo|request a demo|platform for|subscribe|download the app|app store|google play)\b/gi;
export const productHints = (text) => [...new Set((String(text).match(PRODUCT_RE) || []).map((s) => s.toLowerCase()))].slice(0, 6);

// Links on a careers page that look like individual job posts (used for detail fetches in watch).
export function jobLinks(links, baseUrl) {
  const site = registrableDomain(hostOf(baseUrl));
  const seen = new Set();
  return links.filter((l) => {
    if (!/^https?:/i.test(l.href) || NOT_CAREER.test(l.href) || seen.has(l.href)) return false;
    let u;
    try {
      u = new URL(l.href);
    } catch {
      return false;
    }
    if (registrableDomain(u.hostname) !== site) return false;
    const pathHit = /\/(jobs?|careers?|positions?|openings?|vacanc\w*)\/[^/]+/i.test(u.pathname);
    const titleHit = /\b(engineer|developer|lead|manager|intern|designer|analyst|architect|specialist|executive|officer|associate|qa|devops|full.?stack|front.?end|back.?end)\b/i.test(l.text);
    if (!pathHit && !titleHit) return false;
    if (u.toString().split('#')[0] === String(baseUrl).split('#')[0]) return false;
    seen.add(l.href);
    return true;
  });
}

export function looksThin(html) {
  const s = String(html || '');
  const text = s.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const shell = /<div id="(root|app|__next|__nuxt)"[^>]*>\s*<\/div>/i.test(s) || /window\.__NUXT__|ng-version|data-reactroot|<app-root/i.test(s);
  return text.length < 400 || (shell && text.length < 1500);
}

// Numbered/next links that page through the same job list (?page=2, ?a=2, /page/2/).
export function paginationLinks(links, pageUrl, max = 5) {
  let base;
  try {
    base = new URL(pageUrl);
  } catch {
    return [];
  }
  const samePath = (u) => u.origin === base.origin && (u.pathname.replace(/\/page\/\d+\/?$/, '/').replace(/\/+$/, '') === base.pathname.replace(/\/page\/\d+\/?$/, '/').replace(/\/+$/, ''));
  const out = new Map();
  for (const l of links) {
    const text = (l.text || '').trim();
    const isNum = /^\d{1,2}$/.test(text) && Number(text) > 1;
    const isNext = /^(next|next page|older|more jobs|›|»|>|→)$/i.test(text);
    if (!isNum && !isNext) continue;
    let u;
    try {
      u = new URL(l.href);
    } catch {
      continue;
    }
    if (!samePath(u) || u.href.split('#')[0] === base.href.split('#')[0]) continue;
    if (!u.search && !/\/page\/\d+/.test(u.pathname)) continue;
    out.set(u.href.split('#')[0], isNum ? Number(text) : 99);
  }
  return [...out.entries()].sort((a, b) => a[1] - b[1]).slice(0, max).map(([href]) => href);
}

// Unrendered WordPress shortcodes mean the site's own job widget is broken; no wait will fix it.
export const brokenWidget = (html) => (String(html || '').match(/\[(awsmjobs|lever[^\]]{0,40}|wpjobboard[^\]]{0,20}|jobs)\]/i) || [])[0] || '';
