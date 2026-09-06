import type { JsonObject } from "@elgato/utils";

export type Market = "KR" | "US";
export type RenderMode = "realtime" | "economy";
export type KeyBehavior = "refresh" | "open" | "toggle-view" | "none";
export type ColorTheme = "kr" | "global";
export type ViewMode = "chart" | "detail";

export type GlobalSettingsV1 = JsonObject & {
  schemaVersion: 1;
  clientId: string;
  clientSecret: string;
  renderMode: RenderMode;
  signalDurationSec: number;
};

export type SignalKind =
  | "rate-up"
  | "rate-down"
  | "upper-limit"
  | "lower-limit"
  | "ma-break-up"
  | "ma-break-down";
export type SignalSentiment = "bullish" | "bearish";

export interface Signal {
  readonly kind: SignalKind;
  readonly label: string;
  readonly sentiment: SignalSentiment;
  readonly price: string;
  readonly at: string;
}

export interface PriceLimit {
  readonly timestamp: string | null;
  readonly upperLimitPrice?: string;
  readonly lowerLimitPrice?: string;
  readonly currency: string;
}

export type QuoteActionSettingsV1 = JsonObject & {
  schemaVersion: 1;
  symbol: string;
  name: string;
  market?: Market;
  currency: string;
  keyBehavior: KeyBehavior;
  colorTheme?: ColorTheme;
  showChart?: boolean;
  viewMode?: ViewMode;
  showCurrencySymbol?: boolean;
};

export interface StockInfo {
  readonly symbol: string;
  readonly name: string;
  readonly englishName?: string;
  readonly market: string;
  readonly currency: string;
  readonly status?: string;
}

export interface PriceQuote {
  readonly symbol: string;
  readonly timestamp: string | null;
  readonly lastPrice: string;
  readonly currency: string;
}

export interface Candle {
  readonly timestamp: string;
  readonly openPrice?: string;
  readonly highPrice?: string;
  readonly lowPrice?: string;
  readonly closePrice: string;
  readonly volume?: string;
  readonly currency?: string;
}

export type QuoteStatus =
  | "auth-required"
  | "connecting"
  | "ready"
  | "invalid-symbol"
  | "no-data"
  | "stale";

export interface QuoteView {
  readonly symbol: string;
  readonly name: string;
  readonly market?: Market;
  readonly currency: string;
  readonly lastPrice?: string;
  readonly referencePrice?: string;
  readonly highPrice?: string;
  readonly lowPrice?: string;
  readonly timestamp?: string | null;
  readonly status: QuoteStatus;
  readonly message?: string;
  readonly colorTheme?: ColorTheme;
  readonly showChart?: boolean;
  readonly viewMode?: ViewMode;
  readonly showCurrencySymbol?: boolean;
  readonly sparkline?: readonly number[];
  readonly refreshing?: boolean;
  /** True while the trade WebSocket is connected; false means REST fallback only. */
  readonly live?: boolean;
  readonly signal?: Signal;
}

export interface TradeTick {
  readonly symbol: string;
  readonly market: Market;
  readonly price: string;
  readonly timestamp: string;
  readonly currency: string;
}
