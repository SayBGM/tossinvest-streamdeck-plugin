import { describe, expect, it } from "vitest";
import {
  credentialsConfigured,
  migrateActionSettings,
  migrateGlobalSettings,
  normalizeSymbol,
  settingsEqual,
} from "./settings.js";

describe("settings", () => {
  it("normalizes supported symbols and rejects URL punctuation", () => {
    expect(normalizeSymbol(" aapl ")).toBe("AAPL");
    expect(normalizeSymbol("005930")).toBe("005930");
    expect(normalizeSymbol("AAPL/order")).toBe("");
  });

  it("migrates unknown settings to safe defaults", () => {
    expect(
      migrateGlobalSettings({
        clientId: " c_1 ",
        clientSecret: " s_1 ",
        renderMode: "nope",
      }),
    ).toEqual({
      schemaVersion: 1,
      clientId: "c_1",
      clientSecret: "s_1",
      renderMode: "realtime",
    });
    expect(
      migrateActionSettings({ symbol: "aapl", keyBehavior: "open" }),
    ).toMatchObject({
      schemaVersion: 1,
      symbol: "AAPL",
      keyBehavior: "open",
      currency: "",
      colorTheme: "kr",
      showChart: true,
      viewMode: "chart",
      showCurrencySymbol: true,
    });
  });

  it("migrates new personalization options correctly", () => {
    const customized = migrateActionSettings({
      symbol: "005930",
      keyBehavior: "toggle-view",
      colorTheme: "global",
      showChart: false,
      viewMode: "detail",
      showCurrencySymbol: false,
    });
    expect(customized).toMatchObject({
      symbol: "005930",
      keyBehavior: "toggle-view",
      colorTheme: "global",
      showChart: false,
      viewMode: "detail",
      showCurrencySymbol: false,
    });
  });

  it("compares settings with settingsEqual", () => {
    const a = migrateActionSettings({
      symbol: "005930",
      keyBehavior: "refresh",
    });
    const b = migrateActionSettings({
      symbol: "005930",
      keyBehavior: "refresh",
    });
    const c = migrateActionSettings({
      symbol: "005930",
      keyBehavior: "toggle-view",
    });
    expect(settingsEqual(a, b)).toBe(true);
    expect(settingsEqual(a, c)).toBe(false);
  });

  it("detects credential configuration", () => {
    expect(
      credentialsConfigured({
        schemaVersion: 1,
        clientId: "id",
        clientSecret: "sec",
        renderMode: "realtime",
      }),
    ).toBe(true);
    expect(
      credentialsConfigured({
        schemaVersion: 1,
        clientId: "",
        clientSecret: "sec",
        renderMode: "realtime",
      }),
    ).toBe(false);
  });
});
