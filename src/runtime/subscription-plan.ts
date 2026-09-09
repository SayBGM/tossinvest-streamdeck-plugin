import type { Market, QuoteActionSettingsV1, StockInfo } from "../types.js";

export const MAX_REALTIME_SYMBOLS = 100;

export interface SubscriptionBinding {
  readonly settings: QuoteActionSettingsV1;
}

export interface SubscriptionQuote {
  readonly info?: StockInfo;
}

export interface SubscriptionPlan {
  readonly entries: ReadonlyArray<readonly [string, Market]>;
  readonly cappedSymbols: ReadonlySet<string>;
}

/**
 * Preserves key order, deduplicates symbols, and admits only REST-validated
 * metadata. Every overflow symbol is returned so its keys can explain the
 * REST-only fallback instead of silently losing live updates.
 */
export function planSubscriptions(
  bindings: Iterable<SubscriptionBinding>,
  quotes: ReadonlyMap<string, SubscriptionQuote>,
  marketFor: (stock: StockInfo) => Market,
  maxSymbols = MAX_REALTIME_SYMBOLS,
): SubscriptionPlan {
  const entries: Array<readonly [string, Market]> = [];
  const cappedSymbols = new Set<string>();
  const seen = new Set<string>();
  for (const binding of bindings) {
    const symbol = binding.settings.symbol;
    if (!symbol || seen.has(symbol)) continue;
    const info = quotes.get(symbol)?.info;
    if (!info || info.symbol.toUpperCase() !== symbol.toUpperCase()) continue;
    let market: Market;
    try {
      market = marketFor(info);
    } catch {
      continue;
    }
    seen.add(symbol);
    if (entries.length < maxSymbols) entries.push([symbol, market]);
    else cappedSymbols.add(symbol);
  }
  return { entries, cappedSymbols };
}
