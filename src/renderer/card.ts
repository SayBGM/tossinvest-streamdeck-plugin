import type { ColorTheme, QuoteView, Signal, ViewMode } from "../types.js";

const WIDTH = 144;
const HEIGHT = 144;
/** Horizontal padding. Keys are physically 72px on the original Stream Deck, so every unit here is half a device pixel. */
const PAD = 10;
const CONTENT_WIDTH = WIDTH - PAD * 2;
const FONT_FAMILY =
  "-apple-system,BlinkMacSystemFont,'Pretendard','Segoe UI',sans-serif";

const COLORS = {
  bg: "#101013",
  text: "#F2F4F6",
  price: "#FFFFFF",
  muted: "#A9B2BD",
  dim: "#6B7684",
  amber: "#FFB020",
  green: "#00C073",
  blue: "#3182F6",
  red: "#F04452",
  gray: "#8B95A1",
} as const;

export const THEME_COLORS = {
  kr: { up: COLORS.red, down: COLORS.blue, flat: COLORS.gray },
  global: { up: COLORS.green, down: COLORS.red, flat: COLORS.gray },
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

function currencyPrefix(currency: string, showSymbol: boolean): string {
  if (!showSymbol) return "";
  if (currency === "KRW") return "₩";
  if (currency === "USD") return "$";
  return "";
}

function formatNumber(
  value: number,
  currency: string,
  fractionDigits?: number,
): string {
  const maximumFractionDigits =
    fractionDigits ?? (currency === "KRW" ? 0 : value >= 1 ? 2 : 4);
  const minimumFractionDigits = Math.min(
    maximumFractionDigits,
    fractionDigits ?? (currency === "USD" ? 2 : 0),
  );
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits,
    minimumFractionDigits,
  }).format(value);
}

export function formatPrice(
  value: string | number | undefined,
  currency: string,
  showSymbol = true,
): string {
  const parsed = numberValue(value);
  if (parsed === undefined) return "—";
  const formatted = formatNumber(parsed, currency);
  if (!showSymbol) return formatted;
  if (currency === "KRW") return `₩${formatted}`;
  if (currency === "USD") return `$${formatted}`;
  return `${formatted} ${currency}`;
}

export function formatCompactPrice(
  value: string | number | undefined,
  currency: string,
  showSymbol: boolean,
): string | undefined {
  const parsed = numberValue(value);
  if (parsed === undefined) return undefined;
  const absolute = Math.abs(parsed);
  const suffixes =
    currency === "KRW"
      ? ([
          [1e12, "조"],
          [1e8, "억"],
          [1e4, "만"],
        ] as const)
      : ([
          [1e12, "T"],
          [1e9, "B"],
          [1e6, "M"],
          [1e3, "K"],
        ] as const);
  const unit = suffixes.find(([threshold]) => absolute >= threshold);
  if (!unit) return undefined;
  const amount = (parsed / unit[0]).toFixed(2).replace(/\.?0+$/, "");
  return `${currencyPrefix(currency, showSymbol)}${amount}${unit[1]}`;
}

export function formatSigned(
  value: number | undefined,
  currency: string,
  showSymbol = true,
): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  const formatted = formatNumber(Math.abs(value), currency);
  return `${sign}${currencyPrefix(currency, showSymbol)}${formatted}`;
}

/**
 * Progressively shorter renderings of one price. Tier 0 is the full text and
 * every later tier trades detail for width so the font can stay large:
 * 0 full · 1 no currency symbol · 2 one decimal · 3 no decimals · 4 compact.
 */
export const PRICE_TIER_COUNT = 5;

export function formatPriceTier(
  value: string | number | undefined,
  currency: string,
  showSymbol: boolean,
  tier: number,
): string {
  const parsed = numberValue(value);
  if (parsed === undefined) return "—";
  // KRW has no decimals, so the decimal-reduction tiers are the same as tier 1.
  if (currency === "KRW" && tier > 1 && tier < PRICE_TIER_COUNT - 1) tier = 1;
  if (tier <= 0) return formatPrice(parsed, currency, showSymbol);
  if (tier === 1) return formatNumber(parsed, currency);
  if (tier === 2)
    return formatNumber(parsed, currency, Math.abs(parsed) >= 1 ? 1 : 3);
  if (tier === 3) return formatNumber(parsed, currency, Math.abs(parsed) >= 1 ? 0 : 2);
  return (
    formatCompactPrice(parsed, currency, false) ??
    formatNumber(parsed, currency, Math.abs(parsed) >= 1 ? 0 : 2)
  );
}

export type Direction = "up" | "down" | "flat";

export function quoteMetrics(view: QuoteView): {
  change?: number;
  rate?: number;
  color: string;
  direction: Direction;
} {
  const theme: ColorTheme = view.colorTheme === "global" ? "global" : "kr";
  const palette = THEME_COLORS[theme];
  const last = numberValue(view.lastPrice);
  const reference = numberValue(view.referencePrice);

  if (last === undefined || reference === undefined || reference === 0) {
    return { color: palette.flat, direction: "flat" };
  }

  const change = last - reference;
  const rate = (change / reference) * 100;
  if (change > 0) return { change, rate, color: palette.up, direction: "up" };
  if (change < 0)
    return { change, rate, color: palette.down, direction: "down" };
  return { change: 0, rate: 0, color: palette.flat, direction: "flat" };
}

/**
 * Advance width of one glyph in em for a bold UI sans-serif (SF, Segoe UI,
 * Pretendard). Values are deliberately on the wide side: a slightly smaller
 * font is harmless, an overflowing price is clipped on the device.
 */
function charWidthEm(ch: string): number {
  const code = ch.codePointAt(0) ?? 0;
  if (ch >= "0" && ch <= "9") return 0.62;
  if (ch === "," || ch === ".") return 0.3;
  if (ch === " ") return 0.28;
  if (ch === "₩") return 0.95;
  if (ch === "$") return 0.62;
  if (ch === "+" || ch === "−" || ch === "-") return 0.65;
  if (ch === "%") return 0.95;
  if (ch === "…") return 1.0;
  if (ch >= "A" && ch <= "Z") return 0.7;
  if (ch >= "a" && ch <= "z") return 0.56;
  if (code >= 0x1100 && code <= 0x11ff) return 1.0;
  if (code >= 0x2e80) return 1.0;
  return 0.8;
}

export function measureText(text: string, fontSize: number): number {
  let em = 0;
  for (const ch of text) em += charWidthEm(ch);
  return em * fontSize;
}

export interface FittedText {
  readonly text: string;
  readonly fontSize: number;
  readonly width: number;
}

/** Greedy word wrap; the last permitted line is truncated with an ellipsis. */
export function wrapLines(
  text: string,
  maxWidth: number,
  fontSize: number,
  maxLines: number,
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let index = 0;
  while (index < words.length && lines.length < maxLines) {
    let line = words[index]!;
    index += 1;
    while (
      index < words.length &&
      measureText(`${line} ${words[index]}`, fontSize) <= maxWidth
    ) {
      line = `${line} ${words[index]}`;
      index += 1;
    }
    lines.push(line);
  }
  // Leftover words fold into the last line so the ellipsis shows something was cut.
  if (index < words.length && lines.length > 0) {
    lines[lines.length - 1] = `${lines[lines.length - 1]} ${words.slice(index).join(" ")}`;
  }
  return lines.map((line) => truncateToWidth(line, maxWidth, fontSize));
}

function truncateToWidth(text: string, maxWidth: number, fontSize: number): string {
  if (measureText(text, fontSize) <= maxWidth) return text;
  const chars = [...text];
  while (chars.length > 0) {
    chars.pop();
    const candidate = `${chars.join("").trimEnd()}…`;
    if (measureText(candidate, fontSize) <= maxWidth) return candidate;
  }
  return "…";
}

/**
 * Picks the first candidate that fits at or above `minFont`, using the largest
 * font that fits it. Never relies on `textLength`: the Stream Deck renderer
 * would either squeeze glyphs or ignore it, and both look wrong.
 */
export function fitCandidates(
  candidates: readonly string[],
  maxWidth: number,
  maxFont: number,
  minFont: number,
): FittedText {
  const floor = Math.max(1, Math.floor(minFont));
  for (const text of candidates) {
    for (let fontSize = Math.floor(maxFont); fontSize >= floor; fontSize -= 1) {
      const width = measureText(text, fontSize);
      if (width <= maxWidth) return { text, fontSize, width };
    }
  }
  const last = candidates[candidates.length - 1] ?? "";
  const text = truncateToWidth(last, maxWidth, floor);
  return { text, fontSize: floor, width: measureText(text, floor) };
}

interface PriceFit {
  readonly tier: number;
  readonly fontSize: number;
}

/**
 * Chooses one tier + font for a group of related prices so the layout does
 * not jump when a tick crosses a digit boundary (99,900 → 100,000).
 */
export function fitPriceGroup(
  values: ReadonlyArray<string | number | undefined>,
  currency: string,
  showSymbol: boolean,
  maxWidth: number,
  maxFont: number,
  minFont: number,
): PriceFit {
  const present = values.filter((value) => numberValue(value) !== undefined);
  const firstTier = showSymbol ? 0 : 1;
  for (let tier = firstTier; tier < PRICE_TIER_COUNT; tier += 1) {
    for (let fontSize = Math.floor(maxFont); fontSize >= minFont; fontSize -= 1) {
      const fits = present.every(
        (value) =>
          measureText(formatPriceTier(value, currency, showSymbol, tier), fontSize) <=
          maxWidth,
      );
      if (fits) return { tier, fontSize };
    }
  }
  return { tier: PRICE_TIER_COUNT - 1, fontSize: minFont };
}

/** Like fitPriceGroup, but the two values share one line so their widths add up. */
function fitPricePair(
  left: string | number | undefined,
  right: string | number | undefined,
  currency: string,
  showSymbol: boolean,
  maxWidth: number,
  maxFont: number,
  minFont: number,
): PriceFit {
  const firstTier = showSymbol ? 0 : 1;
  for (let tier = firstTier; tier < PRICE_TIER_COUNT; tier += 1) {
    for (let fontSize = Math.floor(maxFont); fontSize >= minFont; fontSize -= 1) {
      const width =
        measureText(formatPriceTier(left, currency, showSymbol, tier), fontSize) +
        measureText(formatPriceTier(right, currency, showSymbol, tier), fontSize);
      if (width <= maxWidth) return { tier, fontSize };
    }
  }
  return { tier: PRICE_TIER_COUNT - 1, fontSize: minFont };
}

function textNode(
  text: string,
  x: number,
  y: number,
  fontSize: number,
  fill: string,
  weight: number,
  anchor: "start" | "end" | "middle" = "start",
  fillOpacity?: number,
): string {
  const opacityAttr = fillOpacity === undefined ? "" : ` fill-opacity="${fillOpacity}"`;
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" fill="${fill}" font-size="${fontSize}" font-weight="${weight}" font-family="${FONT_FAMILY}"${opacityAttr}>${escapeXml(text)}</text>`;
}

function directionIcon(
  direction: Direction,
  x: number,
  baseline: number,
  fontSize: number,
  color: string,
): { readonly svg: string; readonly width: number } {
  const w = Math.round(fontSize * ICON_WIDTH_EM * 10) / 10;
  const h = Math.round(fontSize * 0.46 * 10) / 10;
  const cy = baseline - fontSize * 0.34;
  const top = Math.round((cy - h / 2) * 10) / 10;
  const bottom = Math.round((cy + h / 2) * 10) / 10;
  const mid = Math.round((x + w / 2) * 10) / 10;
  let svg: string;
  if (direction === "up") {
    svg = `<path d="M ${x} ${bottom} L ${x + w} ${bottom} L ${mid} ${top} Z" fill="${color}"/>`;
  } else if (direction === "down") {
    svg = `<path d="M ${x} ${top} L ${x + w} ${top} L ${mid} ${bottom} Z" fill="${color}"/>`;
  } else {
    const barH = Math.max(2, Math.round(fontSize * 0.14));
    svg = `<rect x="${x}" y="${Math.round((cy - barH / 2) * 10) / 10}" width="${w}" height="${barH}" rx="1" fill="${color}"/>`;
  }
  return { svg, width: w + fontSize * ICON_GAP_EM };
}

const ICON_WIDTH_EM = 0.55;
const ICON_GAP_EM = 0.22;
const CHANGE_GAP_EM = 0.35;

/**
 * One line, one font size: [icon] 3.06%  +2,200. The rate is the primary
 * figure; the absolute change is dropped before the font is shrunk below the
 * readable floor.
 */
function renderChangeRow(
  view: QuoteView,
  metrics: ReturnType<typeof quoteMetrics>,
  baseline: number,
  maxFont: number,
  minFont: number,
): string {
  if (metrics.rate === undefined) {
    return textNode("—", PAD, baseline, maxFont, COLORS.gray, 700);
  }
  const rateText = `${Math.abs(metrics.rate).toFixed(2)}%`;
  const changeText = formatSigned(metrics.change, view.currency, false);
  const gap = (fontSize: number) => fontSize * CHANGE_GAP_EM;
  const iconWidth = (fontSize: number) =>
    fontSize * ICON_WIDTH_EM + fontSize * ICON_GAP_EM;

  let fontSize = minFont;
  let showChange = false;
  // A flat quote has nothing to add beyond 0.00%.
  const wantChange = metrics.direction !== "flat";
  for (let size = Math.floor(maxFont); wantChange && size >= minFont; size -= 1) {
    const width =
      iconWidth(size) +
      measureText(rateText, size) +
      gap(size) +
      measureText(changeText, size);
    if (width <= CONTENT_WIDTH) {
      fontSize = size;
      showChange = true;
      break;
    }
  }
  if (!showChange) {
    const rateOnly = fitCandidates([rateText], CONTENT_WIDTH - iconWidth(minFont), maxFont, minFont);
    fontSize = rateOnly.fontSize;
  }

  const icon = directionIcon(metrics.direction, PAD, baseline, fontSize, metrics.color);
  const rateX = Math.round((PAD + icon.width) * 10) / 10;
  const parts = [icon.svg, textNode(rateText, rateX, baseline, fontSize, metrics.color, 700)];
  if (showChange) {
    const changeX =
      Math.round((rateX + measureText(rateText, fontSize) + gap(fontSize)) * 10) / 10;
    parts.push(textNode(changeText, changeX, baseline, fontSize, metrics.color, 700));
  }
  return parts.join("\n  ");
}

function isUsMarket(view: QuoteView): boolean {
  return view.market === "US" || view.currency === "USD";
}

/**
 * Name at 20–18px; a US ticker is preferred over a shrunken or truncated name
 * ("델 테크놀…" says nothing, "DELL" does). KR codes are not meaningful, so a
 * long KR name is measured and truncated instead.
 */
function fitTitle(view: QuoteView, maxWidth: number): FittedText {
  const name = (view.name || view.symbol || "TossInvest").trim();
  const symbol = (view.symbol || "").trim();
  const preferred = fitCandidates([name], maxWidth, 20, 18);
  if (preferred.text === name) return preferred;
  if (isUsMarket(view) && symbol) {
    const ticker = fitCandidates([symbol], maxWidth, 20, 18);
    if (ticker.text === symbol) return ticker;
  }
  const small = fitCandidates([name], maxWidth, 17, 16);
  return small;
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
    <path d="${pathD}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${lastCoord.x}" cy="${lastCoord.y}" r="2.6" fill="${color}"/>
  `;
}

function svgDocument(body: string, bg: string = COLORS.bg): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" rx="18" fill="${bg}"/>
  ${body}
</svg>`;
}

function renderStatusScreen(view: QuoteView): string {
  let title = "알림";
  let subtitle = view.message ?? "";
  let iconSvg = "";

  switch (view.status) {
    case "auth-required":
      title = "API 키 설정 필요";
      subtitle = subtitle || "설정창에서 API 키 입력";
      iconSvg = `
        <rect x="61" y="34" width="22" height="17" rx="3.5" fill="${COLORS.dim}"/>
        <path d="M65 34 V28 A7 7 0 0 1 79 28 V34" fill="none" stroke="${COLORS.dim}" stroke-width="3" stroke-linecap="round"/>
      `;
      break;
    case "connecting":
      title = "시세 연결 중…";
      subtitle = subtitle || "토스증권 Open API";
      iconSvg = `
        <circle cx="56" cy="40" r="4.5" fill="${COLORS.blue}"/>
        <circle cx="72" cy="40" r="4.5" fill="${COLORS.blue}" opacity="0.6"/>
        <circle cx="88" cy="40" r="4.5" fill="${COLORS.blue}" opacity="0.3"/>
      `;
      break;
    case "invalid-symbol":
      title = "종목 확인 필요";
      subtitle = subtitle || "코드 또는 티커 재입력";
      iconSvg = `
        <circle cx="68" cy="38" r="11" fill="none" stroke="${COLORS.red}" stroke-width="3"/>
        <line x1="76" y1="46" x2="84" y2="54" stroke="${COLORS.red}" stroke-width="3" stroke-linecap="round"/>
        <line x1="64" y1="34" x2="72" y2="42" stroke="${COLORS.red}" stroke-width="2.5" stroke-linecap="round"/>
        <line x1="72" y1="34" x2="64" y2="42" stroke="${COLORS.red}" stroke-width="2.5" stroke-linecap="round"/>
      `;
      break;
    case "no-data":
      title = "시세 없음";
      subtitle = subtitle || "거래 데이터 대기";
      iconSvg = `
        <circle cx="72" cy="40" r="12" fill="none" stroke="${COLORS.gray}" stroke-width="2.5"/>
        <polyline points="72,33 72,40 77,44" fill="none" stroke="${COLORS.gray}" stroke-width="2.5" stroke-linecap="round"/>
      `;
      break;
    case "stale":
      title = "지연 시세";
      subtitle = subtitle || "최근 시세 유지";
      iconSvg = `
        <path d="M59 44 A14 14 0 1 1 85 44" fill="none" stroke="${COLORS.gray}" stroke-width="2.5" stroke-linecap="round"/>
        <polyline points="81,41 85,45 89,41" fill="none" stroke="${COLORS.gray}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      `;
      break;
  }

  const titleFit = fitCandidates([title], CONTENT_WIDTH, 18, 14);
  const subtitleFont = 15;
  const lines = wrapLines(subtitle, CONTENT_WIDTH, subtitleFont, 2);
  const firstBaseline = lines.length > 1 ? 100 : 103;
  const subtitleNodes = lines
    .map((line, index) =>
      textNode(line, WIDTH / 2, firstBaseline + index * 19, subtitleFont, COLORS.muted, 500, "middle"),
    )
    .join("\n  ");

  return svgDocument(`<g>${iconSvg}</g>
  ${textNode(titleFit.text, WIDTH / 2, 78, titleFit.fontSize, COLORS.text, 700, "middle")}
  ${subtitleNodes}
  <circle cx="134" cy="21" r="3" fill="${COLORS.dim}"/>`);
}

const TITLE_BASELINE = 26;
const PRICE_BASELINE = 66;
const CHANGE_BASELINE = 90;
const DOT_X = 134;
const DOT_Y = 21;
/** Title text must stay clear of the status dot at the top-right corner. */
const TITLE_MAX_WIDTH = DOT_X - 3 - 6 - PAD;

const SIGNAL_LABEL_BASELINE = 78;
const SIGNAL_PRICE_BASELINE = 122;
/** Icon reservation sized to the label row's max font (30px); the icon drawn
 * at a smaller fitted font is always narrower than this, so the label never
 * overflows the content width. */
const SIGNAL_ICON_RESERVE = 30 * ICON_WIDTH_EM + 30 * ICON_GAP_EM;

/**
 * Full-bleed alert screen shown while a signal (rate move, limit hit, moving
 * average cross) is active for this symbol. Wins over every other card mode.
 */
function renderSignalCard(view: QuoteView, signal: Signal): string {
  const theme: ColorTheme = view.colorTheme === "global" ? "global" : "kr";
  const palette = THEME_COLORS[theme];
  const bg = signal.sentiment === "bullish" ? palette.up : palette.down;
  const showSymbol = view.showCurrencySymbol !== false;
  const white = "#FFFFFF";

  const title = fitTitle(view, CONTENT_WIDTH);
  const titleNode = textNode(
    title.text,
    PAD,
    TITLE_BASELINE,
    title.fontSize,
    white,
    700,
    "start",
    0.85,
  );

  const direction: Direction = signal.sentiment === "bullish" ? "up" : "down";
  const labelFit = fitCandidates(
    [signal.label],
    CONTENT_WIDTH - SIGNAL_ICON_RESERVE,
    30,
    18,
  );
  const icon = directionIcon(direction, PAD, SIGNAL_LABEL_BASELINE, labelFit.fontSize, white);
  const labelX = Math.round((PAD + icon.width) * 10) / 10;
  const labelNode = textNode(labelFit.text, labelX, SIGNAL_LABEL_BASELINE, labelFit.fontSize, white, 800);

  const priceFit = fitPriceGroup(
    [view.lastPrice],
    view.currency,
    showSymbol,
    CONTENT_WIDTH,
    28,
    18,
  );
  const priceText = formatPriceTier(view.lastPrice, view.currency, showSymbol, priceFit.tier);
  const priceNode = textNode(priceText, PAD, SIGNAL_PRICE_BASELINE, priceFit.fontSize, white, 800);

  return svgDocument(
    `${titleNode}
  ${icon.svg}
  ${labelNode}
  ${priceNode}`,
    bg,
  );
}

export function renderQuoteCard(view: QuoteView): string {
  if (view.signal) {
    return renderSignalCard(view, view.signal);
  }
  const delayed =
    view.status === "stale" && numberValue(view.lastPrice) !== undefined;
  if (view.status !== "ready" && !delayed) {
    return renderStatusScreen(view);
  }

  const metrics = quoteMetrics(view);
  const showSymbol = view.showCurrencySymbol !== false;
  const viewMode: ViewMode = view.viewMode || "chart";
  const showChart = view.showChart !== false;
  const dotColor =
    view.refreshing || delayed
      ? COLORS.amber
      : view.live === false
        ? COLORS.dim
        : COLORS.green;

  const priceFit = fitPriceGroup(
    [view.lastPrice, view.referencePrice, view.highPrice, view.lowPrice],
    view.currency,
    showSymbol,
    CONTENT_WIDTH,
    40,
    24,
  );
  const priceText = formatPriceTier(
    view.lastPrice,
    view.currency,
    showSymbol,
    priceFit.tier,
  );
  const changeRow = renderChangeRow(view, metrics, CHANGE_BASELINE, 22, 16);
  const dot = `<circle cx="${DOT_X}" cy="${DOT_Y}" r="3" fill="${dotColor}"/>`;

  // 1. 차트 모드: 종목명 / 현재가 / 등락률·등락액 / 스파크라인
  if (viewMode === "chart") {
    const title = fitTitle(view, TITLE_MAX_WIDTH);
    const sparklineSvg =
      showChart && view.sparkline && view.sparkline.length >= 2
        ? renderSparkline(view.sparkline, metrics.color, CONTENT_WIDTH, 32, PAD, 98)
        : "";

    return svgDocument(`${textNode(title.text, PAD, TITLE_BASELINE, title.fontSize, COLORS.text, 700)}
  ${textNode(priceText, PAD, PRICE_BASELINE, priceFit.fontSize, COLORS.price, 800)}
  ${changeRow}
  ${sparklineSvg}
  ${dot}`);
  }

  // 2. 시세 모드: 종목명+티커 / 현재가 / 등락률·등락액 / 고가·저가 두 줄
  const title = fitTitle(view, TITLE_MAX_WIDTH);
  const symbol = (view.symbol || "").trim();
  const tickerFont = 16;
  const tickerWidth = measureText(symbol, tickerFont);
  const showTicker =
    symbol.length > 0 &&
    symbol !== title.text &&
    title.width + 8 + tickerWidth <= TITLE_MAX_WIDTH;
  const tickerNode = showTicker
    ? textNode(symbol, PAD + TITLE_MAX_WIDTH, TITLE_BASELINE, tickerFont, COLORS.muted, 600, "end")
    : "";

  return svgDocument(`${textNode(title.text, PAD, TITLE_BASELINE, title.fontSize, COLORS.text, 700)}
  ${tickerNode}
  ${textNode(priceText, PAD, PRICE_BASELINE, priceFit.fontSize, COLORS.price, 800)}
  ${changeRow}
  ${renderDayRange(view, metrics.color)}
  ${dot}`);
}

const RANGE_LABEL_BASELINE = 107;
const RANGE_BAR_Y = 113;
const RANGE_BAR_HEIGHT = 4;
const RANGE_VALUE_BASELINE = 136;

/**
 * Day range: 저 ──●── 고. The marker shows where the last price sits between
 * today's low and high; the two values sit under the bar ends.
 */
function renderDayRange(view: QuoteView, accent: string): string {
  const low = numberValue(view.lowPrice);
  const high = numberValue(view.highPrice);
  const last = numberValue(view.lastPrice);
  const labelFont = 14;
  const gap = 8;
  // The price line already carries the currency, so the range values never repeat it.
  const valueFit = fitPricePair(
    view.lowPrice,
    view.highPrice,
    view.currency,
    false,
    CONTENT_WIDTH - gap,
    16,
    14,
  );
  const value = (raw: string | undefined) =>
    numberValue(raw) === undefined
      ? "—"
      : formatPriceTier(raw, view.currency, false, valueFit.tier);

  const trackX = PAD;
  const trackWidth = CONTENT_WIDTH;
  const ratio =
    low !== undefined && high !== undefined && last !== undefined && high > low
      ? Math.min(1, Math.max(0, (last - low) / (high - low)))
      : undefined;
  const markerX = Math.round((trackX + (ratio ?? 0.5) * trackWidth) * 10) / 10;
  const fillWidth = Math.round((markerX - trackX) * 10) / 10;

  const parts = [
    textNode("저", PAD, RANGE_LABEL_BASELINE, labelFont, COLORS.muted, 600),
    textNode("고", WIDTH - PAD, RANGE_LABEL_BASELINE, labelFont, COLORS.muted, 600, "end"),
    `<rect x="${trackX}" y="${RANGE_BAR_Y}" width="${trackWidth}" height="${RANGE_BAR_HEIGHT}" rx="2" fill="#2A2D35"/>`,
  ];
  if (ratio !== undefined) {
    parts.push(
      `<rect x="${trackX}" y="${RANGE_BAR_Y}" width="${Math.max(RANGE_BAR_HEIGHT, fillWidth)}" height="${RANGE_BAR_HEIGHT}" rx="2" fill="${accent}" opacity="0.55"/>`,
      `<circle cx="${markerX}" cy="${RANGE_BAR_Y + RANGE_BAR_HEIGHT / 2}" r="4" fill="${accent}" stroke="${COLORS.bg}" stroke-width="1.5"/>`,
    );
  }
  parts.push(
    textNode(value(view.lowPrice), PAD, RANGE_VALUE_BASELINE, valueFit.fontSize, COLORS.text, 700),
    textNode(value(view.highPrice), WIDTH - PAD, RANGE_VALUE_BASELINE, valueFit.fontSize, COLORS.text, 700, "end"),
  );
  return parts.join("\n  ");
}

export function svgToDataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
