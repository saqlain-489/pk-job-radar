// Runs inside the Maps page via page.evaluate, so it must stay self-contained.
// Copied from the lead scraper (src/phase1/extractListing.js); the list DOM has no phone/website.
export function extractFeedFn() {
  return () => {
    const feed = document.querySelector('div[role="feed"]');
    const scope = feed || document.body;
    const anchors = Array.from(scope.querySelectorAll('a.hfpxzc'));
    const out = [];
    for (const a of anchors) {
      const name = (a.getAttribute('aria-label') || '').trim();
      const mapsUrl = a.href || '';
      if (!name || !mapsUrl) continue;

      let category = '';
      let rating = 0;
      let reviewCount = 0;
      let priceLevel = '';
      const card = a.closest('div[jsaction]') || a.parentElement;
      if (card) {
        // The info lines use class W4Efsd; the category is the first token of the
        // line that isn't the rating and isn't the address.
        const lines = Array.from(card.querySelectorAll('.W4Efsd'))
          .map((el) => (el.innerText || '').trim())
          .filter(Boolean);
        for (const line of lines) {
          const first = line.split('\n')[0].split('·')[0].trim();
          if (!first) continue;
          if (/^\d/.test(first)) continue; // rating "4.6(1,234)" or a street number
          if (/^no reviews$/i.test(first)) continue;
          category = first;
          break;
        }

        // Rating + review count: prefer the accessible label ("4.6 stars 1,234 Reviews").
        const ratingEl = card.querySelector('[role="img"][aria-label*="star" i], [aria-label*="stars" i]');
        const label = ratingEl ? ratingEl.getAttribute('aria-label') || '' : '';
        const rl = label.match(/([\d.]+)\s*star/i);
        if (rl) rating = parseFloat(rl[1]);
        const cl = label.match(/([\d,]+)\s*review/i);
        if (cl) reviewCount = parseInt(cl[1].replace(/,/g, ''), 10);
        // Fallback: the "4.6(1,234)" text form.
        if (!rating) {
          const tm = (card.innerText || '').match(/([0-5]\.\d)\s*\(([\d,]+)\)/);
          if (tm) {
            rating = parseFloat(tm[1]);
            reviewCount = parseInt(tm[2].replace(/,/g, ''), 10);
          }
        }
        // Price level: a $..$$$$ token on the info line.
        const pm = (card.innerText || '').match(/(?:^|[·\s])(\${1,4})(?:[·\s]|$)/);
        if (pm) priceLevel = pm[1];
      }
      out.push({ name, mapsUrl, category, rating, reviewCount, priceLevel });
    }
    return out;
  };
}
