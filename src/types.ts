import type { JsonObject } from "@elgato/utils";

export type Market = "KR" | "US";
export type RenderMode = "realtime" | "economy";
export type KeyBehavior = "refresh" | "open" | "none";

export type GlobalSettingsV1 = JsonObject & {
  schemaVersion: 1;
  clientId: string;
  clientSecret: string;
  renderMode: RenderMode;
};

export type QuoteActionSettingsV1 = JsonObject & {
  schemaVersion: 1;
  symbol: string;
  name: string;
  market?: Market;
  currency: string;
  keyBehavior: KeyBehavior;
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
  readonly closePrice: string;
  readonly currency: string;
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
  readonly timestamp?: string | null;
  readonly status: QuoteStatus;
  readonly message?: string;
}

export interface TradeTick {
  readonly symbol: string;
  readonly market: Market;
  readonly price: string;
  readonly timestamp: string;
  readonly currency: string;
}
