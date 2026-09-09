import type {
  Candle,
  PriceLimit,
  PriceQuote,
  StockInfo,
} from "../types.js";
import { normalizeSymbol } from "../settings.js";
import { TossError } from "./errors.js";

type RecordValue = Record<string, unknown>;

function objectValue(value: unknown): RecordValue | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as RecordValue)
    : undefined;
}

function invalidResponse(): TossError {
  return new TossError("API", "API response is invalid", true);
}

function requiredString(
  source: RecordValue,
  key: string,
  options: { nonEmpty?: boolean; maxLength?: number } = {},
): string | undefined {
  const value = source[key];
  if (typeof value !== "string") return undefined;
  if (options.nonEmpty !== false && value.length === 0) return undefined;
  if (options.maxLength !== undefined && value.length > options.maxLength) {
    return undefined;
  }
  return value;
}

function decimalString(source: RecordValue, key: string): string | undefined {
  const value = requiredString(source, key, { maxLength: 30 });
  // OpenAPI decimal values are strings. Market values are non-negative in
  // this plugin; rejecting signs also prevents NaN/Infinity-like input from
  // being accepted by Number() downstream. Zero is valid.
  return isPriceText(value) ? value : undefined;
}

export function isPriceText(value: unknown): value is string {
  return typeof value === "string" && value.length <= 30 &&
    /^(?:0|[0-9]+(?:\.[0-9]+)?)$/.test(value) &&
    Number.isFinite(Number(value)) && Number(value) >= 0;
}

function dateTime(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  // The API uses RFC 3339 date-time values with an explicit offset or Z.
  if (!value.includes("T") || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return undefined;
  }
  return Number.isFinite(Date.parse(value)) ? value : undefined;
}

function currency(value: unknown): string | undefined {
  // The schema currently enumerates KRW/USD and explicitly asks clients to
  // tolerate unknown enum values, so validate the value's string shape while
  // leaving market support decisions to the runtime.
  return typeof value === "string" && /^[A-Z]{3}$/.test(value)
    ? value
    : undefined;
}

function symbol(value: unknown): string | undefined {
  const normalized = normalizeSymbol(value);
  return normalized || undefined;
}

function matchesRequested(
  value: string,
  requested: ReadonlySet<string> | undefined,
): boolean {
  return requested === undefined || requested.has(value);
}

function requestedSymbols(symbols: readonly string[]): ReadonlySet<string> {
  return new Set(symbols.map((value) => normalizeSymbol(value)).filter(Boolean));
}

function parseStock(value: unknown): StockInfo | undefined {
  const source = objectValue(value);
  if (!source) return undefined;

  const parsedSymbol = symbol(source.symbol);
  const name = requiredString(source, "name");
  const market = requiredString(source, "market");
  const parsedCurrency = currency(source.currency);
  if (
    parsedSymbol === undefined ||
    name === undefined ||
    market === undefined ||
    parsedCurrency === undefined
  ) {
    return undefined;
  }

  // The plugin consumes only this narrow subset. Other StockInfo fields are
  // allowed to evolve, and are intentionally not required here.
  return {
    symbol: parsedSymbol,
    name,
    market,
    currency: parsedCurrency,
    ...(typeof source.englishName === "string"
      ? { englishName: source.englishName }
      : {}),
    ...(typeof source.status === "string" ? { status: source.status } : {}),
  };
}

function parsePrice(value: unknown): PriceQuote | undefined {
  const source = objectValue(value);
  if (!source) return undefined;
  const parsedSymbol = symbol(source.symbol);
  const lastPrice = decimalString(source, "lastPrice");
  const parsedCurrency = currency(source.currency);
  let timestamp: string | null = null;
  if (source.timestamp !== undefined && source.timestamp !== null) {
    timestamp = dateTime(source.timestamp) ?? null;
    if (timestamp === null) return undefined;
  }
  if (
    parsedSymbol === undefined ||
    lastPrice === undefined ||
    parsedCurrency === undefined
  ) {
    return undefined;
  }
  return { symbol: parsedSymbol, timestamp, lastPrice, currency: parsedCurrency };
}

function parseCandle(value: unknown): Candle | undefined {
  const source = objectValue(value);
  if (!source) return undefined;
  const timestamp = dateTime(source.timestamp);
  const openPrice =
    source.openPrice === undefined ? undefined : decimalString(source, "openPrice");
  const highPrice =
    source.highPrice === undefined ? undefined : decimalString(source, "highPrice");
  const lowPrice =
    source.lowPrice === undefined ? undefined : decimalString(source, "lowPrice");
  const closePrice = decimalString(source, "closePrice");
  const volume =
    source.volume === undefined ? undefined : decimalString(source, "volume");
  const parsedCurrency =
    source.currency === undefined ? undefined : currency(source.currency);
  if (
    timestamp === undefined ||
    closePrice === undefined ||
    (source.openPrice !== undefined && openPrice === undefined) ||
    (source.highPrice !== undefined && highPrice === undefined) ||
    (source.lowPrice !== undefined && lowPrice === undefined) ||
    (source.volume !== undefined && volume === undefined) ||
    (source.currency !== undefined && parsedCurrency === undefined)
  ) {
    return undefined;
  }
  return {
    timestamp,
    ...(openPrice === undefined ? {} : { openPrice }),
    ...(highPrice === undefined ? {} : { highPrice }),
    ...(lowPrice === undefined ? {} : { lowPrice }),
    closePrice,
    ...(volume === undefined ? {} : { volume }),
    ...(parsedCurrency === undefined ? {} : { currency: parsedCurrency }),
  };
}

function parseEnvelopeResult<T>(
  payload: unknown,
  parseResult: (result: unknown) => T,
): T {
  const envelope = objectValue(payload);
  if (!envelope || !Object.prototype.hasOwnProperty.call(envelope, "result")) {
    throw invalidResponse();
  }
  try {
    return parseResult(envelope.result);
  } catch (error) {
    if (error instanceof TossError) throw error;
    throw invalidResponse();
  }
}

export function parseStocksResponse(
  payload: unknown,
  symbols?: readonly string[],
): StockInfo[] {
  return parseEnvelopeResult(payload, (result) => {
    if (!Array.isArray(result)) throw invalidResponse();
    const requested = symbols === undefined ? undefined : requestedSymbols(symbols);
    return result.flatMap((item) => {
      const stock = parseStock(item);
      return stock && matchesRequested(stock.symbol, requested) ? [stock] : [];
    });
  });
}

export function parsePricesResponse(
  payload: unknown,
  symbols?: readonly string[],
): PriceQuote[] {
  return parseEnvelopeResult(payload, (result) => {
    if (!Array.isArray(result)) throw invalidResponse();
    const requested = symbols === undefined ? undefined : requestedSymbols(symbols);
    return result.flatMap((item) => {
      const price = parsePrice(item);
      return price && matchesRequested(price.symbol, requested) ? [price] : [];
    });
  });
}

export function parseCandlesResponse(payload: unknown): Candle[] {
  return parseEnvelopeResult(payload, (result) => {
    const page = objectValue(result);
    if (!page || !Array.isArray(page.candles)) throw invalidResponse();
    // A missing session must not be replaced by an older session in a 20/60/
    // 120-day average. Reject this symbol's history while other symbols and
    // its current-price feed can continue normally.
    const candles = page.candles.map((item) => {
      const candle = parseCandle(item);
      if (!candle) throw invalidResponse();
      return candle;
    });
    if (
      page.nextBefore !== undefined &&
      page.nextBefore !== null &&
      dateTime(page.nextBefore) === undefined
    ) {
      throw invalidResponse();
    }
    return candles;
  });
}

export function parsePriceLimitResponse(payload: unknown): PriceLimit {
  return parseEnvelopeResult(payload, (result) => {
    const source = objectValue(result);
    if (!source) throw invalidResponse();
    // Older API fixtures and the plugin's existing PriceLimit contract use
    // null when no limit snapshot time is available. Keep that tolerated
    // representation while still validating non-null timestamps strictly.
    const timestamp =
      source.timestamp === null || source.timestamp === undefined
        ? null
        : dateTime(source.timestamp);
    const parsedCurrency = currency(source.currency);
    if (timestamp === undefined || parsedCurrency === undefined) {
      throw invalidResponse();
    }
    const upper =
      source.upperLimitPrice === null || source.upperLimitPrice === undefined
        ? undefined
        : decimalString(source, "upperLimitPrice");
    const lower =
      source.lowerLimitPrice === null || source.lowerLimitPrice === undefined
        ? undefined
        : decimalString(source, "lowerLimitPrice");
    if (
      (source.upperLimitPrice !== null &&
        source.upperLimitPrice !== undefined &&
        upper === undefined) ||
      (source.lowerLimitPrice !== null &&
        source.lowerLimitPrice !== undefined &&
        lower === undefined)
    ) {
      throw invalidResponse();
    }
    return {
      timestamp,
      ...(upper === undefined ? {} : { upperLimitPrice: upper }),
      ...(lower === undefined ? {} : { lowerLimitPrice: lower }),
      currency: parsedCurrency,
    };
  });
}
