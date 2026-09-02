import type {
  ColorTheme,
  GlobalSettingsV1,
  KeyBehavior,
  QuoteActionSettingsV1,
  RenderMode,
  ViewMode,
} from "./types.js";

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function normalizeSymbol(value: unknown): string {
  const symbol = stringValue(value).trim().toUpperCase();
  return /^[A-Z0-9.-]{1,20}$/.test(symbol) ? symbol : "";
}

export function migrateGlobalSettings(input: unknown): GlobalSettingsV1 {
  const source = record(input);
  const renderMode: RenderMode =
    source.renderMode === "economy" ? "economy" : "realtime";
  return {
    schemaVersion: 1,
    clientId: stringValue(source.clientId).trim(),
    clientSecret: stringValue(source.clientSecret).trim(),
    renderMode,
  };
}

export function migrateActionSettings(input: unknown): QuoteActionSettingsV1 {
  const source = record(input);
  const keyBehavior: KeyBehavior =
    source.keyBehavior === "open" ||
    source.keyBehavior === "toggle-view" ||
    source.keyBehavior === "none"
      ? source.keyBehavior
      : "refresh";
  const market =
    source.market === "KR" || source.market === "US"
      ? source.market
      : undefined;
  const colorTheme: ColorTheme =
    source.colorTheme === "global" ? "global" : "kr";
  const showChart =
    typeof source.showChart === "boolean" ? source.showChart : true;
  const viewMode: ViewMode =
    source.viewMode === "detail" ||
    source.viewMode === "quote" ||
    source.viewMode === "compact"
      ? "detail"
      : "chart";
  const showCurrencySymbol =
    typeof source.showCurrencySymbol === "boolean"
      ? source.showCurrencySymbol
      : true;

  return {
    schemaVersion: 1,
    symbol: normalizeSymbol(source.symbol),
    name: stringValue(source.name).trim(),
    ...(market ? { market } : {}),
    currency: stringValue(source.currency).trim().toUpperCase(),
    keyBehavior,
    colorTheme,
    showChart,
    viewMode,
    showCurrencySymbol,
  };
}

export function settingsEqual(
  a: QuoteActionSettingsV1,
  b: QuoteActionSettingsV1,
): boolean {
  return (
    a.schemaVersion === b.schemaVersion &&
    a.symbol === b.symbol &&
    a.name === b.name &&
    a.market === b.market &&
    a.currency === b.currency &&
    a.keyBehavior === b.keyBehavior &&
    a.colorTheme === b.colorTheme &&
    a.showChart === b.showChart &&
    a.viewMode === b.viewMode &&
    a.showCurrencySymbol === b.showCurrencySymbol
  );
}

export function credentialsConfigured(settings: GlobalSettingsV1): boolean {
  return settings.clientId.length > 0 && settings.clientSecret.length > 0;
}
