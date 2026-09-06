import { describe, expect, it } from "vitest";
import {
  formatPrice,
  formatSigned,
  fitPairedText,
  quoteMetrics,
  renderQuoteCard,
  svgToDataUri,
} from "./card.js";

describe("quote card", () => {
  it("calculates change and uses Korean financial colors by default", () => {
    expect(
      quoteMetrics({
        symbol: "005930",
        name: "삼성전자",
        currency: "KRW",
        status: "ready",
        lastPrice: "110",
        referencePrice: "100",
      }),
    ).toMatchObject({ change: 10, rate: 10, color: "#F04452" });

    expect(
      quoteMetrics({
        symbol: "AAPL",
        name: "애플",
        currency: "USD",
        status: "ready",
        lastPrice: "90",
        referencePrice: "100",
      }),
    ).toMatchObject({ change: -10, rate: -10, color: "#3182F6" });
  });

  it("supports global color theme (green up, red down)", () => {
    expect(
      quoteMetrics({
        symbol: "AAPL",
        name: "Apple",
        currency: "USD",
        status: "ready",
        lastPrice: "110",
        referencePrice: "100",
        colorTheme: "global",
      }),
    ).toMatchObject({ change: 10, rate: 10, color: "#00C073" });

    expect(
      quoteMetrics({
        symbol: "AAPL",
        name: "Apple",
        currency: "USD",
        status: "ready",
        lastPrice: "90",
        referencePrice: "100",
        colorTheme: "global",
      }),
    ).toMatchObject({ change: -10, rate: -10, color: "#F04452" });
  });

  it("formats prices and currency symbols cleanly", () => {
    expect(formatPrice("72500", "KRW")).toBe("₩72,500");
    expect(formatPrice("185.5", "USD")).toBe("$185.50");
    expect(formatPrice("72500", "KRW", false)).toBe("72,500");
    expect(formatSigned(1500, "KRW")).toBe("+₩1,500");
    expect(formatSigned(-1500, "KRW")).toBe("−₩1,500");
  });

  it("escapes user text and returns a Stream Deck data URI", () => {
    const svg = renderQuoteCard({
      symbol: "AAPL",
      name: "<unsafe>",
      currency: "USD",
      status: "ready",
      lastPrice: "185.7",
      referencePrice: "180",
    });
    expect(svg).toContain("&lt;unsafe&gt;");
    expect(svgToDataUri(svg)).toMatch(/^data:image\/svg\+xml,/);
  });

  it("renders dedicated status screens for non-ready states without overflowing", () => {
    const authSvg = renderQuoteCard({
      symbol: "005930",
      name: "삼성전자",
      currency: "KRW",
      status: "auth-required",
    });
    expect(authSvg).toContain("API 키 설정 필요");

    const connectingSvg = renderQuoteCard({
      symbol: "005930",
      name: "삼성전자",
      currency: "KRW",
      status: "connecting",
    });
    expect(connectingSvg).toContain("시세 연결 중…");

    const invalidSvg = renderQuoteCard({
      symbol: "XYZ",
      name: "XYZ",
      currency: "USD",
      status: "invalid-symbol",
      message: "종목을 찾을 수 없습니다.",
    });
    expect(invalidSvg).toContain("종목 확인 필요");
  });

  it("renders sparkline chart when candles are available in chart mode", () => {
    const svg = renderQuoteCard({
      symbol: "005930",
      name: "삼성전자",
      currency: "KRW",
      status: "ready",
      lastPrice: "74000",
      referencePrice: "72000",
      sparkline: [70000, 71000, 70500, 72000, 73000, 74000],
      viewMode: "chart",
      showChart: true,
    });
    expect(svg).toContain("sparkGrad_");
    expect(svg).toContain('<path d="M');
  });

  it("renders detail view with high and low metrics on a single line", () => {
    const svg = renderQuoteCard({
      symbol: "005930",
      name: "삼성전자",
      currency: "KRW",
      status: "ready",
      lastPrice: "74000",
      referencePrice: "72000",
      highPrice: "75000",
      lowPrice: "71500",
      viewMode: "detail",
    });
    expect(svg).toContain("₩75,000");
    expect(svg).toContain("₩71,500");
    expect(svg).not.toContain("전일 종가");
  });

  it("keeps typography integer-sized and within the compact-card floor", () => {
    const svg = renderQuoteCard({
      symbol: "005930",
      name: "삼성전자",
      currency: "KRW",
      status: "ready",
      lastPrice: "1234567890123",
      referencePrice: "1234567890000",
      highPrice: "1234567890999",
      lowPrice: "1234567888000",
      viewMode: "detail",
    });
    const sizes = [...svg.matchAll(/font-size="([0-9]+(?:\.[0-9]+)?)"/g)].map(
      (match) => Number(match[1]),
    );
    expect(sizes.length).toBeGreaterThan(0);
    expect(sizes.every((size) => Number.isInteger(size) && size >= 12)).toBe(true);
    expect(svg).toContain('font-size="24"');
    expect(svg).toContain('textLength="120"');
  });

  it("keeps chart information at both edges with a compact gap and supports delayed prices", () => {
    const svg = renderQuoteCard({
      symbol: "AAPL",
      name: "Apple",
      currency: "USD",
      status: "stale",
      lastPrice: "185.70",
      referencePrice: "180.00",
      sparkline: [180, 182, 185.7],
      viewMode: "chart",
    });
    expect(svg).toContain("$185.70");
    expect(svg).toContain('font-size="16"');
    expect(svg).toMatch(/<text x="12" y="82"[^>]*>\+\$5\.70<\/text>/);
    expect(svg).toMatch(/<text x="132" y="82"[^>]*>▲ 3\.17%<\/text>/);
    expect(svg).toContain('fill="#FFB020"');
  });

  it("retains the 144 viewBox so 96px and 72px keys scale as one coherent card", () => {
    for (const viewMode of ["chart", "detail"] as const) {
      const svg = renderQuoteCard({
        symbol: "005930",
        name: "삼성전자",
        currency: "KRW",
        status: "ready",
        lastPrice: "74000",
        referencePrice: "72000",
        highPrice: "75000",
        lowPrice: "71500",
        sparkline: [70000, 72000, 74000],
        viewMode,
      });
      expect(svg).toContain('width="144" height="144" viewBox="0 0 144 144"');
      expect(svg).not.toMatch(/font-size="(?:[0-9]|1[01])(?:\.[0-9]+)?"/);
    }
  });

  it("guarantees paired-row geometry and clamps extreme high/low values", () => {
    const fit = fitPairedText("+$123,456,789.00", "▲ 999.99%", 120, 6);
    expect(fit.gap).toBeGreaterThanOrEqual(6);
    const width = (text: string, size: number) => text.length * size * 0.56;
    const left = fit.left.textLength ?? width("+$123,456,789.00", fit.left.fontSize);
    const right = fit.right.textLength ?? width("▲ 999.99%", fit.right.fontSize);
    expect(left + right + fit.gap).toBeLessThanOrEqual(120);

    const svg = renderQuoteCard({
      symbol: "AAPL",
      name: "Apple",
      currency: "USD",
      status: "ready",
      lastPrice: "185.70",
      referencePrice: "180.00",
      highPrice: "123456789012345",
      lowPrice: "123456789012340",
      viewMode: "detail",
    });
    expect(svg.match(/textLength="[0-9]+"/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(svg).toContain("$123.46T");
  });
});
