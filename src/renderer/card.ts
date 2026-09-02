import type { ColorTheme, QuoteView, ViewMode } from "../types.js";

const WIDTH = 144;
const HEIGHT = 144;

export const THEME_COLORS = {
  kr: { up: "#F04452", down: "#3182F6", flat: "#8B95A1" },
  global: { up: "#00C073", down: "#F04452", flat: "#8B95A1" },
} as const;

function escapeXml(value: string): string {
  return value.replace(
    /[<>&'\"]/g,
    (char) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        "'": "&apos;",
        '"': "&quot;",
      })[char] ?? char,
  );
}

export function numberValue(
  value: string | number | undefined,
): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number")
    return Number.isFinite(value) ? value : undefined;
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())) return undefined;
  const result = Number(value);
  return Number.isFinite(result) ? result : undefined;
}

export function formatPrice(
  value: string | number | undefined,
  currency: string,
  showSymbol = true,
): string {
  const parsed = numberValue(value);
  if (parsed === undefined) return "—";
  const maximumFractionDigits = currency === "KRW" ? 0 : parsed >= 1 ? 2 : 4;
  const minimumFractionDigits = currency === "USD" ? 2 : 0;
  const formatted = new Intl.NumberFormat("en-US", {
    maximumFractionDigits,
    minimumFractionDigits,
  }).format(parsed);

  if (!showSymbol) return formatted;
  if (currency === "KRW") return `₩${formatted}`;
  if (currency === "USD") return `$${formatted}`;
  return `${formatted} ${currency}`;
}

export function formatSigned(
  value: number | undefined,
  currency: string,
  showSymbol = true,
): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  const absValue = Math.abs(value);
  const formatted = formatPrice(absValue, currency, false);
  const prefix = showSymbol
    ? currency === "KRW"
      ? "₩"
      : currency === "USD"
        ? "$"
        : ""
    : "";
  return `${sign}${prefix}${formatted}`;
}

export function quoteMetrics(view: QuoteView): {
  change?: number;
  rate?: number;
  color: string;
  pillBg: string;
  arrow: string;
  sign: string;
} {
  const theme: ColorTheme = view.colorTheme === "global" ? "global" : "kr";
  const palette = THEME_COLORS[theme];
  const last = numberValue(view.lastPrice);
  const reference = numberValue(view.referencePrice);

  if (last === undefined || reference === undefined || reference === 0) {
    return {
      color: palette.flat,
      pillBg: "rgba(139, 149, 161, 0.16)",
      arrow: "—",
      sign: "",
    };
  }

  const change = last - reference;
  const rate = (change / reference) * 100;

  if (change > 0) {
    return {
      change,
      rate,
      color: palette.up,
      pillBg:
        theme === "global"
          ? "rgba(0, 192, 115, 0.16)"
          : "rgba(240, 68, 82, 0.16)",
      arrow: "▲",
      sign: "+",
    };
  }
  if (change < 0) {
    return {
      change,
      rate,
      color: palette.down,
      pillBg:
        theme === "global"
          ? "rgba(240, 68, 82, 0.16)"
          : "rgba(49, 130, 246, 0.16)",
      arrow: "▼",
      sign: "−",
    };
  }
  return {
    change: 0,
    rate: 0,
    color: palette.flat,
    pillBg: "rgba(139, 149, 161, 0.16)",
    arrow: "—",
    sign: "",
  };
}

function getPriceFontSize(
  text: string,
  hasSymbol: boolean,
  maxFont = 27,
  minFont = 18,
): number {
  let units = 0;
  for (const ch of text) {
    if (ch === "₩") units += 1.6;
    else if (ch === "$" || ch === "€") units += 1.1;
    else if (ch === "," || ch === ".") units += 0.45;
    else units += 1.0;
  }

  // When currency symbol is active, scale down by 2.5px to keep comfortable padding
  const symbolPenalty = hasSymbol ? 2.5 : 0;

  if (units <= 5.5) return Math.round(maxFont - symbolPenalty);
  if (units <= 7.0) return Math.round(maxFont - 2 - symbolPenalty);
  if (units <= 8.5) return Math.round(maxFont - 4 - symbolPenalty);
  if (units <= 10.5) return Math.round(Math.max(minFont, maxFont - 6 - symbolPenalty));
  return minFont;
}

function renderSparkline(
  points: readonly number[],
  color: string,
  width: number,
  height: number,
  startX: number,
  startY: number,
): string {
  if (points.length < 2) return "";
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;

  const coords = points.map((val, idx) => {
    const x = startX + (idx / (points.length - 1)) * width;
    const y = startY + height - ((val - min) / range) * (height - 6) - 3;
    return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
  });

  const pathD = coords
    .map((c, i) => `${i === 0 ? "M" : "L"} ${c.x} ${c.y}`)
    .join(" ");
  const lastCoord = coords[coords.length - 1]!;
  const firstCoord = coords[0]!;
  const bottomY = startY + height;
  const areaD = `${pathD} L ${lastCoord.x} ${bottomY} L ${firstCoord.x} ${bottomY} Z`;

  const gradId = `sparkGrad_${color.replace(/[^a-zA-Z0-9]/g, "")}`;

  return `
    <defs>
      <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity="0.36"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0.0"/>
      </linearGradient>
    </defs>
    <path d="${areaD}" fill="url(#${gradId})"/>
    <path d="${pathD}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${lastCoord.x}" cy="${lastCoord.y}" r="2.5" fill="${color}"/>
  `;
}

function renderStatusScreen(view: QuoteView): string {
  let title = "알림";
  let subtitle = view.message ?? "";
  let iconSvg = "";

  switch (view.status) {
    case "auth-required":
      title = "API 키 설정 필요";
      subtitle = subtitle || "설정창에서 Key 입력";
      iconSvg = `
        <rect x="61" y="34" width="22" height="17" rx="3.5" fill="#6B7684"/>
        <path d="M65 34 V28 A7 7 0 0 1 79 28 V34" fill="none" stroke="#6B7684" stroke-width="3" stroke-linecap="round"/>
      `;
      break;
    case "connecting":
      title = "시세 연결 중…";
      subtitle = subtitle || "토스증권 Open API";
      iconSvg = `
        <circle cx="56" cy="40" r="4.5" fill="#3182F6"/>
        <circle cx="72" cy="40" r="4.5" fill="#3182F6" opacity="0.6"/>
        <circle cx="88" cy="40" r="4.5" fill="#3182F6" opacity="0.3"/>
      `;
      break;
    case "invalid-symbol":
      title = "종목 확인 필요";
      subtitle = subtitle || "코드 또는 티커 재입력";
      iconSvg = `
        <circle cx="68" cy="38" r="11" fill="none" stroke="#F04452" stroke-width="3"/>
        <line x1="76" y1="46" x2="84" y2="54" stroke="#F04452" stroke-width="3" stroke-linecap="round"/>
        <line x1="64" y1="34" x2="72" y2="42" stroke="#F04452" stroke-width="2.5" stroke-linecap="round"/>
        <line x1="72" y1="34" x2="64" y2="42" stroke="#F04452" stroke-width="2.5" stroke-linecap="round"/>
      `;
      break;
    case "no-data":
      title = "시세 없음";
      subtitle = subtitle || "거래 데이터 대기";
      iconSvg = `
        <circle cx="72" cy="40" r="12" fill="none" stroke="#8B95A1" stroke-width="2.5"/>
        <polyline points="72,33 72,40 77,44" fill="none" stroke="#8B95A1" stroke-width="2.5" stroke-linecap="round"/>
      `;
      break;
    case "stale":
      title = "장 마감 / 지연";
      subtitle = subtitle || "최근 수신 시세 유지";
      iconSvg = `
        <path d="M59 44 A14 14 0 1 1 85 44" fill="none" stroke="#8B95A1" stroke-width="2.5" stroke-linecap="round"/>
        <polyline points="81,41 85,45 89,41" fill="none" stroke="#8B95A1" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      `;
      break;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" rx="18" fill="#101013"/>
  <rect x="0.5" y="0.5" width="143" height="143" rx="17.5" fill="none" stroke="#22242B"/>
  <g>${iconSvg}</g>
  <text x="72" y="78" text-anchor="middle" fill="#F2F4F6" font-size="13.5" font-weight="700" font-family="-apple-system,BlinkMacSystemFont,'Pretendard','Segoe UI',sans-serif">${escapeXml(title)}</text>
  <text x="72" y="100" text-anchor="middle" fill="#8B95A1" font-size="11" font-weight="500" font-family="-apple-system,BlinkMacSystemFont,'Pretendard','Segoe UI',sans-serif">${escapeXml(subtitle.slice(0, 18))}</text>
  <circle cx="132" cy="132" r="3" fill="#6B7684"/>
</svg>`;
}

export function renderQuoteCard(view: QuoteView): string {
  if (view.status !== "ready") {
    return renderStatusScreen(view);
  }

  const metrics = quoteMetrics(view);
  const title = view.name || view.symbol || "TossInvest";
  const symbol = view.symbol || "";
  const showSymbol = view.showCurrencySymbol !== false;
  const priceText = formatPrice(view.lastPrice, view.currency, showSymbol);
  const viewMode: ViewMode = view.viewMode || "chart";
  const showChart = view.showChart !== false;

  const rateText =
    metrics.rate !== undefined
      ? `${metrics.arrow} ${Math.abs(metrics.rate).toFixed(2)}%`
      : "—";

  const pillWidth = Math.max(50, Math.min(80, rateText.length * 7 + 14));
  const pillHeight = 20;
  const liveDotColor = view.refreshing ? "#FFB020" : "#00C073";
  const changeSigned = formatSigned(metrics.change, view.currency, showSymbol);

  const refText = view.referencePrice
    ? formatPrice(view.referencePrice, view.currency, showSymbol)
    : "—";

  function truncateDisplay(str: string, maxDisplayWidth: number): string {
    let width = 0;
    let result = "";
    for (const ch of str) {
      const charWidth = ch.charCodeAt(0) > 0x2e80 ? 2 : 1;
      if (width + charWidth > maxDisplayWidth) {
        return result + "…";
      }
      width += charWidth;
      result += ch;
    }
    return result;
  }

  // 1. 차트 모드 (chart): 상단 종목명+등락률 배지, 중앙 현재가+등락폭, 하단 와이드 스파크라인
  if (viewMode === "chart") {
    const fontSize = getPriceFontSize(priceText, showSymbol, 28, 20);
    const chartTitle = truncateDisplay(title, 9);
    const sparklineSvg =
      showChart && view.sparkline && view.sparkline.length >= 2
        ? renderSparkline(view.sparkline, metrics.color, 120, 42, 12, 86)
        : "";

    const bottomText =
      !showChart || !sparklineSvg
        ? `<text x="12" y="112" fill="#8B95A1" font-size="12" font-weight="600" font-family="-apple-system,BlinkMacSystemFont,'Pretendard','Segoe UI',sans-serif">변동 <tspan fill="${metrics.color}">${escapeXml(changeSigned)}</tspan></text>`
        : "";

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" rx="18" fill="#101013"/>
  <rect x="0.5" y="0.5" width="143" height="143" rx="17.5" fill="none" stroke="#22242B"/>
  <text x="12" y="24" fill="#F2F4F6" font-size="13" font-weight="700" font-family="-apple-system,BlinkMacSystemFont,'Pretendard','Segoe UI',sans-serif">${escapeXml(chartTitle)}</text>
  <g transform="translate(${132 - pillWidth}, 10)">
    <rect width="${pillWidth}" height="${pillHeight}" rx="5" fill="${metrics.pillBg}"/>
    <text x="${pillWidth / 2}" y="14" text-anchor="middle" fill="${metrics.color}" font-size="11" font-weight="700" font-family="-apple-system,BlinkMacSystemFont,'Pretendard','Segoe UI',sans-serif">${escapeXml(rateText)}</text>
  </g>
  <text x="12" y="55" fill="#FFFFFF" font-size="${fontSize}" font-weight="800" font-family="-apple-system,BlinkMacSystemFont,'Pretendard','Segoe UI',sans-serif">${escapeXml(priceText)}</text>
  <text x="12" y="73" fill="${metrics.color}" font-size="12" font-weight="700" font-family="-apple-system,BlinkMacSystemFont,'Pretendard','Segoe UI',sans-serif">${escapeXml(changeSigned)}</text>
  ${sparklineSvg}
  ${bottomText}
  <circle cx="132" cy="132" r="3" fill="${liveDotColor}"/>
</svg>`;
  }

  // 2. 시세 모드 (detail): 상단 종목명+티커, 중앙 현재가, 등락률/등락폭, 하단 1줄 당일 고가/저가
  const fontSize = getPriceFontSize(priceText, showSymbol, 29, 21);
  const highText = view.highPrice
    ? formatPrice(view.highPrice, view.currency, showSymbol)
    : undefined;
  const lowText = view.lowPrice
    ? formatPrice(view.lowPrice, view.currency, showSymbol)
    : undefined;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" rx="18" fill="#101013"/>
  <rect x="0.5" y="0.5" width="143" height="143" rx="17.5" fill="none" stroke="#22242B"/>
  <text x="12" y="24" fill="#F2F4F6" font-size="13" font-weight="700" font-family="-apple-system,BlinkMacSystemFont,'Pretendard','Segoe UI',sans-serif">${escapeXml(truncateDisplay(title, 11))}</text>
  <text x="132" y="24" text-anchor="end" fill="#8B95A1" font-size="11" font-weight="600" font-family="-apple-system,BlinkMacSystemFont,'Pretendard','Segoe UI',sans-serif">${escapeXml(symbol.slice(0, 6))}</text>
  <text x="12" y="58" fill="#FFFFFF" font-size="${fontSize}" font-weight="800" font-family="-apple-system,BlinkMacSystemFont,'Pretendard','Segoe UI',sans-serif">${escapeXml(priceText)}</text>
  <g transform="translate(12, 70)">
    <rect width="${pillWidth}" height="22" rx="5.5" fill="${metrics.pillBg}"/>
    <text x="${pillWidth / 2}" y="15" text-anchor="middle" fill="${metrics.color}" font-size="11.5" font-weight="700" font-family="-apple-system,BlinkMacSystemFont,'Pretendard','Segoe UI',sans-serif">${escapeXml(rateText)}</text>
  </g>
  <text x="132" y="86" text-anchor="end" fill="${metrics.color}" font-size="13" font-weight="700" font-family="-apple-system,BlinkMacSystemFont,'Pretendard','Segoe UI',sans-serif">${escapeXml(changeSigned)}</text>
  <line x1="12" y1="104" x2="132" y2="104" stroke="#22242B" stroke-width="1"/>
  <text x="12" y="124" fill="#8B95A1" font-size="10.5" font-weight="600" font-family="-apple-system,BlinkMacSystemFont,'Pretendard','Segoe UI',sans-serif">고 <tspan fill="#F2F4F6" font-weight="700">${escapeXml(highText || "—")}</tspan></text>
  <text x="126" y="124" text-anchor="end" fill="#8B95A1" font-size="10.5" font-weight="600" font-family="-apple-system,BlinkMacSystemFont,'Pretendard','Segoe UI',sans-serif">저 <tspan fill="#F2F4F6" font-weight="700">${escapeXml(lowText || "—")}</tspan></text>
  <circle cx="134" cy="120" r="2.5" fill="${liveDotColor}"/>
</svg>`;
}

export function svgToDataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
