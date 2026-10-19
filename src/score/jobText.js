// Pulls structured facts out of a job's free text. Pure; used for ATS jobs and as a backstop
// for anything Claude's extraction leaves empty.

const NUM = String.raw`(\d{1,2}(?:\.\d)?)`;
const YEARS = String.raw`(?:years?|yrs?)`;
const EXP_PATTERNS = [
  new RegExp(String.raw`${NUM}\s*(?:-|–|—|to)\s*${NUM}\s*\+?\s*${YEARS}`, 'i'),
  new RegExp(String.raw`(?:minimum|min\.?|at\s+least|over|more\s+than)\s+(?:of\s+)?${NUM}\s*\+?\s*${YEARS}`, 'i'),
  new RegExp(String.raw`${NUM}\s*\+\s*${YEARS}`, 'i'),
  new RegExp(String.raw`${NUM}\s*${YEARS}`, 'i'),
];
const EXP_CONTEXT = /experience|exp\b|hands[- ]on|professional|industry|working/i;

export function parseExperience(text) {
  const s = String(text || '').replace(/\s+/g, ' ');
  let best = null;
  for (const [pi, re] of EXP_PATTERNS.entries()) {
    const g = new RegExp(re.source, 'gi');
    for (const m of s.matchAll(g)) {
      const ctx = s.slice(Math.max(0, m.index - 60), m.index + m[0].length + 60);
      if (!EXP_CONTEXT.test(ctx)) continue;
      const a = Number(m[1]);
      const b = m[2] !== undefined && pi === 0 ? Number(m[2]) : null;
      if (a > 20 || (b !== null && b > 25)) continue;
      const open = pi === 1 || pi === 2;
      const cand = { min: a, max: b ?? (open ? null : a), raw: m[0].trim(), at: m.index };
      if (!best || cand.at < best.at) best = cand;
    }
    if (best) break;
  }
  if (best) return best;
  const months = s.match(/(\d{1,2})\s*(?:\+\s*)?months?\s+(?:of\s+)?(?:experience|exp)/i);
  if (months) return { min: Number(months[1]) / 12, max: null, raw: months[0] };
  if (/\bfresh(?:er)?s?\b|fresh graduates?|no experience required|0\s*years?/i.test(s)) return { min: 0, max: 1, raw: 'fresher' };
  return null;
}

export function experienceFromTitle(title) {
  const t = String(title || '');
  if (/\b(principal|staff|head|director|vp|cto|architect)\b/i.test(t)) return { min: 7, max: null, raw: 'title', inferred: true };
  if (/\b(lead|team lead|tech lead|manager)\b/i.test(t)) return { min: 5, max: null, raw: 'title', inferred: true };
  if (/\b(senior|sr\.?)\b/i.test(t)) return { min: 4, max: null, raw: 'title', inferred: true };
  if (/\b(intern|internship|trainee)\b/i.test(t)) return { min: 0, max: 0, raw: 'title', inferred: true };
  if (/\b(junior|jr\.?|associate|entry)\b/i.test(t)) return { min: 0.5, max: 2, raw: 'title', inferred: true };
  if (/\b(mid|intermediate)\b/i.test(t)) return { min: 2, max: 4, raw: 'title', inferred: true };
  return null;
}

const USD_PKR = 280;

function toPkr(numStr, unit) {
  let n = Number(String(numStr).replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  if (/^k$/i.test(unit)) n *= 1000;
  else if (/lac|lakh/i.test(unit || '')) n *= 100000;
  return n;
}

// Monthly PKR range when a salary is stated near salary/PKR/Rs wording.
export function parseSalary(text) {
  const s = String(text || '').replace(/\s+/g, ' ');
  const amt = String.raw`(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k|lacs?|lakhs?)?`;
  const re = new RegExp(String.raw`(salary|pkr|rs\.?|compensation|package|stipend|pay|\$|usd)[^.\n]{0,40}?${amt}(?:\s*(?:-|–|to)\s*(?:pkr|rs\.?|\$)?\s*${amt})?`, 'gi');
  for (const m of s.matchAll(re)) {
    const tail = s.slice(m.index, m.index + m[0].length + 30);
    const usd = /\$|usd/i.test(m[1]) || /usd|\$/i.test(tail.slice(0, m[0].length));
    let lo = toPkr(m[2], m[3]);
    let hi = m[4] ? toPkr(m[4], m[5] || m[3]) : null;
    if (lo === null) continue;
    if (usd) {
      lo *= USD_PKR;
      if (hi) hi *= USD_PKR;
    }
    if (/per\s+annum|annual|yearly|\/\s*year|per\s+year|p\.a/i.test(tail)) {
      lo /= 12;
      if (hi) hi /= 12;
    }
    if (lo < 10000 && !usd) continue;
    if (lo > 5_000_000) continue;
    return { min: Math.round(lo), max: Math.round(hi || lo), raw: m[0].trim(), currency: usd ? 'USD→PKR' : 'PKR' };
  }
  return null;
}

const PK_CITIES = ['lahore', 'karachi', 'islamabad', 'rawalpindi', 'faisalabad', 'multan', 'peshawar', 'gujranwala', 'sialkot', 'hyderabad', 'quetta', 'bahawalpur', 'sargodha', 'abbottabad'];
const FOREIGN = /\b(usa|united states|u\.s\.|uk|united kingdom|london|canada|toronto|australia|germany|netherlands|uae|dubai|abu dhabi|saudi|riyadh|jeddah|qatar|doha|bahrain|oman|kuwait|singapore|malaysia|india|egypt|turkey|poland|portugal|spain|ireland|sweden|europe|emea|latam)\b/i;

export function parseLocation(text, locationText = '') {
  const s = `${locationText} ${text}`.toLowerCase();
  let type = null;
  if (/\b(not|no)\s+remote\b|\bremote\s*:\s*no\b/.test(s)) type = 'onsite';
  else if (/\bhybrid\b/.test(s)) type = 'hybrid';
  else if (/\b(fully\s+)?remote\b|work from home|\bwfh\b|work-from-home/.test(s)) type = 'remote';
  else if (/\bon[- ]?site\b|\bin[- ]office\b|office[- ]based|work from office|\bwfo\b/.test(s)) type = 'onsite';
  const loc = String(locationText || '').toLowerCase();
  const city = PK_CITIES.find((c) => loc.includes(c)) || PK_CITIES.find((c) => new RegExp(`\\b${c}\\b`).test(s)) || null;
  const pkLoc = /pakistan|\bpk\b|\b(gulberg|johar town|dha|model town|bahria|cantt|arfa|faisal town|garden town|township|wapda town|blue area|i-?\d{1,2}|f-?\d{1,2}|g-?\d{1,2}|e-?\d{1,2}|clifton|saddar|nastp)\b/.test(loc) || PK_CITIES.some((c) => loc.includes(c));
  // Any named place in the location field that isn't Pakistani means the role is based abroad.
  const placeLeft = loc.replace(/\b(remote|hybrid|on-?site|in[- ]office|office|anywhere|worldwide|global|work from home|wfh|flexible|multiple locations?|full[- ]time|part[- ]time)\b|[^a-z]+/g, '');
  const foreignLoc = !pkLoc && (FOREIGN.test(loc) || placeLeft.length > 2);
  return { type, city, country: foreignLoc ? 'foreign' : city || pkLoc || /pakistan/.test(s) ? 'pk' : null };
}

export function parseFlags(text, title = '') {
  const s = `${title}\n${text}`;
  const flags = [];
  if (/service\s+bond|employment\s+bond|\bbond\s+(?:period|of)\b|security\s+cheque|surety\s+bond|\bbond\b.{0,30}(?:years?|months?)/i.test(s)) flags.push('service bond');
  if (/contract(?:ual)?\s+(?:basis|role|position|employment)|\bon\s+contract\b|fixed[- ]term/i.test(s)) flags.push('contract');
  if (/\bunpaid\b|without\s+stipend|no\s+stipend|stipend\s*:\s*(?:none|nil|no)\b/i.test(s)) flags.push('unpaid');
  if (/\b(internship|intern|trainee)\b/i.test(title) || /\binternship\b/i.test(s.slice(0, 400))) flags.push('internship');
  if (/fresh(?:er)?s?\s+only|only\s+fresh|fresh\s+graduates?\s+only|freshers?\s+(?:are\s+)?(?:encouraged|welcome)\s+only/i.test(s)) flags.push('freshers only');
  if (/\b(females?|women)\s+only\b|only\s+(?:females?|women)\b/i.test(s)) flags.push('women only');
  if (/\bmales?\s+only\b|only\s+males?\b/i.test(s)) flags.push('men only');
  if (/night\s+shift|us\s+shift|uk\s+shift|evening\s+shift/i.test(s)) flags.push('night shift');
  if (/\b(part[- ]time)\b/i.test(s)) flags.push('part-time');
  return flags;
}

export function parseApply(text) {
  const s = String(text || '');
  const wa = s.match(/whats\s?app[^.\n]{0,40}?(\+?\d[\d\s-]{9,15}\d)/i);
  if (wa) return { method: 'whatsapp', contact: wa[1].replace(/\s+/g, '') };
  const em = s.match(/(?:send|email|share|forward|drop|submit|mail)[^.\n]{0,60}?(?:cv|resume)[^.\n]{0,60}?([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i)
    || s.match(/(?:cv|resume)s?[^.\n]{0,40}?(?:at|to)\s*:?\s*([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i);
  if (em) return { method: 'email', contact: em[1].toLowerCase() };
  return null;
}

export function parseEmploymentType(text, title = '', given = '') {
  const s = `${given} ${title} ${String(text).slice(0, 600)}`.toLowerCase();
  if (/\bintern(ship)?\b|\btrainee\b/.test(s)) return 'internship';
  if (/part[- ]time/.test(s)) return 'part-time';
  if (/\bcontract(or|ual)?\b|freelance/.test(s) && !/full[- ]time/.test(s)) return 'contract';
  if (/full[- ]time|permanent/.test(s)) return 'full-time';
  return null;
}

export function enrichJob(job) {
  const text = `${job.title || ''}\n${job.location_text || ''}\n${job.description || ''}`;
  const exp = job.experience_min != null ? { min: job.experience_min, max: job.experience_max } : parseExperience(job.description) || experienceFromTitle(job.title);
  const sal = job.salary_min != null ? { min: job.salary_min, max: job.salary_max ?? job.salary_min } : parseSalary(job.description);
  const loc = parseLocation(text, job.location_text);
  const apply = job.apply_method ? { method: job.apply_method, contact: job.apply_contact } : parseApply(job.description);
  const flags = [...new Set([...(job.flags || []), ...parseFlags(job.description || '', job.title)])];
  return {
    ...job,
    experience_min: exp?.min ?? null,
    experience_max: exp?.max ?? null,
    experience_inferred: !!exp?.inferred,
    salary_min: sal?.min ?? null,
    salary_max: sal?.max ?? null,
    location_type: job.location_type || (job.remote ? 'remote' : loc.type),
    city: job.city || loc.city,
    country: job.country || (PK_CITIES.includes(String(job.city || '').toLowerCase()) ? 'pk' : loc.country),
    employment_type: job.employment_type_norm || parseEmploymentType(job.description || '', job.title, job.employment_type),
    apply_method: apply?.method || job.apply_method || null,
    apply_contact: apply?.contact || job.apply_contact || null,
    flags,
  };
}
