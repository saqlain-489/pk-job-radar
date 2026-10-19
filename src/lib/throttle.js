export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Randomized human-like delay between min and max (ms).
export function randomDelay(minMs, maxMs) {
  const lo = Math.min(minMs, maxMs);
  const hi = Math.max(minMs, maxMs);
  const ms = lo + Math.random() * (hi - lo);
  return sleep(ms);
}

// Jitter a base delay by +/- fraction (default 40%).
export function jitter(baseMs, fraction = 0.4) {
  const delta = baseMs * fraction;
  const ms = baseMs - delta + Math.random() * (2 * delta);
  return sleep(Math.max(0, ms));
}
