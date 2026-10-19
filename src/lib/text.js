import crypto from 'node:crypto';
import * as cheerio from 'cheerio';

const DROP = 'script, style, noscript, svg, template, iframe, link, meta, head, canvas, video, audio';
const BLOCK = new Set([
  'p', 'div', 'section', 'article', 'li', 'ul', 'ol', 'tr', 'table', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'header', 'footer', 'nav', 'main', 'aside', 'form', 'dd', 'dt', 'dl', 'hr', 'blockquote', 'pre', 'td', 'th',
]);

// cheerio's .text() glues adjacent nodes ("Senior<span>Engineer</span>" → "SeniorEngineer"),
// so walk the tree and separate inline nodes with spaces and blocks with newlines.
function walk($, node, out) {
  if (node.type === 'text') {
    out.push(node.data);
    return;
  }
  if (node.type !== 'tag' && node.type !== 'root') return;
  const block = BLOCK.has(node.name);
  if (block) out.push('\n');
  else out.push(' ');
  for (const c of node.children || []) walk($, c, out);
  if (block) out.push('\n');
}

export function htmlToText(html, { dropChrome = false } = {}) {
  const $ = cheerio.load(String(html || ''));
  $(DROP).remove();
  $('[hidden], [style*="display:none"], [style*="display: none"]').remove();
  if (dropChrome) $('header, footer, nav, [role="navigation"], [class*="cookie" i], [id*="cookie" i]').remove();
  const root = $('body').get(0) || $.root().get(0);
  const out = [];
  walk($, root, out);
  return out
    .join('')
    .replace(/&nbsp;| /g, ' ')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

const VOLATILE = [
  /\b\d+\s*(?:seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?)\s+ago\b/g,
  /\bposted\s+(?:today|yesterday|just now)\b/g,
  /\b(?:today|yesterday|just now)\b/g,
  /©\s*\d{4}(?:\s*[-–]\s*\d{4})?/g,
  /\bcopyright\s*\d{4}\b/g,
  /\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?\b/g,
  /\b\d+\s*(?:views?|applicants?|applications?)\b/g,
  /\bcsrf[\w-]*\s*[:=]?\s*[\w-]{16,}/g,
];

// Text used only for change detection: lowercase, no site chrome, no clocks or counters.
export function normalizeForHash(html) {
  let t = htmlToText(html, { dropChrome: true }).toLowerCase();
  for (const re of VOLATILE) t = t.replace(re, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

export const contentHash = (html) => sha256(normalizeForHash(html));

export function clip(s, n) {
  s = String(s || '');
  return s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, '') + ' …';
}
