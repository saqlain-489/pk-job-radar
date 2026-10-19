import { execFile } from 'node:child_process';
import { config } from '../config.js';
import { DEFAULT_UA } from './ua.js';
import { sleep } from './throttle.js';

const HEADERS = {
  'user-agent': DEFAULT_UA,
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
};

const hostChains = new Map();

// Serialises requests per host with a gap, so we never hammer one company's site.
function politely(url, fn) {
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    return fn();
  }
  const prev = hostChains.get(host) || Promise.resolve();
  const next = prev.then(fn, fn);
  const gap = next.catch(() => {}).then(() => sleep(config.perHostDelayMs));
  hostChains.set(host, gap);
  return next;
}

export let requestCount = 0;

async function rawFetch(url, { accept, timeoutMs = config.fetchTimeoutMs } = {}) {
  requestCount += 1;
  const res = await fetch(url, {
    headers: accept ? { ...HEADERS, accept } : HEADERS,
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await res.text();
  return { ok: res.ok, status: res.status, url: res.url || url, body, via: 'fetch' };
}

// Some hosts refuse Node's TLS fingerprint outright; curl gets through (lesson from the lead scraper).
function curlFetch(url, { timeoutMs = config.fetchTimeoutMs } = {}) {
  requestCount += 1;
  return new Promise((resolve) => {
    execFile(
      'curl',
      ['-sL', '--compressed', '-m', String(Math.ceil(timeoutMs / 1000)), '-A', DEFAULT_UA, '-w', '\n__STATUS__%{http_code} %{url_effective}', url],
      { maxBuffer: 20 * 1024 * 1024 },
      (err, stdout) => {
        if (err && !stdout) return resolve({ ok: false, status: 0, url, body: '', error: err.message, via: 'curl' });
        const i = stdout.lastIndexOf('\n__STATUS__');
        const [code, ...rest] = stdout.slice(i + 11).split(' ');
        const status = Number(code) || 0;
        resolve({ ok: status >= 200 && status < 400, status, url: rest.join(' ') || url, body: stdout.slice(0, i), via: 'curl' });
      }
    );
  });
}

export function fetchPage(url, opts = {}) {
  return politely(url, async () => {
    try {
      return await rawFetch(url, opts);
    } catch (e) {
      if (opts.noCurl) return { ok: false, status: 0, url, body: '', error: e.message, via: 'fetch' };
      return curlFetch(url, opts);
    }
  });
}

export async function fetchJson(url, opts = {}) {
  const r = await fetchPage(url, { accept: 'application/json', ...opts });
  if (!r.ok) return { ...r, json: null };
  try {
    return { ...r, json: JSON.parse(r.body) };
  } catch {
    return { ...r, ok: false, json: null, error: 'invalid json' };
  }
}

// Homepage probe: https first, then http (Maps often stores http:// for https sites).
export async function fetchHomepage(website) {
  const bare = website.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  let last;
  for (const proto of ['https://', 'http://']) {
    last = await fetchPage(proto + bare);
    if (last.ok && last.body) return last;
  }
  return last;
}

export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}
