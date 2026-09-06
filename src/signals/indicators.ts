import type { Candle, Market } from "../types.js";
import { marketDate } from "../toss/rest-client.js";

/**
 * Simple moving average over the last `period` *completed* daily candles as
 * of `quoteTimestamp`. Candles whose trading date is on or after the quote's
 * trading date are treated as "today, still in progress" and excluded so the
 * average never leaks the current session's own (partial) close into itself.
 *
 * Returns `undefined` when there are fewer than `period` completed candles.
 */
export function movingAverage(
  candles: readonly Candle[],
  period: number,
  quoteTimestamp: string | null | undefined,
  market?: Market,
): number | undefined {
  if (candles.length === 0 || period <= 0) return undefined;

  const sorted = [...candles].sort((a, b) =>
    b.timestamp.localeCompare(a.timestamp),
  );

  const quoteDate = quoteTimestamp
    ? marketDate(quoteTimestamp, market)
    : undefined;

  const completed = quoteDate
    ? sorted.filter((candle) => marketDate(candle.timestamp, market) < quoteDate)
    : sorted;

  if (completed.length < period) return undefined;

  const window = completed.slice(0, period);
  let sum = 0;
  for (const candle of window) {
    const close = Number(candle.closePrice);
    if (!Number.isFinite(close)) return undefined;
    sum += close;
  }
  return sum / period;
}

/**
 * Identifies a "session" for signal arming/dedupe purposes: the trading date
 * of the quote combined with the reference (previous close) price. When
 * either changes — a new trading day, or the reference price is revised —
 * the detector resets and re-arms instead of firing stale signals.
 */
export function signalSessionKey(
  referencePrice: string,
  quoteTimestamp: string,
  market?: Market,
): string {
  return `${marketDate(quoteTimestamp, market)}:${referencePrice}`;
}
