// Rozee.pk search pages embed the result list as JSON; read it without a browser. Pure functions.

function arrayAt(s, from) {
  let depth = 0;
  let inStr = false;
  for (let k = from; k < s.length; k++) {
    const c = s[k];
    if (inStr) {
      if (c === '\\') k++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '[') depth++;
    else if (c === ']' && --depth === 0) return s.slice(from, k + 1);
  }
  return null;
}

export function parseSearch(html) {
  const s = String(html || '');
  const total = Number((s.match(/"numFound"\s*:\s*(\d+)/) || [])[1] || 0);
  const at = s.indexOf('"jid"');
  if (at < 0) return { total, jobs: [] };
  const start = s.lastIndexOf('[{', at);
  const raw = start >= 0 ? arrayAt(s, start) : null;
  let arr = [];
  try {
    arr = JSON.parse(raw || '[]');
  } catch {
    return { total, jobs: [], error: 'job list did not parse' };
  }
  return { total, jobs: arr.filter((j) => j && j.jid && j.title).map(normalize) };
}

export function yearsFromText(t) {
  const s = String(t || '').toLowerCase();
  if (!s) return null;
  if (/fresh|no experience|less than 1/.test(s)) return 0;
  const m = s.match(/(\d+(?:\.\d+)?)\s*(year|month)/);
  if (!m) return null;
  return m[2] === 'month' ? Math.round((Number(m[1]) / 12) * 10) / 10 : Number(m[1]);
}

// Rozee mixes real skills ("React-JS", "GraphQL") with long topic tags ("planning-and-design").
const READABLE_SKILL = /^[A-Za-z.#+]{2,15}(-[A-Za-z.#+]{1,10})?$/;

function normalize(j) {
  const min = yearsFromText(j.experience_text);
  const max = yearsFromText(j.max_experience_text);
  const shift = String(j.type || '');
  return {
    ext_id: String(j.jid),
    title: String(j.title).trim(),
    company: String(j.company || j.company_en || j.company_exact || '').trim(),
    company_rozee_id: j.company_id || null,
    city: String(j.city || '').trim() || null,
    url: j.permaLink ? `https://www.rozee.pk/${j.permaLink}` : null,
    posted_at: j.created_at || null,
    closes_at: j.applyBy || null,
    experience_min: min,
    experience_max: max != null && min != null && max > min ? max : null,
    skills: [...new Set((j.skills || []).filter((x) => READABLE_SKILL.test(x)).map((x) => x.replace(/-/g, ' ')))].slice(0, 12),
    description: String(j.description_raw || j.description || '').trim(),
    flags: /night|second shift|evening/i.test(shift) ? ['night shift'] : [],
    via: j.jobSource === 'external' && j.whereFrom ? String(j.whereFrom) : null,
    shift,
  };
}

// Rozee answers suspected bots with a challenge page (?chlng=y) or a captcha; stop for the day.
export function isChallenge(res) {
  const url = String(res.url || '');
  const body = String(res.body || '').slice(0, 200000);
  if ([403, 429, 503].includes(res.status)) return true;
  if (/[?&]chlng=y/.test(url)) return true;
  if (/cf-chl|challenge-platform|g-recaptcha|hcaptcha|verify you are human/i.test(body) && !/"jid"/.test(body)) return true;
  return false;
}

export function searchUrl(query, cityId, offset = 0) {
  return `https://www.rozee.pk/job/jsearch/q/${encodeURIComponent(query)}/fc/${cityId}${offset ? `/fpn/${offset}` : ''}`;
}
