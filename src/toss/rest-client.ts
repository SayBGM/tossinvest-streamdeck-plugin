import type { Candle, Market, PriceQuote, StockInfo } from "../types.js";
import { AuthSession } from "./auth-session.js";
import { TossError } from "./errors.js";
import { RateGate } from "./rate-gate.js";

interface ApiEnvelope<T> { result?: T }
interface ApiErrorEnvelope {
  error?: { requestId?: unknown; code?: unknown; message?: unknown };
}
interface CandlePage { candles?: Candle[] }

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

  constructor(private readonly auth: AuthSession, options: TossRestClientOptions = {}) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.baseUrl = options.baseUrl ?? "https://openapi.tossinvest.com";
  }

  async getStocks(symbols: readonly string[]): Promise<StockInfo[]> {
    if (symbols.length === 0) return [];
    return this.stock.run(() => this.request<StockInfo[]>(
      `/api/v1/stocks?symbols=${encodeURIComponent(symbols.slice(0, 200).join(","))}`,
    ));
  }

  async getPrices(symbols: readonly string[]): Promise<PriceQuote[]> {
    if (symbols.length === 0) return [];
    return this.marketData.run(() => this.request<PriceQuote[]>(
      `/api/v1/prices?symbols=${encodeURIComponent(symbols.slice(0, 200).join(","))}`,
    ));
  }

  async getCandles(symbol: string, count = 5): Promise<Candle[]> {
    return this.chart.run(async () => {
      const result = await this.request<CandlePage>(
        `/api/v1/candles?symbol=${encodeURIComponent(symbol)}&interval=1d&count=${count}&adjusted=true`,
      );
      return Array.isArray(result.candles) ? result.candles : [];
    });
  }

  async resolveSymbol(symbol: string): Promise<StockInfo> {
    const stocks = await this.getStocks([symbol]);
    const match = stocks.find((stock) => stock.symbol.toUpperCase() === symbol.toUpperCase());
    if (!match) throw new TossError("INVALID_SYMBOL", "Stock was not found", false);
    return match;
  }

  marketFor(stock: StockInfo): Market {
    if (stock.currency === "KRW") return "KR";
    if (stock.currency === "USD") return "US";
    throw new TossError("INVALID_SYMBOL", "Only KR and US stocks are supported", false);
  }

  private async request<T>(path: string, retry = true): Promise<T> {
    const token = await this.auth.getToken();
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new TossError("NETWORK", error instanceof Error ? error.message : "Network error", true);
    }

    if (response.status === 401 && retry) {
      this.auth.invalidate();
      return this.request<T>(path, false);
    }
    if (response.status === 403) {
      throw new TossError("IP_NOT_ALLOWED", "IP address is not allowed", false);
    }
    if (response.status === 404) {
      throw new TossError("INVALID_SYMBOL", "Stock was not found", false);
    }
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("Retry-After") ?? "1");
      if (retry) {
        await new Promise((resolve) => setTimeout(resolve, Math.max(1, retryAfter) * 1_000));
        return this.request<T>(path, false);
      }
      throw new TossError("RATE_LIMITED", "Rate limit exceeded", true);
    }
    if (!response.ok) {
      let details: ApiErrorEnvelope = {};
      try { details = await response.json() as ApiErrorEnvelope; } catch { /* ignored */ }
      const requestId = typeof details.error?.requestId === "string" ? details.error.requestId : undefined;
      const code = typeof details.error?.code === "string" ? details.error.code : "unknown";
      throw new TossError("API", `API request failed (${response.status}, ${code})`, response.status >= 500, requestId);
    }
    const envelope = await response.json() as ApiEnvelope<T>;
    if (envelope.result === undefined) {
      throw new TossError("API", "API response is missing result", true);
    }
    return envelope.result;
  }
}

export function selectReferencePrice(candles: readonly Candle[], quoteTimestamp: string | null): string | undefined {
  if (candles.length === 0) return undefined;
  const sorted = [...candles].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  if (!quoteTimestamp) return sorted[0]?.closePrice;
  const quoteDate = quoteTimestamp.slice(0, 10);
  const prior = sorted.find((candle) => candle.timestamp.slice(0, 10) < quoteDate);
  return prior?.closePrice ?? sorted[0]?.closePrice;
}
