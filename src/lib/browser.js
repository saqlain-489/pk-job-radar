import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { config, DATA_DIR } from '../config.js';
import { DEFAULT_UA } from './ua.js';
import { sleep } from './throttle.js';
import { assertNotBlocked, acceptConsentIfPresent, BlockedError } from './guard.js';

puppeteer.use(StealthPlugin());

const PROFILE_DIR = path.join(DATA_DIR, 'profile');
const LAUNCH_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1280,900'];

export async function launchMapsBrowser() {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) fs.rmSync(path.join(PROFILE_DIR, f), { force: true });
  return puppeteer.launch({
    headless: config.headless,
    userDataDir: PROFILE_DIR,
    args: LAUNCH_ARGS,
    defaultViewport: { width: 1280, height: 900 },
  });
}

export async function safeGoto(page, url) {
  for (let attempt = 0; attempt <= config.navRetries; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await acceptConsentIfPresent(page);
      await assertNotBlocked(page);
      return true;
    } catch (e) {
      if (e instanceof BlockedError) throw e;
      if (attempt === config.navRetries) return false;
      await sleep(3000 * (attempt + 1));
    }
  }
  return false;
}

let renderBrowser;
export let renderCount = 0;

// JS-render fallback for company sites whose content only appears after scripts run.
// patient: for job lists that load late — scroll, press "load more", and wait until the text stops growing.
export async function renderPage(url, { patient = false } = {}) {
  if (!renderBrowser) renderBrowser = await puppeteer.launch({ headless: true, args: LAUNCH_ARGS });
  const page = await renderBrowser.newPage();
  renderCount += 1;
  try {
    await page.setUserAgent(DEFAULT_UA);
    await page.setRequestInterception(true);
    page.on('request', (r) => (['image', 'media', 'font', 'stylesheet'].includes(r.resourceType()) ? r.abort() : r.continue()));
    const res = await page.goto(url, { waitUntil: 'networkidle2', timeout: config.renderTimeoutMs }).catch(() => null);
    await sleep(1200);
    if (patient) await waitForListing(page);
    const html = await page.content();
    const errorPage = page.url().startsWith('chrome-error:');
    // A networkidle timeout leaves no response object even though the page rendered fine.
    const status = res?.status() || (!errorPage && html.length > 3000 ? 200 : 0);
    const ok = !!html && status > 0 && status < 400 && !errorPage;
    return { ok, status, url: page.url(), body: ok ? html : '', via: 'render', error: ok ? undefined : `render HTTP ${status}` };
  } catch (e) {
    return { ok: false, status: 0, url, body: '', error: e.message, via: 'render' };
  } finally {
    await page.close().catch(() => {});
  }
}

async function waitForListing(page) {
  let last = -1;
  let stable = 0;
  for (let i = 0; i < 12 && stable < 2; i++) {
    const len = await page
      .evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
        const more = [...document.querySelectorAll('button, a')].find((b) => /^(load|show|view) more( jobs| positions| openings)?$/i.test((b.innerText || '').trim()));
        if (more) more.click();
        return (document.body.innerText || '').length;
      })
      .catch(() => last);
    stable = len === last ? stable + 1 : 0;
    last = len;
    await sleep(1500);
  }
}

export async function closeRenderBrowser() {
  if (renderBrowser) await renderBrowser.close().catch(() => {});
  renderBrowser = undefined;
}
