// Adapted from the lead scraper for Pakistani phones and addresses.
// Parse Google Maps' internal search-results payload (the /search?tbm=map
// response) to pull phone / website / address WITHOUT opening each business.
//
// The payload is a `)]}'`-prefixed, deeply-nested protobuf-style JSON array. We
// JSON-parse it, then FLATTEN it to the ordered list of its string values. Each
// business's fields cluster around its CID (place identity) in that stream —
// website just before the CID, name/address just after — so we anchor on each
// CID and read fields from a window bounded by the neighbouring businesses' CIDs.
// This is index-free: it survives Google reshuffling array positions, and unlike
// tree-node isolation it doesn't drop a business just because its block happens to
// reference a second CID (a "located-in" parent, a related place, etc.).

const CID_RE = /0x[0-9a-f]+:0x[0-9a-f]+/i;
const BAD_HOST =
  /^https?:\/\/(?:[a-z0-9-]+\.)*(?:google|gstatic|ggpht|googleusercontent|googleapis|schema\.org|g\.co|goo\.gl|youtube|ytimg|gvt1|googleadservices)/i;

// Flatten a parsed payload into its string values, in document order.
function flattenStrings(node, out) {
  if (typeof node === 'string') out.push(node);
  else if (Array.isArray(node)) for (const c of node) flattenStrings(c, out);
}

export function pickWebsite(strings) {
  // Website sits just before the CID, so scan from the end (closest to it) and
  // take the first real http(s) URL that isn't a Google/asset host.
  for (let i = strings.length - 1; i >= 0; i--) {
    const s = strings[i].trim();
    if (/^https?:\/\//i.test(s) && !BAD_HOST.test(s)) return s.split(/[?#]/)[0];
  }
  return '';
}

// Pakistani numbers: 0300 1234567, 042-35714444, (042) 3571 4444, +92 300 1234567, UAN 111-222-333.
export function pickPhone(strings) {
  for (const s of strings) {
    const t = s.trim();
    if (t.length > 24 || !/^[+(\d][\d\s()+-]+$/.test(t)) continue;
    const d = t.replace(/\D/g, '');
    if (/^92\d{9,10}$/.test(d) || /^0\d{9,10}$/.test(d) || /^111\d{6}$/.test(d)) return t;
  }
  return '';
}

const PK_PLACE = /\b(lahore|karachi|islamabad|rawalpindi|faisalabad|multan|peshawar|gujranwala|sialkot|hyderabad|quetta|punjab|sindh|pakistan)\b/i;

export function pickAddress(strings) {
  let best = '';
  let bestScore = -1;
  for (const s of strings) {
    const t = s.trim();
    if (t.length > 200 || t.length < 8 || !/,/.test(t) || !PK_PLACE.test(t) || /^https?:/i.test(t)) continue;
    const score = (/\d/.test(t) ? 500 : 0) + (/\b(road|rd|block|street|st|plaza|tower|floor|phase|sector|town|avenue|park)\b/i.test(t) ? 300 : 0) + t.length;
    if (score > bestScore) {
      best = t;
      bestScore = score;
    }
  }
  return best;
}

// Strip the `)]}'` guard and parse the array. Returns null on failure.
function parseArray(str) {
  const cleaned = String(str).replace(/^\)\]\}'\s*/, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    const i = cleaned.indexOf('[');
    if (i < 0) return null;
    try {
      return JSON.parse(cleaned.slice(i));
    } catch {
      return null;
    }
  }
}

// A single /search response is either the raw guarded array (first page) OR one/
// more wrapper frames `{"c":0,"d":"<escaped real payload>", ...}` (pagination).
// We pull each `d` string directly with a JSON-string regex (the outer object can
// be truncated, so we don't rely on it parsing) and unescape+parse it, so no page
// is ever silently dropped. Returns every parsed payload root.
function payloadRoots(raw) {
  const s = String(raw);
  if (s.trimStart().startsWith('{')) {
    const roots = [];
    const re = /"d":"((?:[^"\\]|\\.)*)"/g;
    let m;
    while ((m = re.exec(s)) !== null) {
      let inner;
      try {
        inner = JSON.parse('"' + m[1] + '"');
      } catch {
        continue;
      }
      const arr = parseArray(inner);
      if (arr) roots.push(arr);
    }
    if (roots.length) return roots;
  }
  const root = parseArray(s);
  return root ? [root] : [];
}

function parseOne(raw, map) {
  const strings = [];
  for (const root of payloadRoots(raw)) flattenStrings(root, strings);
  if (!strings.length) return;

  // Index each string that carries a CID; group into per-CID clusters (a business
  // repeats its own CID a few times: place-id, share URL, etc.).
  const clusterByCid = new Map();
  for (let i = 0; i < strings.length; i++) {
    const m = strings[i].match(CID_RE);
    if (!m) continue;
    const cid = m[0].toLowerCase();
    const c = clusterByCid.get(cid);
    if (c) c.last = i;
    else clusterByCid.set(cid, { first: i, last: i });
  }
  if (!clusterByCid.size) return;

  const clusters = [...clusterByCid.entries()]
    .map(([cid, r]) => ({ cid, ...r }))
    .sort((a, b) => a.first - b.first);

  for (let i = 0; i < clusters.length; i++) {
    const cur = clusters[i];
    if (map.has(cur.cid)) continue;
    const leftBound = i > 0 ? clusters[i - 1].last + 1 : 0;
    const rightBound = i < clusters.length - 1 ? clusters[i + 1].first : strings.length;
    const before = strings.slice(leftBound, cur.first);
    const after = strings.slice(cur.last + 1, rightBound);
    const block = strings.slice(leftBound, rightBound);
    map.set(cur.cid, {
      website: pickWebsite(before) || pickWebsite(after),
      phone: pickPhone(block),
      address: pickAddress(after) || pickAddress(block),
    });
  }
}

// -> Map<cidLowercase, { website, phone, address }>
export function parseSearchPayloads(texts) {
  const map = new Map();
  for (const raw of texts || []) {
    try {
      parseOne(raw, map);
    } catch {
      /* a single malformed payload never sinks the batch */
    }
  }
  return map;
}

// Extract the CID from a Maps place URL (the anchor href), matching payload keys.
export function cidFromUrl(mapsUrl) {
  const m = (mapsUrl || '').match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i);
  return m ? m[1].toLowerCase() : '';
}

