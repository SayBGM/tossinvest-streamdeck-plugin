import { expect, test } from "@playwright/test";
import type { QuoteView } from "../../src/types.js";
import { renderQuoteCard, svgToDataUri } from "../../src/renderer/card.js";

const fixtures: ReadonlyArray<{ readonly label: string; readonly view: QuoteView }> = [
  {
    label: "국내 상승 · 차트",
    view: {
      symbol: "005930",
      name: "삼성전자",
      currency: "KRW",
      status: "ready",
      lastPrice: "74200",
      referencePrice: "72000",
      sparkline: [70100, 71400, 70800, 72900, 73600, 74200],
      viewMode: "chart",
    },
  },
  {
    label: "미국 하락 · 시세",
    view: {
      symbol: "NVDA",
      name: "NVIDIA Corporation",
      currency: "USD",
      status: "ready",
      lastPrice: "178.25",
      referencePrice: "182.70",
      highPrice: "184.10",
      lowPrice: "176.35",
      viewMode: "detail",
      colorTheme: "global",
    },
  },
  {
    label: "긴 가격 · 시세",
    view: {
      symbol: "207940",
      name: "삼성바이오로직스",
      currency: "KRW",
      status: "ready",
      lastPrice: "1034000",
      referencePrice: "1002000",
      highPrice: "1041000",
      lowPrice: "998000",
      viewMode: "detail",
    },
  },
  {
    label: "최근 시세 지연",
    view: {
      symbol: "AAPL",
      name: "Apple",
      currency: "USD",
      status: "stale",
      lastPrice: "185.70",
      referencePrice: "180.00",
      sparkline: [180, 182, 181, 184, 185.7],
      viewMode: "chart",
    },
  },
  {
    label: "인증 필요",
    view: {
      symbol: "",
      name: "TossInvest",
      currency: "",
      status: "auth-required",
    },
  },
  {
    label: "종목 오류",
    view: {
      symbol: "INVALID",
      name: "INVALID",
      currency: "USD",
      status: "invalid-symbol",
    },
  },
  {
    label: "긴 미국 종목명 · 차트",
    view: {
      symbol: "DELL",
      name: "델 테크놀로지스",
      currency: "USD",
      status: "ready",
      lastPrice: "522.6",
      referencePrice: "516.39",
      sparkline: [510, 514, 512, 518, 520, 522.6],
      viewMode: "chart",
      colorTheme: "global",
      market: "US",
    },
  },
  {
    label: "미국 하락 · 시세 · 오프라인",
    view: {
      symbol: "TSLA",
      name: "테슬라",
      currency: "USD",
      status: "ready",
      lastPrice: "352.9",
      referencePrice: "376.37",
      highPrice: "364.69",
      lowPrice: "351.32",
      viewMode: "detail",
      live: false,
    },
  },
  {
    label: "호재 · 상한가",
    view: {
      symbol: "005930",
      name: "삼성전자",
      market: "KR",
      currency: "KRW",
      status: "ready",
      lastPrice: "93600",
      referencePrice: "72000",
      signal: {
        kind: "upper-limit",
        label: "상한가",
        sentiment: "bullish",
        price: "93600",
        at: "2026-09-07T01:05:00Z",
      },
    },
  },
  {
    label: "악재 · 이평선 이탈",
    view: {
      symbol: "NVDA",
      name: "NVIDIA Corporation",
      market: "US",
      currency: "USD",
      status: "ready",
      colorTheme: "global",
      lastPrice: "168.4",
      referencePrice: "182.7",
      signal: {
        kind: "ma-break-down",
        label: "60일선 이탈",
        sentiment: "bearish",
        price: "168.4",
        at: "2026-09-07T01:05:00Z",
      },
    },
  },
];

test("144px 원본과 96px·72px 축소 카드가 안정적으로 보인다", async ({ page }) => {
  const sizes = [144, 96, 72] as const;
  const sections = sizes
    .map(
      (size) => `
        <section>
          <h2>${size}px</h2>
          <div class="cards">
            ${fixtures
              .map(
                ({ label, view }) => `
                  <figure>
                    <img src="${svgToDataUri(renderQuoteCard(view))}" width="${size}" height="${size}" alt="${label}">
                    <figcaption>${label}</figcaption>
                  </figure>`,
              )
              .join("")}
          </div>
        </section>`,
    )
    .join("");

  await page.setViewportSize({ width: 1240, height: 900 });
  await page.setContent(`<!doctype html>
    <html lang="ko">
      <style>
        * { box-sizing: border-box; }
        body { margin: 0; padding: 24px; color: #f2f4f6; background: #0d0e11; font: 14px Arial, sans-serif; line-height: 1.2; }
        section { margin-bottom: 24px; }
        h2 { height: 22px; margin: 0 0 10px; font-size: 18px; line-height: 22px; }
        .cards { display: flex; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
        figure { width: 130px; margin: 0; display: grid; grid-template-rows: auto 28px; justify-items: center; gap: 7px; }
        img { display: block; border-radius: 12px; image-rendering: auto; }
        figcaption { height: 28px; color: #b0b8c1; font-size: 12px; line-height: 14px; text-align: center; }
      </style>
      <body>${sections}</body>
    </html>`);

  await expect(page).toHaveScreenshot("key-card-size-matrix.png", {
    fullPage: true,
  });
});
