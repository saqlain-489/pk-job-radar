// Detection guard: spot the moment Google gets suspicious and halt BEFORE a
// soft warning escalates into a hard IP ban. This is the key IP-protector —
// the run stops cleanly (state is already checkpointed) so you can rotate your
// IP (power-cycle the router / phone hotspot) and resume with zero data loss.

export class BlockedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BlockedError';
  }
}

// Throw BlockedError if the current page looks like a CAPTCHA / "unusual
// traffic" / sorry interstitial. Safe to call after every navigation.
export async function assertNotBlocked(page) {
  const url = page.url() || '';
  if (/\/sorry\/|\/sorry\?|ipv4\.google|unusualtraffic/i.test(url)) {
    throw new BlockedError(`Google served a block page: ${url}`);
  }

  let signal = null;
  try {
    signal = await page.evaluate(() => {
      const text = (document.body && document.body.innerText) || '';
      const hit = /unusual traffic|not a robot|before you continue to google maps and detected|our systems have detected|verify (?:that )?you.?re (?:not a robot|human)|complete a security check/i.test(
        text
      );
      const captcha = !!document.querySelector(
        'iframe[src*="recaptcha"], iframe[title*="recaptcha" i], form#captcha-form, div#recaptcha'
      );
      return hit || captcha ? text.slice(0, 120) : null;
    });
  } catch {
    signal = null; // evaluate can fail on a hostile page; don't crash
  }
  if (signal) throw new BlockedError(`Google challenge detected: "${signal.trim()}"`);
}

// Some regions/sessions show a consent wall before Maps loads. Best-effort
// accept so the results feed can render. No-op when absent (typical for US).
export async function acceptConsentIfPresent(page) {
  const url = page.url() || '';
  if (!/consent\.google|consent\.youtube/i.test(url)) return;
  try {
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, [role="button"]'));
      const accept = btns.find((b) =>
        /accept all|i agree|agree to all|akzeptieren/i.test(b.innerText || '')
      );
      if (accept) accept.click();
    });
    await page.waitForNavigation({ timeout: 8000 }).catch(() => {});
  } catch {
    /* best effort */
  }
}
