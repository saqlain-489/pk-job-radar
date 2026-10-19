const EDU = /training|institute|academy|school|college|university|tutor|coaching|educational|course/i;

const KEEP_CATEGORY =
  /software|web(site)? (designer|developer|development)|app(lication)? develop|it (services|company|consult)|information technology|computer (consultant|services|support)|game develop|data (center|analytics)|technology|telecommunications/i;

const MAYBE_CATEGORY = /internet marketing|digital marketing|marketing agency|e-?commerce service|business to business|corporate office|consultant|business center|business management/i;

const NOISE_CATEGORY =
  /computer (store|shop|repair|accessories)|repair|printing|print shop|printer|mobile (phone|repair)|cell phone|electronics|hardware|stationery|book ?store|coworking|co-working|real estate|travel|immigration|visa|recruit|employment agency|manpower|photograph|cctv|security system|solar|furniture|restaurant|cafe|hostel|hotel|clinic|hospital|pharmacy|bank|atm|mosque|store$|shop$|market$|car |auto |advertising agency|graphic designer|sign shop/i;

const NOISE_NAME = /\b(institute|academy|training|courses?|college|university|tuition|coaching)\b/i;
const WEAK_NOISE_NAME =
  /\b(school|printing|printers|repair|mobiles|mobile (?:shop|repair|accessories|zone|cent(?:er|re))|cctv|solar|travels?|visa|hostel|kitchen|store|traders|enterprises)\b/i;

const SOFTWARE_NAME = /(soft|software|solution|technolog|tech|labs?\b|systems|digital|\bdev|apps?\b|\bit\b|cloud|\bai\b|data|logix|\bsol\b|code|web|\bio\b)/i;

// Card text leaks hours, phones and "No reviews" into the category line.
export function cleanCategory(raw) {
  const first = String(raw || '').split('\n')[0].split('·')[0].trim();
  if (!first || /^(no reviews|open|closed|closes|opens|temporarily closed|permanently closed)\b/i.test(first) || /^[+\d(]/.test(first)) return '';
  return first;
}

// Maps is noisy: training institutes, repair shops and print shops all show up for "software house".
// Returns keep | unsure | noise with the reason; unsure rows still go to discovery.
export function classifyPlace({ name = '', category: rawCategory = '' }) {
  const category = cleanCategory(rawCategory);
  if (NOISE_NAME.test(name)) return { verdict: 'noise', reason: `name has "${name.match(NOISE_NAME)[0]}"` };
  if (category && EDU.test(category)) return { verdict: 'noise', reason: `category "${category}"` };
  if (category && NOISE_CATEGORY.test(category) && !/software/i.test(category)) return { verdict: 'noise', reason: `category "${category}"` };
  if (category && KEEP_CATEGORY.test(category)) return { verdict: 'keep', reason: `category "${category}"` };
  if (WEAK_NOISE_NAME.test(name)) return { verdict: 'noise', reason: `name has "${name.match(WEAK_NOISE_NAME)[0]}"` };
  if (category && MAYBE_CATEGORY.test(category)) return { verdict: 'unsure', reason: `category "${category}"` };
  if (SOFTWARE_NAME.test(name)) return { verdict: 'unsure', reason: category ? `category "${category}", name sounds tech` : 'no category, name sounds tech' };
  if (!category) return { verdict: 'unsure', reason: 'no category; came from a software search' };
  return { verdict: 'noise', reason: `category "${category}" not tech` };
}
