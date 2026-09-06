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
      symbol: "LONG",
      name: "아주긴종목이름테스트",
      currency: "KRW",
      status: "ready",
      lastPrice: "1234567890123",
      referencePrice: "1234567000000",
      highPrice: "1234567999999",
      lowPrice: "1234000000000",
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

  await page.setViewportSize({ width: 1040, height: 900 });
  await page.setContent(`<!doctype html>
    <html lang="ko">
      <style>
        * { box-sizing: border-box; }
        body { margin: 0; padding: 24px; color: #f2f4f6; background: #0d0e11; font: 14px Arial, sans-serif; }
        section { margin-bottom: 24px; }
        h2 { margin: 0 0 10px; font-size: 18px; }
        .cards { display: flex; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
        figure { width: 150px; margin: 0; display: grid; justify-items: center; gap: 7px; }
        img { display: block; border-radius: 12px; image-rendering: auto; }
        figcaption { color: #b0b8c1; font-size: 12px; text-align: center; }
      </style>
      <body>${sections}</body>
    </html>`);

  await expect(page).toHaveScreenshot("key-card-size-matrix.png", {
    fullPage: true,
  });
});
