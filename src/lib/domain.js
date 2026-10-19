const MULTI_PART_TLDS = new Set([
  'com.pk', 'net.pk', 'org.pk', 'edu.pk', 'gov.pk', 'web.pk', 'biz.pk', 'fam.pk',
  'co.uk', 'org.uk', 'ac.uk', 'com.au', 'net.au', 'co.nz', 'com.sa', 'com.tr', 'co.za', 'com.my', 'co.in',
]);

// Hosts where each subdomain is a different owner, so the full host is the identity.
const SHARED_HOSTS = [
  'wixsite.com', 'business.site', 'blogspot.com', 'wordpress.com', 'web.app', 'firebaseapp.com',
  'vercel.app', 'netlify.app', 'github.io', 'herokuapp.com', 'weebly.com', 'square.site', 'webflow.io',
  'godaddysites.com', 'mystrikingly.com', 'carrd.co', 'framer.website', 'pages.dev',
];

const SOCIAL_HOSTS = [
  'facebook.com', 'fb.com', 'instagram.com', 'linkedin.com', 'twitter.com', 'x.com', 'youtube.com',
  'linktr.ee', 'wa.me', 'whatsapp.com', 'tiktok.com', 'google.com', 'goo.gl', 'g.page', 'bit.ly',
  'sites.google.com', 'pinterest.com', 'behance.net', 'dribbble.com', 'upwork.com', 'fiverr.com',
  'clutch.co', 'rozee.pk', 'indeed.com', 'glassdoor.com', 'mustakbil.com',
];

export function hostOf(url) {
  if (!url) return '';
  let s = String(url).trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'http://' + s;
  try {
    return new URL(s).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return '';
  }
}

const endsWithHost = (host, base) => host === base || host.endsWith('.' + base);

export const isSocialHost = (host) => SOCIAL_HOSTS.some((b) => endsWithHost(host, b));

export function registrableDomain(host) {
  host = (host || '').toLowerCase().replace(/^www\d?\./, '');
  if (!host || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return host;
  const shared = SHARED_HOSTS.find((b) => endsWithHost(host, b));
  if (shared) return host === shared ? '' : host;
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  const lastTwo = parts.slice(-2).join('.');
  if (MULTI_PART_TLDS.has(lastTwo)) return parts.slice(-3).join('.');
  return lastTwo;
}

// -> { domain, social } where exactly one may be set; domain is the merge key.
export function companyDomain(url) {
  const host = hostOf(url);
  if (!host) return { domain: '', social: '' };
  if (isSocialHost(host)) return { domain: '', social: url };
  return { domain: registrableDomain(host), social: '' };
}

export const normName = (s) =>
  (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\(.*?\)/g, ' ')
    .replace(/\b(pvt|private|ltd|limited|llc|inc|smc|co|company)\b\.?/g, ' ')
    .replace(/[^a-z0-9]+/g, '');

export function isContacted(name, domain, contactedList) {
  const n = normName(name);
  const d = (domain || '').split('.')[0].replace(/[^a-z0-9]/g, '');
  return contactedList.some((c) => {
    const k = normName(c);
    return k.length >= 4 && (n.includes(k) || (d && (d === k || d.startsWith(k))));
  });
}

// Groups Maps places by website domain. Places with no domain stay alone (keyed by cid).
export function mergeByDomain(places) {
  const groups = new Map();
  for (const p of places) {
    const { domain, social } = companyDomain(p.website);
    const key = domain || `cid:${p.cid}`;
    const g = groups.get(key);
    if (g) {
      g.places.push(p);
      if (!g.social && social) g.social = social;
    } else {
      groups.set(key, { key, domain, social, places: [p] });
    }
  }
  return [...groups.values()];
}
