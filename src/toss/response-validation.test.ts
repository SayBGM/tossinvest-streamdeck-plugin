import { describe, expect, it } from "vitest";
import { TossError } from "./errors.js";
import {
  parseCandlesResponse,
  parsePriceLimitResponse,
  parsePricesResponse,
  parseStocksResponse,
} from "./response-validation.js";

const timestamp = "2026-09-07T09:00:00+09:00";

function stock(symbol = "005930"): Record<string, unknown> {
  return { symbol, name: "삼성전자", market: "KOSPI", currency: "KRW" };
}

function price(symbol = "005930", lastPrice = "72000"): Record<string, unknown> {
  return { symbol, timestamp, lastPrice, currency: "KRW" };
}

function candle(closePrice = "72000"): Record<string, unknown> {
  return {
    timestamp,
    openPrice: "71000",
    highPrice: "72500",
    lowPrice: "70500",
    closePrice,
    volume: "100",
    currency: "KRW",
  };
}

describe("Toss REST response validation", () => {
  it("keeps valid stock and price rows when a batch contains invalid rows", () => {
    expect(
      parseStocksResponse({ result: [stock(), { symbol: "bad symbol", name: 1 }] }, ["005930"]),
    ).toEqual([stock()]);
    expect(
      parsePricesResponse(
        { result: [price(), price("000660", "NaN"), { symbol: "000660", lastPrice: "-1", currency: "KRW" }] },
        ["005930", "000660"],
      ),
    ).toEqual([{ symbol: "005930", timestamp, lastPrice: "72000", currency: "KRW" }]);
  });

  it.each(["", "NaN", "Infinity", "-1", "1e3", "1."].map((value) => [value]))(
    "rejects invalid price %s while retaining zero",
    (value) => {
      expect(parsePricesResponse({ result: [price("005930", value)] })).toEqual([]);
      expect(parsePricesResponse({ result: [price("005930", "0")] })).toHaveLength(1);
    },
  );

  it("allows a null price timestamp and rejects malformed non-null timestamps", () => {
    expect(parsePricesResponse({ result: [{ ...price(), timestamp: null }] })[0]?.timestamp).toBeNull();
    expect(parsePricesResponse({ result: [{ ...price(), timestamp: "2026-09-07" }] })).toEqual([]);
  });

  it("rejects a damaged history instead of replacing missing MA sessions with older ones", () => {
    expect(() =>
      parseCandlesResponse({
        result: {
          candles: [candle("72000"), { ...candle("-1") }, { ...candle("NaN") }],
          nextBefore: null,
        },
      }),
    ).toThrow("API response is invalid");
  });

  it("validates price-limit values and keeps null limits", () => {
    expect(
      parsePriceLimitResponse({
        result: {
          timestamp,
          upperLimitPrice: "0",
          lowerLimitPrice: null,
          currency: "KRW",
        },
      }),
    ).toEqual({ timestamp, upperLimitPrice: "0", currency: "KRW" });
    expect(() =>
      parsePriceLimitResponse({
        result: {
          timestamp,
          upperLimitPrice: "Infinity",
          lowerLimitPrice: null,
          currency: "KRW",
        },
      }),
    ).toThrow(TossError);
  });

  it.each([
    parseStocksResponse,
    parsePricesResponse,
    parseCandlesResponse,
    parsePriceLimitResponse,
  ])("throws a safe TossError for a malformed %p envelope", (parse) => {
    expect(() => parse({ nope: true } as never)).toThrow(TossError);
    try {
      parse({ nope: true } as never);
    } catch (error) {
      expect(error).toMatchObject({ code: "API", retryable: true });
    }
  });
});
