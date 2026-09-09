import type {
  Candle,
  Market,
  QuoteView,
  Signal,
  StockInfo,
} from "../types.js";
import {
  createSignalMemory,
  type SignalInput,
  type SignalMemory,
} from "../signals/detector.js";
import { marketDate } from "../toss/rest-client.js";

/** Mutable data owned by one validated quote symbol. */
export interface QuoteState {
  readonly symbol: string;
  info?: StockInfo;
  lastPrice?: string;
  referencePrice?: string;
  highPrice?: string;
  lowPrice?: string;
  candles?: Candle[];
  sparkline?: number[];
  timestamp?: string | null;
  status: QuoteView["status"];
  message?: string;
  refreshing?: boolean;
  market?: Market;
  priceLimit?: { upper?: number; lower?: number; date: string };
  movingAverages?: SignalInput["movingAverages"];
  sessionDate?: string;
  pendingSessionDate?: string;
  sessionVersion?: number;
  subscriptionRejected?: boolean;
  subscriptionCapped?: boolean;
  readonly signalMemory: SignalMemory;
  activeSignal?: { signal: Signal; timer: ReturnType<typeof setTimeout> };
}

export function createQuoteState(symbol: string): QuoteState {
  return {
    symbol,
    status: "connecting",
    signalMemory: createSignalMemory(),
  };
}

export function numberOrUndefined(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function timestampMillis(
  value: string | null | undefined,
): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function sessionDateFor(
  timestamp: string | null | undefined,
  market: Market,
): string | undefined {
  return timestampMillis(timestamp) === undefined || !timestamp
    ? undefined
    : marketDate(timestamp, market);
}

export function acceptsPriceUpdate(
  currentTimestamp: string | null | undefined,
  incomingTimestamp: string | null | undefined,
  source: "rest" | "tick",
): boolean {
  const current = timestampMillis(currentTimestamp);
  const incoming = timestampMillis(incomingTimestamp);
  if (incoming === undefined) return current === undefined;
  if (current === undefined) return true;
  return source === "tick" ? incoming >= current : incoming > current;
}

/** Clears values tied to a trading day and starts accumulating the new range. */
export function beginQuoteSession(
  quote: QuoteState,
  sessionDate: string,
  initialPrice?: string,
): boolean {
  if (quote.sessionDate === sessionDate || quote.pendingSessionDate === sessionDate) {
    return false;
  }
  quote.sessionDate = undefined;
  quote.pendingSessionDate = sessionDate;
  quote.sessionVersion = (quote.sessionVersion ?? 0) + 1;
  quote.referencePrice = undefined;
  quote.priceLimit = undefined;
  quote.movingAverages = undefined;
  quote.candles = undefined;
  quote.sparkline = undefined;
  quote.highPrice = undefined;
  quote.lowPrice = undefined;
  if (quote.activeSignal) {
    clearTimeout(quote.activeSignal.timer);
    quote.activeSignal = undefined;
  }
  if (initialPrice !== undefined) mergeQuoteHighLow(quote, initialPrice, initialPrice);
  return true;
}

export function isQuoteSessionContextCurrent(
  quote: QuoteState,
  market: Market,
  sessionDate: string | undefined,
  sessionVersion: number | undefined,
): boolean {
  if (!sessionDate || quote.sessionVersion !== sessionVersion) return false;
  const currentDate = quote.pendingSessionDate ?? quote.sessionDate ??
    sessionDateFor(quote.timestamp, market);
  return currentDate === sessionDate;
}

export function mergeQuoteHighLow(
  quote: QuoteState,
  high: string | undefined,
  low: string | undefined,
): void {
  const highNumber = numberOrUndefined(high);
  if (highNumber !== undefined) {
    const currentHigh = numberOrUndefined(quote.highPrice);
    if (currentHigh === undefined || highNumber > currentHigh) quote.highPrice = high;
  }
  const lowNumber = numberOrUndefined(low);
  if (lowNumber !== undefined) {
    const currentLow = numberOrUndefined(quote.lowPrice);
    if (currentLow === undefined || lowNumber < currentLow) quote.lowPrice = low;
  }
}
