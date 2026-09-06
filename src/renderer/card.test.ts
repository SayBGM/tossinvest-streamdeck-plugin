import { describe, expect, it } from "vitest";
import {
  formatPrice,
  formatPriceTier,
  formatSigned,
  measureText,
  quoteMetrics,
  renderQuoteCard,
  svgToDataUri,
} from "./card.js";
import type { QuoteView, Signal } from "../types.js";

interface TextNode {
  readonly x: number;
  readonly anchor: "start" | "end" | "middle";
  readonly fontSize: number;
  readonly text: string;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"');
}

function extractTextNodes(svg: string): TextNode[] {
  const nodes: TextNode[] = [];
  const regex = /<text\s+([^>]*)>([^<]*)<\/text>/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(svg))) {
    const attrs = match[1]!;
    const rawText = match[2]!;
    const x = Number(/x="([^"]+)"/.exec(attrs)?.[1]);
    const anchor = (/text-anchor="([^"]+)"/.exec(attrs)?.[1] ?? "start") as
      | "start"
      | "end"
      | "middle";
    const fontSize = Number(/font-size="([^"]+)"/.exec(attrs)?.[1]);
    nodes.push({ x, anchor, fontSize, text: decodeXmlEntities(rawText) });
  }
  return nodes;
}

const baseKrView: QuoteView = {
  symbol: "005930",
  name: "삼성전자",
  currency: "KRW",
  status: "ready",
  lastPrice: "74200",
  referencePrice: "72000",
};

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
    }
  });

  it("never emits textLength or arrow glyphs", () => {
    const views: QuoteView[] = [
      { ...baseKrView, viewMode: "chart", highPrice: "75000", lowPrice: "71500" },
      { ...baseKrView, viewMode: "detail", highPrice: "75000", lowPrice: "71500" },
      {
        symbol: "AAPL",
        name: "Apple",
        currency: "USD",
        status: "ready",
        lastPrice: "185.70",
        referencePrice: "180.00",
        highPrice: "190.00",
        lowPrice: "178.50",
        viewMode: "chart",
      },
      {
        symbol: "AAPL",
        name: "Apple",
        currency: "USD",
        status: "ready",
        lastPrice: "185.70",
        referencePrice: "180.00",
        highPrice: "190.00",
        lowPrice: "178.50",
        viewMode: "detail",
      },
    ];
    for (const view of views) {
      const svg = renderQuoteCard(view);
      expect(svg).not.toContain("textLength");
      expect(svg).not.toContain("lengthAdjust");
      expect(svg).not.toContain("▲");
      expect(svg).not.toContain("▼");
    }
  });

  it("keeps every text inside the 124px content width", () => {
    const krLast = [1000, 5500, 74200, 258000, 1234000, 1987000];
    const usdLast = [0.52, 4.87, 178.25, 522.6, 4123.45, 52000.75, 712345.5];

    const views: QuoteView[] = [];
    for (const last of krLast) {
      const reference = Math.round(last * 0.97);
      const high = Math.round(last * 1.03);
      const low = Math.round(last * 0.95);
      for (const viewMode of ["chart", "detail"] as const) {
        for (const showCurrencySymbol of [true, false]) {
          views.push({
            symbol: "005930",
            name: "삼성전자",
            currency: "KRW",
            status: "ready",
            lastPrice: String(last),
            referencePrice: String(reference),
            highPrice: String(high),
            lowPrice: String(low),
            viewMode,
            showCurrencySymbol,
            sparkline: [reference, last],
          });
        }
      }
    }
    for (const last of usdLast) {
      const reference = Number((last * 0.97).toFixed(2));
      const high = Number((last * 1.03).toFixed(2));
      const low = Number((last * 0.95).toFixed(2));
      for (const viewMode of ["chart", "detail"] as const) {
        for (const showCurrencySymbol of [true, false]) {
          views.push({
            symbol: "AAPL",
            name: "Apple",
            currency: "USD",
            status: "ready",
            lastPrice: String(last),
            referencePrice: String(reference),
            highPrice: String(high),
            lowPrice: String(low),
            viewMode,
            showCurrencySymbol,
            sparkline: [reference, last],
          });
        }
      }
    }

    for (const view of views) {
      const svg = renderQuoteCard(view);
      const nodes = extractTextNodes(svg);
      for (const node of nodes) {
        const width = measureText(node.text, node.fontSize);
        if (node.anchor === "start") {
          expect(node.x + width).toBeLessThanOrEqual(134.01);
        } else if (node.anchor === "end") {
          expect(node.x - width).toBeGreaterThanOrEqual(9.99);
        } else {
          expect(node.x - width / 2).toBeGreaterThanOrEqual(-0.01);
          expect(node.x + width / 2).toBeLessThanOrEqual(144.01);
        }
      }
    }
  });

  it("enforces readable font floors", () => {
    const krLast = [1000, 5500, 74200, 258000, 1234000, 1987000];
    const usdLast = [0.52, 4.87, 178.25, 522.6, 4123.45, 52000.75, 712345.5];
    const views: QuoteView[] = [];
    for (const last of krLast) {
      const reference = Math.round(last * 0.97);
      const high = Math.round(last * 1.03);
      const low = Math.round(last * 0.95);
      for (const viewMode of ["chart", "detail"] as const) {
        views.push({
          symbol: "005930",
          name: "삼성전자",
          currency: "KRW",
          status: "ready",
          lastPrice: String(last),
          referencePrice: String(reference),
          highPrice: String(high),
          lowPrice: String(low),
          viewMode,
        });
      }
    }
    for (const last of usdLast) {
      const reference = Number((last * 0.97).toFixed(2));
      const high = Number((last * 1.03).toFixed(2));
      const low = Number((last * 0.95).toFixed(2));
      for (const viewMode of ["chart", "detail"] as const) {
        views.push({
          symbol: "AAPL",
          name: "Apple",
          currency: "USD",
          status: "ready",
          lastPrice: String(last),
          referencePrice: String(reference),
          highPrice: String(high),
          lowPrice: String(low),
          viewMode,
        });
      }
    }

    for (const view of views) {
      const svg = renderQuoteCard(view);
      const priceMatch = /<text[^>]*font-size="([^"]+)"[^>]*font-weight="800"/.exec(svg);
      expect(priceMatch).not.toBeNull();
      const priceFontSize = Number(priceMatch![1]);
      expect(priceFontSize).toBeGreaterThanOrEqual(24);

      const allSizes = [...svg.matchAll(/font-size="([0-9]+(?:\.[0-9]+)?)"/g)].map((m) =>
        Number(m[1]),
      );
      expect(allSizes.length).toBeGreaterThan(0);
      for (const size of allSizes) {
        expect(Number.isInteger(size)).toBe(true);
      }
      const nonPriceSizes = [
        ...svg.matchAll(/<text[^>]*font-size="([0-9]+(?:\.[0-9]+)?)"[^>]*>/g),
      ]
        .filter((m) => !m[0].includes('font-weight="800"'))
        .map((m) => Number(m[1]));
      for (const size of nonPriceSizes) {
        expect(size).toBeGreaterThanOrEqual(14);
      }
    }
  });

  it("uses one font size for the rate and the change amount", () => {
    // Change amounts of 1000+ (KRW) grow a thousands separator and get
    // dropped before the shared font shrinks below its floor, so this view
    // is chosen to sit right at the edge where both the rate and the amount
    // still fit together.
    const view: QuoteView = {
      symbol: "005930",
      name: "삼성전자",
      currency: "KRW",
      status: "ready",
      lastPrice: "100950",
      referencePrice: "100000",
      viewMode: "chart",
    };
    const svg = renderQuoteCard(view);
    const metrics = quoteMetrics(view);
    // Find text nodes on the change row: coloured with the metric colour, y="90".
    const rowRegex = new RegExp(
      `<text x="([0-9.]+)" y="90" text-anchor="[^"]*" fill="${metrics.color}" font-size="([0-9]+)"[^>]*>([^<]*)</text>`,
      "g",
    );
    const matches = [...svg.matchAll(rowRegex)];
    expect(matches.length).toBe(2);
    const fontSizes = matches.map((m) => Number(m[2]));
    expect(fontSizes[0]).toBe(fontSizes[1]);
    const texts = matches.map((m) => decodeXmlEntities(m[3]!));
    expect(texts).toContain("+950");
    expect(texts.some((t) => t.includes("₩"))).toBe(false);
  });

  it("keeps the price font stable across a digit boundary", () => {
    // fitPriceGroup sizes the font to the widest member of
    // {last, reference, high, low}. A high/low that already spans the
    // 100,000 boundary keeps that width pinned so a lastPrice tick from
    // 99,900 to 100,000 does not need a smaller font.
    const before: QuoteView = {
      symbol: "005930",
      name: "삼성전자",
      currency: "KRW",
      status: "ready",
      lastPrice: "99900",
      referencePrice: "98000",
      highPrice: "103000",
      lowPrice: "96000",
      viewMode: "chart",
    };
    const after: QuoteView = { ...before, lastPrice: "100000" };
    const svgBefore = renderQuoteCard(before);
    const svgAfter = renderQuoteCard(after);
    const priceFont = (svg: string) =>
      Number(/<text[^>]*font-size="([^"]+)"[^>]*font-weight="800"/.exec(svg)?.[1]);
    expect(priceFont(svgBefore)).toBe(priceFont(svgAfter));
  });

  it("prefers the ticker for a long US name", () => {
    const usView: QuoteView = {
      symbol: "DELL",
      name: "델 테크놀로지스",
      market: "US",
      currency: "USD",
      status: "ready",
      lastPrice: "122.5",
      referencePrice: "120",
      viewMode: "chart",
    };
    const usSvg = renderQuoteCard(usView);
    const usTitle = extractTextNodes(usSvg).find((n) => n.x === 10 && n.fontSize >= 14);
    expect(usTitle?.text).toBe("DELL");

    const krView: QuoteView = {
      symbol: "005930",
      name: "아주긴종목이름테스트",
      currency: "KRW",
      status: "ready",
      lastPrice: "74200",
      referencePrice: "72000",
      viewMode: "chart",
    };
    const krSvg = renderQuoteCard(krView);
    const titleMatch = /<text x="10" y="26"[^>]*>([^<]*)<\/text>/.exec(krSvg);
    expect(titleMatch).not.toBeNull();
    const titleText = decodeXmlEntities(titleMatch![1]!);
    expect(titleText.endsWith("…")).toBe(true);
    expect(titleText).not.toContain("005930");
  });

  it("renders the day range bar with low/high values in detail mode", () => {
    const svg = renderQuoteCard({
      symbol: "005930",
      name: "삼성전자",
      currency: "KRW",
      status: "ready",
      lastPrice: "74200",
      referencePrice: "72000",
      highPrice: "75000",
      lowPrice: "71500",
      viewMode: "detail",
    });
    expect(svg).toMatch(/<text x="10" y="107"[^>]*>저<\/text>/);
    expect(svg).toMatch(/<text x="134" y="107"[^>]*text-anchor="end"[^>]*>고<\/text>/);
    // The price line already shows ₩, so the range values never repeat the symbol.
    expect(svg).toMatch(/<text x="10" y="136"[^>]*>71,500<\/text>/);
    expect(svg).toMatch(/<text x="134" y="136"[^>]*text-anchor="end"[^>]*>75,000<\/text>/);
    // Track spans the content width; the marker sits at (74200-71500)/(75000-71500) ≈ 77% of it.
    expect(svg).toContain('<rect x="10" y="113" width="124" height="4" rx="2" fill="#2A2D35"/>');
    expect(svg).toMatch(/<circle cx="105\.7" cy="115"[^>]*fill="#F04452"/);

    // A 7-digit KRW pair falls back to the 만 unit rather than shrinking below 14px.
    const bioSvg = renderQuoteCard({
      symbol: "207940",
      name: "삼성바이오로직스",
      currency: "KRW",
      status: "ready",
      lastPrice: "1034000",
      referencePrice: "1002000",
      highPrice: "1041000",
      lowPrice: "998000",
      viewMode: "detail",
    });
    expect(bioSvg).toMatch(/y="136"[^>]*font-size="16"[^>]*>99\.8만<\/text>/);
    expect(bioSvg).toMatch(/y="136"[^>]*font-size="16"[^>]*>104\.1만<\/text>/);

    // Missing high/low still draws the track without a marker.
    const noRange = renderQuoteCard({
      symbol: "005930",
      name: "삼성전자",
      currency: "KRW",
      status: "ready",
      lastPrice: "74200",
      referencePrice: "72000",
      viewMode: "detail",
    });
    expect(noRange).toContain('fill="#2A2D35"');
    expect(noRange).not.toMatch(/<circle cx="[0-9.]+" cy="115"/);
  });

  it("colours the status dot by liveness", () => {
    const offlineSvg = renderQuoteCard({
      symbol: "005930",
      name: "삼성전자",
      currency: "KRW",
      status: "ready",
      lastPrice: "74200",
      referencePrice: "72000",
      live: false,
    });
    expect(offlineSvg).toMatch(/<circle cx="134"[^>]*fill="#6B7684"/);

    const liveSvg = renderQuoteCard({
      symbol: "005930",
      name: "삼성전자",
      currency: "KRW",
      status: "ready",
      lastPrice: "74200",
      referencePrice: "72000",
      live: true,
    });
    expect(liveSvg).toMatch(/<circle cx="134"[^>]*fill="#00C073"/);

    const staleSvg = renderQuoteCard({
      symbol: "005930",
      name: "삼성전자",
      currency: "KRW",
      status: "stale",
      lastPrice: "74200",
      referencePrice: "72000",
    });
    expect(staleSvg).toMatch(/<circle cx="134"[^>]*fill="#FFB020"/);
  });

  it("degrades price tiers progressively", () => {
    expect(formatPriceTier("522.6", "USD", true, 0)).toBe("$522.60");
    expect(formatPriceTier("522.6", "USD", true, 1)).toBe("522.60");
    expect(formatPriceTier("522.6", "USD", true, 2)).toBe("522.6");
    expect(formatPriceTier("522.6", "USD", true, 3)).toBe("523");
    expect(formatPriceTier("74200", "KRW", true, 2)).toBe(
      formatPriceTier("74200", "KRW", true, 1),
    );
    expect(formatPriceTier("123456789012345", "USD", true, 4)).toBe("123.46T");
  });
});

describe("signal card", () => {
  const bullishKrSignal: Signal = {
    kind: "upper-limit",
    label: "상한가",
    sentiment: "bullish",
    price: "93600",
    at: "2026-09-07T01:05:00Z",
  };
  const bearishKrSignal: Signal = {
    kind: "rate-down",
    label: "5% 하락",
    sentiment: "bearish",
    price: "68400",
    at: "2026-09-07T01:05:00Z",
  };

  it("contains the stock name, the signal label and the formatted price", () => {
    const view: QuoteView = {
      ...baseKrView,
      lastPrice: "93600",
      signal: bullishKrSignal,
    };
    const svg = renderQuoteCard(view);
    expect(svg).toContain("삼성전자");
    expect(svg).toContain("상한가");
    expect(svg).toContain(formatPriceTier(view.lastPrice, view.currency, true, 0));
  });

  it("colours the background by theme and sentiment", () => {
    const krBullish = renderQuoteCard({ ...baseKrView, signal: bullishKrSignal });
    expect(krBullish).toMatch(/<rect width="144" height="144" rx="18" fill="#F04452"\/>/);

    const krBearish = renderQuoteCard({ ...baseKrView, signal: bearishKrSignal });
    expect(krBearish).toMatch(/<rect width="144" height="144" rx="18" fill="#3182F6"\/>/);

    const globalBullish = renderQuoteCard({
      ...baseKrView,
      symbol: "AAPL",
      name: "Apple",
      currency: "USD",
      colorTheme: "global",
      signal: bullishKrSignal,
    });
    expect(globalBullish).toMatch(/<rect width="144" height="144" rx="18" fill="#00C073"\/>/);

    const globalBearish = renderQuoteCard({
      ...baseKrView,
      symbol: "AAPL",
      name: "Apple",
      currency: "USD",
      colorTheme: "global",
      signal: bearishKrSignal,
    });
    expect(globalBearish).toMatch(/<rect width="144" height="144" rx="18" fill="#F04452"\/>/);
  });

  it("wins over status screens", () => {
    const svg = renderQuoteCard({
      symbol: "005930",
      name: "삼성전자",
      currency: "KRW",
      status: "auth-required",
      signal: bullishKrSignal,
    });
    expect(svg).not.toContain("API 키 설정 필요");
    expect(svg).toContain("상한가");
  });

  it("wins over chart and detail modes", () => {
    for (const viewMode of ["chart", "detail"] as const) {
      const svg = renderQuoteCard({
        ...baseKrView,
        viewMode,
        highPrice: "75000",
        lowPrice: "71500",
        sparkline: [70000, 72000, 74000],
        signal: bullishKrSignal,
      });
      expect(svg).toContain("상한가");
      expect(svg).not.toContain("sparkGrad_");
      expect(svg).not.toMatch(/저<\/text>/);
    }
  });

  it("keeps width invariants and a 12px font floor across a label × price matrix", () => {
    const labels = [
      "5% 상승",
      "35% 하락",
      "상한가",
      "하한가",
      "120일선 돌파",
      "20일선 이탈",
    ];
    const krLast = [1000, 5500, 74200, 258000, 1234000, 1987000];
    const usdLast = [0.52, 4.87, 178.25, 522.6, 4123.45, 52000.75, 712345.5];

    const views: Array<{ view: QuoteView; svg: string }> = [];
    for (const label of labels) {
      const sentiment: Signal["sentiment"] = label.includes("하락") || label.includes("하한가") || label.includes("이탈")
        ? "bearish"
        : "bullish";
      for (const showCurrencySymbol of [true, false]) {
        for (const last of krLast) {
          const view: QuoteView = {
            symbol: "005930",
            name: "삼성전자",
            currency: "KRW",
            status: "ready",
            lastPrice: String(last),
            referencePrice: String(Math.round(last * 0.97)),
            showCurrencySymbol,
            signal: { kind: "rate-up", label, sentiment, price: String(last), at: "2026-09-07T01:05:00Z" },
          };
          views.push({ view, svg: renderQuoteCard(view) });
        }
        for (const last of usdLast) {
          const view: QuoteView = {
            symbol: "AAPL",
            name: "Apple",
            currency: "USD",
            status: "ready",
            lastPrice: String(last),
            referencePrice: String(Number((last * 0.97).toFixed(2))),
            showCurrencySymbol,
            signal: { kind: "rate-up", label, sentiment, price: String(last), at: "2026-09-07T01:05:00Z" },
          };
          views.push({ view, svg: renderQuoteCard(view) });
        }
      }
    }

    for (const { svg } of views) {
      expect(svg).not.toContain("textLength");
      expect(svg).not.toContain("lengthAdjust");
      expect(svg).not.toContain("▲");
      expect(svg).not.toContain("▼");

      const nodes = extractTextNodes(svg);
      expect(nodes.length).toBeGreaterThan(0);
      for (const node of nodes) {
        const width = measureText(node.text, node.fontSize);
        if (node.anchor === "start") {
          expect(node.x + width).toBeLessThanOrEqual(134.01);
        } else if (node.anchor === "end") {
          expect(node.x - width).toBeGreaterThanOrEqual(9.99);
        } else {
          expect(node.x - width / 2).toBeGreaterThanOrEqual(-0.01);
          expect(node.x + width / 2).toBeLessThanOrEqual(144.01);
        }
        expect(Number.isInteger(node.fontSize)).toBe(true);
        expect(node.fontSize).toBeGreaterThanOrEqual(12);
      }
    }
  });
});
