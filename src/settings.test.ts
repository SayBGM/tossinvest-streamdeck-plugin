import { describe, expect, it } from "vitest";
import { migrateActionSettings, migrateGlobalSettings, normalizeSymbol } from "./settings.js";

describe("settings", () => {
  it("normalizes supported symbols and rejects URL punctuation", () => {
    expect(normalizeSymbol(" aapl ")).toBe("AAPL");
    expect(normalizeSymbol("005930")).toBe("005930");
    expect(normalizeSymbol("AAPL/order")).toBe("");
  });

  it("migrates unknown settings to safe defaults", () => {
    expect(migrateGlobalSettings({ clientId: " c_1 ", clientSecret: " s_1 ", renderMode: "nope" })).toEqual({
      schemaVersion: 1, clientId: "c_1", clientSecret: "s_1", renderMode: "realtime",
    });
    expect(migrateActionSettings({ symbol: "aapl", keyBehavior: "open" })).toMatchObject({
      schemaVersion: 1, symbol: "AAPL", keyBehavior: "open", currency: "",
    });
  });
});
