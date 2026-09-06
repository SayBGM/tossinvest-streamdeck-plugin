import { describe, expect, it } from "vitest";
import type { Candle } from "../types.js";
import { movingAverage, signalSessionKey } from "./indicators.js";

function candle(date: string, closePrice: string): Candle {
  return { timestamp: `${date}T00:00:00Z`, closePrice };
}

describe("movingAverage", () => {
  it("averages the last N completed daily candles, excluding today's in-progress candle", () => {
    const candles = [
      candle("2026-09-01", "100"),
      candle("2026-09-02", "102"),
      candle("2026-09-03", "104"),
      // Today's (still forming) candle — must be excluded from the average.
      candle("2026-09-04", "999"),
    ];
    const result = movingAverage(candles, 3, "2026-09-04T05:00:00Z", "KR");
    expect(result).toBeCloseTo((100 + 102 + 104) / 3);
  });

  it("excludes candles on or after the quote's trading date, not just an exact timestamp match", () => {
    const candles = [
      candle("2026-09-01", "10"),
      candle("2026-09-02", "20"),
      // Same trading date as the quote, later timestamp — still "today".
      { timestamp: "2026-09-03T23:00:00Z", closePrice: "999" },
    ];
    const result = movingAverage(candles, 2, "2026-09-03T00:30:00Z", "KR");
    expect(result).toBeCloseTo((10 + 20) / 2);
  });

  it("returns undefined when there are fewer completed candles than the period", () => {
    const candles = [candle("2026-09-01", "100"), candle("2026-09-02", "102")];
    expect(movingAverage(candles, 3, "2026-09-03T00:00:00Z", "KR")).toBeUndefined();
  });

  it("returns undefined for an empty candle list", () => {
    expect(movingAverage([], 20, "2026-09-03T00:00:00Z", "KR")).toBeUndefined();
  });

  it("handles out-of-order input by sorting internally", () => {
    const candles = [
      candle("2026-09-03", "104"),
      candle("2026-09-01", "100"),
      candle("2026-09-02", "102"),
    ];
    const result = movingAverage(candles, 3, "2026-09-04T00:00:00Z", "KR");
    expect(result).toBeCloseTo((100 + 102 + 104) / 3);
  });
});

describe("signalSessionKey", () => {
  it("combines the market trading date with the reference price", () => {
    const key = signalSessionKey("70500", "2026-09-07T01:00:00Z", "KR");
    expect(key).toBe("2026-09-07:70500");
  });

  it("changes when the trading date changes", () => {
    const a = signalSessionKey("70500", "2026-09-07T01:00:00Z", "KR");
    const b = signalSessionKey("70500", "2026-09-08T01:00:00Z", "KR");
    expect(a).not.toBe(b);
  });

  it("changes when the reference price changes", () => {
    const a = signalSessionKey("70500", "2026-09-07T01:00:00Z", "KR");
    const b = signalSessionKey("71000", "2026-09-07T01:00:00Z", "KR");
    expect(a).not.toBe(b);
  });

  it("uses the US market timezone for US symbols", () => {
    // Late evening UTC on 2026-09-07 is still 2026-09-07 in New York.
    const key = signalSessionKey("180.00", "2026-09-07T23:30:00Z", "US");
    expect(key).toBe("2026-09-07:180.00");
  });
});
