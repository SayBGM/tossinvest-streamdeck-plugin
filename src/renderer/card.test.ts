import { describe, expect, it } from "vitest";
import { quoteMetrics, renderQuoteCard, svgToDataUri } from "./card.js";

describe("quote card", () => {
  it("calculates change and uses Korean financial colors", () => {
    expect(quoteMetrics({ symbol: "005930", name: "삼성전자", currency: "KRW", status: "ready", lastPrice: "110", referencePrice: "100" })).toMatchObject({ change: 10, rate: 10, color: "#ff1744" });
    expect(quoteMetrics({ symbol: "AAPL", name: "애플", currency: "USD", status: "ready", lastPrice: "90", referencePrice: "100" })).toMatchObject({ change: -10, rate: -10, color: "#2979ff" });
  });

  it("escapes user text and returns a Stream Deck data URI", () => {
    const svg = renderQuoteCard({ symbol: "AAPL", name: "<unsafe>", currency: "USD", status: "ready", lastPrice: "185.7", referencePrice: "180" });
    expect(svg).toContain("&lt;unsafe&gt;");
    expect(svgToDataUri(svg)).toMatch(/^data:image\/svg\+xml,/);
  });
});
