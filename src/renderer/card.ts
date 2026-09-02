import type { QuoteView } from "../types.js";

const WIDTH = 144;
const HEIGHT = 144;
const COLORS = { up: "#ff1744", down: "#2979ff", flat: "#9e9e9e" } as const;

function escapeXml(value: string): string {
  return value.replace(/[<>&'\"]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", "\"": "&quot;" })[char] ?? char);
}

function numberValue(value: string | undefined): number | undefined {
  if (value === undefined || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())) return undefined;
  const result = Number(value);
  return Number.isFinite(result) ? result : undefined;
}

function formatPrice(value: string | undefined, currency: string): string {
  const parsed = numberValue(value);
  if (parsed === undefined) return "—";
  const maximumFractionDigits = currency === "KRW" ? 0 : parsed >= 1 ? 2 : 4;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits, minimumFractionDigits: currency === "USD" ? 2 : 0 }).format(parsed);
}

function formatSigned(value: number | undefined, currency: string): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${formatPrice(String(Math.abs(value)), currency)}`;
}

export function quoteMetrics(view: QuoteView): { change?: number; rate?: number; color: string } {
  const last = numberValue(view.lastPrice);
  const reference = numberValue(view.referencePrice);
  if (last === undefined || reference === undefined || reference === 0) return { color: COLORS.flat };
  const change = last - reference;
  return { change, rate: (change / reference) * 100, color: change > 0 ? COLORS.up : change < 0 ? COLORS.down : COLORS.flat };
}

export function renderQuoteCard(view: QuoteView): string {
  const metrics = quoteMetrics(view);
  const title = view.name || view.symbol || "TossInvest";
  const statusText = view.message ?? ({
    "auth-required": "API 인증 필요",
    connecting: "연결 중…",
    "invalid-symbol": "종목 확인 필요",
    "no-data": "시세 없음",
    stale: "오래된 시세",
    ready: "",
  } as const)[view.status];
  const price = view.status === "ready" ? formatPrice(view.lastPrice, view.currency) : statusText;
  const detail = view.status === "ready"
    ? `${formatSigned(metrics.change, view.currency)}  ${metrics.rate === undefined ? "—" : `${metrics.rate > 0 ? "+" : metrics.rate < 0 ? "−" : ""}${Math.abs(metrics.rate).toFixed(2)}%`}`
    : "토스증권 Open API";
  const symbol = view.symbol ? `${view.symbol} · ${view.currency}` : "TossInvest";
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">\n  <rect width="144" height="144" rx="18" fill="#191F28"/>\n  <text x="12" y="25" fill="#B0B8C1" font-size="13" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">${escapeXml(title.slice(0, 17))}</text>\n  <text x="12" y="43" fill="#8B95A1" font-size="9" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">${escapeXml(symbol.slice(0, 24))}</text>\n  <text x="12" y="82" fill="#FFFFFF" font-size="27" font-weight="700" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">${escapeXml(price)}</text>\n  <text x="12" y="106" fill="${metrics.color}" font-size="13" font-weight="600" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">${escapeXml(detail)}</text>\n  <circle cx="132" cy="126" r="4" fill="${view.status === "ready" ? "#20c997" : metrics.color}"/>\n</svg>`;
}

export function svgToDataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
