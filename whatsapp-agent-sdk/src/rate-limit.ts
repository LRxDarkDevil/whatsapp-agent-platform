import { RATE_LIMITS, type RateLimitKey } from "./limits.js";

const WINDOW_MS = 60_000;

export class SlidingWindowRateLimiter {
  private readonly calls = new Map<RateLimitKey, number[]>();

  async acquire(key: RateLimitKey): Promise<void> {
    const limit = RATE_LIMITS[key];

    while (true) {
      const now = Date.now();
      const cutoff = now - WINDOW_MS;
      const history = (this.calls.get(key) ?? []).filter((time) => time > cutoff);

      if (history.length < limit) {
        history.push(now);
        this.calls.set(key, history);
        return;
      }

      const oldest = history[0] ?? now;
      const waitMs = Math.max(1, oldest + WINDOW_MS - now + 5);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

