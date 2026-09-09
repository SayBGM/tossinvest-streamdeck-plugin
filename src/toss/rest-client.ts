import type {
  Candle,
  Market,
  PriceLimit,
  PriceQuote,
  StockInfo,
} from "../types.js";
import { AuthSession } from "./auth-session.js";
import { TossError } from "./errors.js";
import { RateGate } from "./rate-gate.js";
import {
  parseCandlesResponse,
  parsePriceLimitResponse,
  parsePricesResponse,
  parseStocksResponse,
} from "./response-validation.js";
import { normalizeSymbol } from "../settings.js";

interface ApiErrorEnvelope {
  error?: { requestId?: unknown; code?: unknown; message?: unknown };
}

const MAX_AUTOMATIC_RETRY_DELAY_MS = 60_000;

function retryAfterDelayMs(value: string | null): number | undefined {
  if (value === null) return 1_000;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    if (seconds < 0) return 1_000;
    const delay = Math.max(1, seconds * 1_000);
    return delay <= MAX_AUTOMATIC_RETRY_DELAY_MS ? delay : undefined;
  }
  // RFC 7231 also permits an HTTP-date. Treat a stale date as a one-second
  // fallback, while declining a retry when the server asks us to wait too
  // long. This prevents malformed or unbounded headers from hanging a key.
  const retryAt = Date.parse(value);
  if (!Number.isFinite(retryAt)) return 1_000;
  const delay = Math.max(1_000, retryAt - Date.now());
  return delay <= MAX_AUTOMATIC_RETRY_DELAY_MS ? delay : undefined;
}

export interface TossRestClientOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly baseUrl?: string;
}

export class TossRestClient {
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly baseUrl: string;
  private readonly marketData = new RateGate(100);
  private readonly stock = new RateGate(200);
  private readonly chart = new RateGate(200);

  constructor(
    private readonly auth: AuthSession,
    options: TossRestClientOptions = {},
  ) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.baseUrl = options.baseUrl ?? "https://openapi.tossinvest.com";
  }

  async getStocks(symbols: readonly string[]): Promise<StockInfo[]> {
    if (symbols.length === 0) return [];
    const normalized = this.normalizeSymbols(symbols);
    return this.stock.run(() =>
      this.request(
        `/api/v1/stocks?symbols=${encodeURIComponent(normalized.join(","))}`,
        (payload) => parseStocksResponse(payload, normalized),
      ),
    );
  }

  async getPrices(symbols: readonly string[]): Promise<PriceQuote[]> {
    if (symbols.length === 0) return [];
    const normalized = this.normalizeSymbols(symbols);
    return this.marketData.run(() =>
      this.request(
        `/api/v1/prices?symbols=${encodeURIComponent(normalized.join(","))}`,
        (payload) => parsePricesResponse(payload, normalized),
      ),
    );
  }

  async getCandles(symbol: string, count = 10): Promise<Candle[]> {
    const normalized = this.normalizeSymbol(symbol);
    if (!Number.isInteger(count) || count < 1 || count > 200) {
      throw new TossError("API", "Invalid candle count", false);
    }
    return this.chart.run(async () => {
      return this.request(
        `/api/v1/candles?symbol=${encodeURIComponent(normalized)}&interval=1d&count=${count}&adjusted=true`,
        parseCandlesResponse,
      );
    });
  }

  async getPriceLimit(symbol: string): Promise<PriceLimit> {
    const normalized = this.normalizeSymbol(symbol);
    return this.marketData.run(async () => {
      return this.request(
        `/api/v1/price-limits?symbol=${encodeURIComponent(normalized)}`,
        parsePriceLimitResponse,
      );
    });
  }

  async resolveSymbol(symbol: string): Promise<StockInfo> {
    const normalized = this.normalizeSymbol(symbol);
    const stocks = await this.getStocks([normalized]);
    const match = stocks.find(
      (stock) => stock.symbol.toUpperCase() === normalized,
    );
    if (!match)
      throw new TossError("INVALID_SYMBOL", "Stock was not found", false);
    return match;
  }

  marketFor(stock: StockInfo): Market {
    if (stock.currency === "KRW") return "KR";
    if (stock.currency === "USD") return "US";
    throw new TossError(
      "INVALID_SYMBOL",
      "Only KR and US stocks are supported",
      false,
    );
  }

  private async request<T>(
    path: string,
    parseResult: (payload: unknown) => T,
    retry = true,
  ): Promise<T> {
    const token = await this.auth.getToken();
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new TossError(
        "NETWORK",
        error instanceof Error ? error.message : "Network error",
        true,
      );
    }

    if (response.status === 401 && retry) {
      this.auth.invalidate();
      return this.request(path, parseResult, false);
    }
    if (response.status === 403) {
      throw new TossError("IP_NOT_ALLOWED", "IP address is not allowed", false);
    }
    if (response.status === 404) {
      throw new TossError("INVALID_SYMBOL", "Stock was not found", false);
    }
    if (response.status === 429) {
      if (retry) {
        const delayMs = retryAfterDelayMs(response.headers.get("Retry-After"));
        if (delayMs === undefined) {
          throw new TossError("RATE_LIMITED", "Rate limit exceeded", true);
        }
        await new Promise((resolve) =>
          setTimeout(resolve, delayMs),
        );
        return this.request(path, parseResult, false);
      }
      throw new TossError("RATE_LIMITED", "Rate limit exceeded", true);
    }
    if (!response.ok) {
      let details: ApiErrorEnvelope = {};
      try {
        details = (await response.json()) as ApiErrorEnvelope;
      } catch {
        /* ignored */
      }
      const requestId =
        typeof details.error?.requestId === "string"
          ? details.error.requestId
          : undefined;
      const code =
        typeof details.error?.code === "string"
          ? details.error.code
          : "unknown";
      throw new TossError(
        "API",
        `API request failed (${response.status}, ${code})`,
        response.status >= 500,
        requestId,
      );
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new TossError("API", "API response is invalid", true);
    }
    return parseResult(payload);
  }

  private normalizeSymbol(value: string): string {
    const normalized = normalizeSymbol(value);
    if (!normalized) {
      throw new TossError("INVALID_SYMBOL", "Invalid symbol", false);
    }
    return normalized;
  }

  private normalizeSymbols(values: readonly string[]): string[] {
    if (values.length > 200) {
      throw new TossError("API", "Too many symbols", false);
    }
    return values.map((value) => this.normalizeSymbol(value));
  }
}

export function marketDate(ts: string, market?: Market): string {
  const tz = market === "US" ? "America/New_York" : "Asia/Seoul";
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(
      new Date(ts),
    );
  } catch {
    return ts.slice(0, 10);
  }
}

export function selectReferencePrice(
  candles: readonly Candle[],
  quoteTimestamp: string | null = null,
  market?: Market,
): string | undefined {
  if (candles.length === 0) return undefined;
  const sorted = [...candles].sort((a, b) =>
    b.timestamp.localeCompare(a.timestamp),
  );
  if (sorted.length === 1) return sorted[0]?.closePrice;

  if (quoteTimestamp) {
    const quoteDate = marketDate(quoteTimestamp, market);
    // Find the newest candle strictly before the current quote trading date
    const prior = sorted.find(
      (candle) => marketDate(candle.timestamp, market) < quoteDate,
    );
    if (prior) return prior.closePrice;
  }

  // Fallback: If quoteTimestamp is missing or matches sorted[0] trading day,
  // sorted[0] is the current session candle and sorted[1] is the previous day's close (전일 종가)
  return sorted[1]?.closePrice ?? sorted[0]?.closePrice;
}
