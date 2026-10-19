import { fetchJson, fetchPage } from '../lib/http.js';
import { htmlToText } from '../lib/text.js';

// Each pattern captures the account slug. `feed: true` means a public JSON feed exists and the
// watch stage reads jobs straight from it (no Claude); the rest are watched as HTML pages.
const PATTERNS = [
  { ats: 'workable', feed: true, re: /\bapply\.workable\.com\/(?!api\b|j\/)([a-z0-9-]+)/i },
  { ats: 'workable', feed: true, re: /\b([a-z0-9-]+)\.workable\.com\b/i },
  { ats: 'lever', feed: true, re: /\bjobs\.(?:eu\.)?lever\.co\/([a-z0-9._-]+)/i },
  { ats: 'greenhouse', feed: true, re: /\b(?:job-)?boards(?:-api)?\.greenhouse\.io\/(?:embed\/job_board(?:\/js)?\?for=|v1\/boards\/)?([a-z0-9_-]+)/i },
  { ats: 'greenhouse', feed: true, re: /greenhouse\.io\/embed\/job_board\/js\?for=([a-z0-9_-]+)/i },
  { ats: 'recruitee', feed: true, re: /\b([a-z0-9-]+)\.recruitee\.com\b/i },
  { ats: 'bamboohr', feed: true, re: /\b([a-z0-9-]+)\.bamboohr\.com\b/i },
  { ats: 'breezy', feed: true, re: /\b([a-z0-9-]+)\.breezy\.hr\b/i },
  { ats: 'smartrecruiters', feed: true, re: /\b(?:careers|jobs)\.smartrecruiters\.com\/([a-z0-9_-]+)/i },
  { ats: 'ashby', feed: true, re: /\bjobs\.ashbyhq\.com\/([a-z0-9._-]+)/i },
  { ats: 'zoho', feed: false, re: /\b([a-z0-9-]+)\.zohorecruit\.(?:com|in|eu)\b/i },
  { ats: 'manatal', feed: false, re: /\b(?:www\.)?careers-page\.com\/([a-z0-9_-]+)/i },
  { ats: 'teamtailor', feed: false, re: /\b([a-z0-9-]+)\.teamtailor\.com\b/i },
  { ats: 'personio', feed: false, re: /\b([a-z0-9-]+)\.jobs\.personio\.(?:de|com)\b/i },
  { ats: 'jazzhr', feed: false, re: /\b([a-z0-9-]+)\.applytojob\.com\b/i },
  { ats: 'freshteam', feed: false, re: /\b([a-z0-9-]+)\.freshteam\.com\b/i },
  { ats: 'rippling', feed: false, re: /\bats\.rippling\.com\/([a-z0-9_-]+)/i },
  { ats: 'jobvite', feed: false, re: /\bjobs\.jobvite\.com\/([a-z0-9_-]+)/i },
  { ats: 'workday', feed: false, re: /\b([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com\b/i },
  { ats: 'trakstar', feed: false, re: /\b([a-z0-9-]+)\.hire\.trakstar\.com\b/i },
];

const BAD_SLUGS = new Set(['www', 'resources', 'marketing', 'partners', 'status', 'go', 'info', 'docs', 'developers', 'api', 'app', 'jobs', 'careers', 'embed', 'assets', 'static', 'cdn', 'help', 'support', 'blog', 'apply', 'j', 'boards', 'job-boards']);

export function atsHomeUrl(ats, slug) {
  return {
    workable: `https://apply.workable.com/${slug}/`,
    lever: `https://jobs.lever.co/${slug}`,
    greenhouse: `https://job-boards.greenhouse.io/${slug}`,
    recruitee: `https://${slug}.recruitee.com/`,
    bamboohr: `https://${slug}.bamboohr.com/careers`,
    breezy: `https://${slug}.breezy.hr/`,
    smartrecruiters: `https://careers.smartrecruiters.com/${slug}`,
    ashby: `https://jobs.ashbyhq.com/${slug}`,
    zoho: `https://${slug}.zohorecruit.com/jobs/Careers`,
    manatal: `https://www.careers-page.com/${slug}`,
    teamtailor: `https://${slug}.teamtailor.com/jobs`,
    personio: `https://${slug}.jobs.personio.com/`,
    jazzhr: `https://${slug}.applytojob.com/apply`,
    freshteam: `https://${slug}.freshteam.com/jobs`,
    rippling: `https://ats.rippling.com/${slug}/jobs`,
    jobvite: `https://jobs.jobvite.com/${slug}`,
    workday: `https://${slug}.wd1.myworkdayjobs.com/`,
    trakstar: `https://${slug}.hire.trakstar.com/`,
  }[ats];
}

export const hasFeed = (ats) => PATTERNS.some((p) => p.ats === ats && p.feed);

// Finds ATS accounts referenced anywhere in a page (links, iframes, embed scripts). Pure.
export function detectAts(html) {
  const s = String(html || '').replace(/\\\//g, '/');
  const found = new Map();
  for (const p of PATTERNS) {
    const re = new RegExp(p.re.source, 'gi');
    let m;
    while ((m = re.exec(s)) !== null) {
      const slug = (m[1] || '').toLowerCase().replace(/[._-]+$/, '');
      if (!slug || BAD_SLUGS.has(slug) || slug.length < 2) continue;
      const k = `${p.ats}:${slug}`;
      if (!found.has(k)) found.set(k, { ats: p.ats, slug, feed: p.feed, url: atsHomeUrl(p.ats, slug) });
    }
  }
  return [...found.values()];
}

const txt = (html) => htmlToText(html || '');

// BambooHR embed: an HTML list of <a href=".../careers/ID">Title</a>, empty when nothing is open.
export function parseBambooEmbed(html, slug) {
  const out = [];
  const seen = new Set();
  const re = /<a[^>]+href=["']([^"']*\/careers\/(\d+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html || ''))) !== null) {
    if (seen.has(m[2])) continue;
    seen.add(m[2]);
    const title = htmlToText(m[3]).replace(/\s+/g, ' ').trim();
    if (!title) continue;
    out.push({ ext_id: m[2], title, url: m[1].startsWith('http') ? m[1] : `https://${slug}.bamboohr.com/careers/${m[2]}`, location_text: '', remote: false, description: '', posted_at: null, employment_type: '' });
  }
  return out;
}

// Each fetcher returns a normalised list: { ext_id, title, url, location_text, remote, description, posted_at, employment_type }.
const FEEDS = {
  async workable(slug) {
    const r = await fetchJson(`https://apply.workable.com/api/v1/widget/accounts/${slug}?details=true`);
    if (!r.json) return null;
    return (r.json.jobs || []).map((j) => ({
      ext_id: j.shortcode || j.code || j.id,
      title: j.title,
      url: j.url || j.shortlink || j.application_url || `https://apply.workable.com/${slug}/j/${j.shortcode}/`,
      location_text: [j.city, j.state, j.country].filter(Boolean).join(', ') || (j.locations || []).map((l) => [l.city, l.country].filter(Boolean).join(', ')).join(' / '),
      remote: !!j.telecommuting,
      description: txt(j.description),
      posted_at: j.published_on || j.created_at || null,
      employment_type: j.employment_type || '',
    }));
  },
  async lever(slug) {
    const r = await fetchJson(`https://api.lever.co/v0/postings/${slug}?mode=json`);
    if (!Array.isArray(r.json)) return null;
    return r.json.map((j) => ({
      ext_id: j.id,
      title: j.text,
      url: j.hostedUrl,
      location_text: j.categories?.location || (j.categories?.allLocations || []).join(' / '),
      remote: /remote/i.test(j.workplaceType || '') || /remote/i.test(j.categories?.location || ''),
      description: [j.descriptionPlain, ...(j.lists || []).map((l) => `${l.text}\n${txt(l.content)}`), j.additionalPlain].filter(Boolean).join('\n'),
      posted_at: j.createdAt ? new Date(j.createdAt).toISOString() : null,
      employment_type: j.categories?.commitment || '',
    }));
  },
  async greenhouse(slug) {
    const r = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`);
    if (!r.json?.jobs) return null;
    const unescape = (s) => String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    return r.json.jobs.map((j) => ({
      ext_id: String(j.id),
      title: j.title,
      url: j.absolute_url,
      location_text: j.location?.name || '',
      remote: /remote/i.test(j.location?.name || ''),
      description: txt(unescape(j.content)),
      posted_at: j.first_published || j.updated_at || null,
      employment_type: '',
    }));
  },
  async recruitee(slug) {
    const r = await fetchJson(`https://${slug}.recruitee.com/api/offers/`);
    if (!r.json?.offers) return null;
    return r.json.offers.map((j) => ({
      ext_id: String(j.id),
      title: j.title,
      url: j.careers_url,
      location_text: j.location || [j.city, j.country].filter(Boolean).join(', '),
      remote: !!j.remote,
      description: txt(`${j.description || ''}\n${j.requirements || ''}`),
      posted_at: j.published_at || j.created_at || null,
      employment_type: j.employment_type_code || '',
    }));
  },
  async bamboohr(slug) {
    const r = await fetchJson(`https://${slug}.bamboohr.com/careers/list`, { noCurl: true });
    if (r.json?.result) {
      const out = [];
      for (const j of r.json.result.slice(0, 15)) {
        const d = await fetchJson(`https://${slug}.bamboohr.com/careers/${j.id}/detail`);
        const jo = d.json?.result?.jobOpening || {};
        out.push({
          ext_id: String(j.id),
          title: j.jobOpeningName,
          url: `https://${slug}.bamboohr.com/careers/${j.id}`,
          location_text: [j.location?.city, j.location?.state, j.location?.country].filter(Boolean).join(', '),
          remote: !!j.isRemote || /remote/i.test(j.locationType || ''),
          description: txt(jo.description),
          posted_at: jo.datePosted || null,
          employment_type: j.employmentStatusLabel || '',
        });
      }
      return out;
    }
    // Some accounts redirect the JSON list away but still serve the embed widget the company's own site uses.
    const e = await fetchPage(`https://${slug}.bamboohr.com/jobs/embed2.php?version=1.0.0&format=json`, { noCurl: true });
    if (!e.ok || !/bamboohr\.com$/i.test(new URL(e.url).hostname)) return null;
    return parseBambooEmbed(e.body, slug);
  },
  async breezy(slug) {
    const r = await fetchJson(`https://${slug}.breezy.hr/json`);
    if (!Array.isArray(r.json)) return null;
    return r.json.map((j) => ({
      ext_id: j.id || j.friendly_id,
      title: j.name,
      url: j.url,
      location_text: j.location?.name || '',
      remote: !!j.location?.is_remote,
      description: txt(j.description),
      posted_at: j.published_date || null,
      employment_type: j.type?.name || '',
    }));
  },
  async smartrecruiters(slug) {
    const r = await fetchJson(`https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=100`);
    if (!r.json?.content) return null;
    return r.json.content.map((j) => ({
      ext_id: j.id,
      title: j.name,
      url: `https://jobs.smartrecruiters.com/${slug}/${j.id}`,
      location_text: [j.location?.city, j.location?.country].filter(Boolean).join(', '),
      remote: !!j.location?.remote,
      description: '',
      posted_at: j.releasedDate || null,
      employment_type: j.typeOfEmployment?.label || '',
    }));
  },
  async ashby(slug) {
    const r = await fetchJson(`https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`);
    if (!r.json?.jobs) return null;
    return r.json.jobs.map((j) => ({
      ext_id: j.id,
      title: j.title,
      url: j.jobUrl,
      location_text: j.location || '',
      remote: !!j.isRemote || /remote/i.test(j.workplaceType || ''),
      description: j.descriptionPlain || txt(j.descriptionHtml),
      posted_at: j.publishedAt || null,
      employment_type: j.employmentType || '',
    }));
  },
};

// -> normalised jobs, or null when the feed could not be read (never "zero jobs" on failure).
export async function fetchAtsJobs(ats, slug) {
  const f = FEEDS[ats];
  if (!f) return null;
  try {
    return await f(slug);
  } catch {
    return null;
  }
}
