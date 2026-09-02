import type {
  GlobalSettingsV1,
  KeyBehavior,
  QuoteActionSettingsV1,
  RenderMode,
} from "./types.js";

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
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
  const renderMode: RenderMode = source.renderMode === "economy" ? "economy" : "realtime";
  return {
    schemaVersion: 1,
    clientId: stringValue(source.clientId).trim(),
    clientSecret: stringValue(source.clientSecret).trim(),
    renderMode,
  };
}

export function migrateActionSettings(input: unknown): QuoteActionSettingsV1 {
  const source = record(input);
  const keyBehavior: KeyBehavior = source.keyBehavior === "open" || source.keyBehavior === "none"
    ? source.keyBehavior
    : "refresh";
  const market = source.market === "KR" || source.market === "US" ? source.market : undefined;
  return {
    schemaVersion: 1,
    symbol: normalizeSymbol(source.symbol),
    name: stringValue(source.name).trim(),
    ...(market ? { market } : {}),
    currency: stringValue(source.currency).trim().toUpperCase(),
    keyBehavior,
  };
}

export function settingsEqual(a: QuoteActionSettingsV1, b: QuoteActionSettingsV1): boolean {
  return a.schemaVersion === b.schemaVersion && a.symbol === b.symbol && a.name === b.name &&
    a.market === b.market && a.currency === b.currency && a.keyBehavior === b.keyBehavior;
}

export function credentialsConfigured(settings: GlobalSettingsV1): boolean {
  return settings.clientId.length > 0 && settings.clientSecret.length > 0;
}
