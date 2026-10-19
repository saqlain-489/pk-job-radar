// Deterministic 0–100 fit score with reasons. Never a hard filter: low scores still show, sorted down.

// Titles with "engineer"/"developer" that are sales, support or account work, not building software.
// Teaching jobs ("Full Stack Development Instructor") name a stack but don't build software.
const TEACHING = /\b(instructor|trainer|teacher|lecturer|tutor|faculty|mentor)\b/i;

const NOT_BUILDING = /\b(sales|support|solutions?|customer|account|implementation|pre-?sales|field|onboarding|success)\s+(engineer|developer|consultant)\b|\bbusiness\s+developer\b|\btechnical\s+(support|account)\b|\baccount\s+(executive|manager)\b|\b(sdr|bdr)\b|\bsales\b/i;

const ROLE_RULES = [
  { re: /\b(non[- ]?tech|sales|business development|bd[ae]?|marketing|seo|social media|content|copywriter|graphic|ui\/?ux designer|designer|hr|human resources|recruit|talent acquisition|accountant|finance|admin(istrat)|customer support|customer service|call center|csr|office boy|receptionist|project manager|product owner|scrum master|bidder|lead generation)\b/i, pts: 0, why: 'not an engineering role' },
  { re: /\b(ai|genai|gen ai|generative ai|llm|agentic|ml|machine learning)\b.*\b(engineer|developer)\b|\b(ai|llm)\s+(engineer|developer)/i, pts: 30, why: 'AI / GenAI engineering role' },
  { re: /\b(full[- ]?stack|mern|mean)\b/i, pts: 30, why: 'full-stack role' },
  { re: /\b(node(\.?js)?|next(\.?js)?|react(\.?js)?|typescript|javascript)\b/i, pts: 28, why: 'JS/TS stack role' },
  { re: /\b(network|system administrator|sysadmin|embedded|firmware|hardware|electrical|electronics|mechanical|civil|cyber ?security|information security|infosec|soc|noc|it support|help ?desk|configuration|telecom|rf)\b/i, pts: 5, why: 'different engineering field (not web/AI)' },
  { re: /\breact native\b/i, pts: 19, why: 'React Native (adjacent)' },
  { re: /\bpython\b|\bdjango\b|\bfastapi\b/i, pts: 16, why: 'Python role (secondary skill)' },
  { re: /\bdata (engineer|scientist)\b|\bml ops\b|\bmlops\b/i, pts: 12, why: 'data role (partial match)' },
  { re: /\bdevops\b|\bsre\b|\bcloud engineer\b/i, pts: 10, why: 'DevOps role (partial match)' },
  { re: /\b(flutter|android|ios|swift|kotlin|mobile)\b/i, pts: 8, why: 'mobile role (off-stack)' },
  { re: /\b(php|laravel|wordpress|\.net|asp\.net|c#|java\b|spring|ruby|rails|ror|golang|go developer|shopify|magento|salesforce|odoo|sap|oracle)\b/i, pts: 7, why: 'off-stack role' },
  { re: /\b(qa|sqa|quality assurance|tester|test engineer|automation)\b/i, pts: 7, why: 'QA role' },
  { re: /\b(software|backend|back[- ]end|frontend|front[- ]end|web|application)\s+(engineer|developer)\b|\bsoftware engineer|\bsde\b|\bswe\b/i, pts: 24, why: 'general software engineering role' },
  { re: /\b(engineer|developer|programmer)\b/i, pts: 18, why: 'engineering role (stack unclear)' },
];

const ENG_WORD = /\b(engineer|developer|programmer|devops|sde|swe|architect|full[- ]?stack|mern)\b/i;

export function roleScore(title) {
  const t = String(title || '');
  if (NOT_BUILDING.test(t)) return { pts: 0, why: 'sales / support role, not building software' };
  if (TEACHING.test(t)) return { pts: 0, why: 'teaching / training role, not building software' };
  for (const [i, r] of ROLE_RULES.entries()) {
    if (i === 0 && ENG_WORD.test(t)) continue;
    if (r.re.test(t)) return { pts: r.pts, why: r.why };
  }
  return { pts: 5, why: 'role unclear from title' };
}

export function experienceScore(min, max, inferred) {
  const tag = inferred ? ' (from title)' : '';
  if (min == null) return { pts: 15, why: 'experience not stated' };
  const range = max != null && max !== min ? `${min}–${max}` : `${min}${max == null ? '+' : ''}`;
  if (min >= 5) return { pts: 0, why: `asks ${range} years${tag}: too senior`, skip: true };
  if (min > 3) return { pts: 10, why: `asks ${range} years${tag}: big stretch` };
  if (min === 3) return { pts: 16, why: `asks ${range} years${tag}: stretch` };
  if (min >= 1.5 || (max != null && max >= 2)) return { pts: 25, why: `asks ${range} years${tag}: match` };
  if (min >= 1) return { pts: 21, why: `asks ${range} years${tag}: under your level, fine` };
  return { pts: 12, why: `asks ${range} years${tag}: junior / fresher level` };
}

export function stackScore(text, profile) {
  const s = String(text || '').toLowerCase();
  const hit = (k) => {
    const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\.js$/, '(\\.?js)?');
    return new RegExp(`(^|[^a-z])${esc}([^a-z]|$)`, 'i').test(s);
  };
  const core = profile.skills.core.filter(hit);
  const ai = profile.skills.ai.filter(hit);
  const sec = profile.skills.secondary.filter(hit);
  if (!core.length && !ai.length && !sec.length) return { pts: 8, why: 'no stack listed', hits: [] };
  const pts = Math.min(20, core.length * 4 + Math.min(ai.length, 2) * 5 + Math.min(sec.length, 3));
  const hits = [...core, ...ai, ...sec];
  return { pts, why: `stack overlap: ${hits.slice(0, 6).join(', ')}`, hits };
}

export function locationScore(job, company, home = 'faisalabad') {
  const city = (job.city || '').toLowerCase();
  if (job.country === 'foreign') return { pts: 0, why: `based outside Pakistan${job.location_text ? ` (${job.location_text})` : ''}`, abroad: true };
  if (job.location_type === 'remote') return { pts: 20, why: 'remote' };
  const where = city || (company?.city || '').toLowerCase();
  // Home city (he lives there, no move) ranks just above Lahore, but never above remote or hybrid.
  if (job.location_type === 'hybrid') {
    if (where === home) return { pts: 17, why: `hybrid in ${where} (home city)` };
    if (!where || where === 'lahore') return { pts: 16, why: `hybrid${where ? ' Lahore' : ''}` };
    return { pts: 0, why: `hybrid in ${where}: would need to move there`, relocate: true };
  }
  const assumed = job.location_type ? '' : ' (assumed)';
  if (where === home) return { pts: 14, why: `on-site ${where}${assumed}: home city, no move needed` };
  if (where === 'lahore') return { pts: 12, why: `on-site Lahore${assumed}` };
  if (where) return { pts: 0, why: `on-site ${where}${assumed}: would need to move there`, relocate: true };
  return { pts: 8, why: 'location not stated' };
}

export function companyScore(company) {
  if (!company) return { pts: 0, why: null };
  let pts = 0;
  const bits = [];
  if (company.kind === 'product') {
    pts += 3;
    bits.push('product company');
  } else if (company.kind === 'mixed') {
    pts += 2;
    bits.push('product + services');
  }
  if (company.foreign_clients) {
    pts += 2;
    bits.push('foreign clients');
  }
  return { pts: Math.min(5, pts), why: bits.length ? bits.join(', ') : null };
}

const DAY = 86400000;

export function postedDate(s) {
  if (!s) return null;
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T12:00:00Z` : s);
  return Number.isFinite(t) ? t : null;
}

// Fresh posts get answered; month-old ones rarely do. posted_source 'first_seen' means the job
// appeared on a page we were already watching, so that day is a safe upper bound on its age.
export function ageScore(job, now = Date.now()) {
  const t = postedDate(job.posted_at);
  if (t === null) return { pts: 0, why: 'post date unknown', days: null };
  const days = Math.max(0, Math.floor((now - t) / DAY));
  const label = days === 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`;
  const how = job.posted_source === 'first_seen' ? 'appeared' : 'posted';
  if (days <= 3) return { pts: 5, why: `fresh: ${how} ${label}`, days };
  if (days <= 7) return { pts: 0, why: `${how} ${label}`, days };
  if (days <= 14) return { pts: -10, why: `${how} ${label}: getting old`, days };
  if (days <= 30) return { pts: -25, why: `${how} ${label}: probably filled`, days, flag: 'old post' };
  return { pts: -40, why: `${how} ${label}: likely stale`, days, flag: 'stale post (30+ days)' };
}

// job: enriched job (see jobText.enrichJob). company: companies row. profile: config/profile.local.json (or profile.example.json).
export function scoreJob(job, company, profile, now = Date.now()) {
  const reasons = [];
  const flags = [...(job.flags || [])];
  const add = (r) => r.why && reasons.push(r.why);

  const role = roleScore(job.title);
  const exp = experienceScore(job.experience_min, job.experience_max, job.experience_inferred);
  const stack = stackScore(`${job.title}\n${job.description || ''}\n${(job.skills || []).join(' ')}`, profile);
  const loc = locationScore(job, company, String(profile.home_city || '').toLowerCase());
  const comp = companyScore(company);
  const age = ageScore(job, now);
  [role, exp, stack, loc, comp, age].forEach(add);
  let score = role.pts + exp.pts + stack.pts + loc.pts + comp.pts + age.pts;
  if (age.flag) flags.push(age.flag);

  if (job.salary_max != null) {
    if (job.salary_max < profile.pay_floor_pkr) {
      score -= 35;
      reasons.push(`salary PKR ${job.salary_max.toLocaleString('en-US')} is below the 100k floor`);
      flags.push('below pay floor');
    } else {
      score += 5;
      reasons.push(`salary listed: PKR ${job.salary_min.toLocaleString('en-US')}${job.salary_max !== job.salary_min ? `–${job.salary_max.toLocaleString('en-US')}` : ''}`);
    }
  }
  const penalties = { 'service bond': 15, contract: 5, internship: 30, unpaid: 50, 'freshers only': 20, 'women only': 40, 'part-time': 10 };
  for (const f of flags) if (penalties[f]) score -= penalties[f];
  if (role.pts === 0) score = Math.min(score, 10);
  else if (role.pts <= 5) score = Math.min(score, 45);
  else if (role.pts <= 10) score = Math.min(score, 50);
  if (loc.relocate) score -= 5;
  if (exp.skip) {
    score = Math.min(score, 25);
    flags.push('5+ years');
  }
  if (loc.abroad) {
    score = Math.min(score, 10);
    flags.push('outside Pakistan');
  }
  const closes = postedDate(job.closes_at);
  if (closes !== null && closes >= now) {
    const left = Math.ceil((closes - now) / DAY);
    if (left <= 5) reasons.push(`apply soon: closes in ${left} day${left === 1 ? '' : 's'}`);
  }
  if (job.apply_method === 'whatsapp' || job.apply_method === 'email') reasons.push(`apply directly via ${job.apply_method}${job.apply_contact ? ` (${job.apply_contact})` : ''}`);
  if (company?.contacted) flags.push('already contacted');
  return { score: Math.max(0, Math.min(100, Math.round(score))), reasons, flags: [...new Set(flags)] };
}
