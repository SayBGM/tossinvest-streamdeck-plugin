import { describe, expect, it } from "vitest";
import { createRuntime } from "./runtime.js";

describe("QuoteRuntime", () => {
  it("opens the validated KR and US Toss stock routes per key setting", async () => {
    const opened: string[] = [];
    const runtime = createRuntime({
      openUrl: async (url) => {
        opened.push(url);
      },
    });
    const action = { id: "key-1", setImage: async () => undefined };
    await runtime.appear(action, {
      symbol: "AAPL",
      name: "애플",
      market: "US",
      currency: "USD",
      keyBehavior: "open",
    });
    await runtime.keyDown(action);
    expect(opened).toEqual(["https://www.tossinvest.com/stocks/AAPL/order"]);
    await runtime.settingsChanged(action, {
      symbol: "005930",
      name: "삼성전자",
      market: "KR",
      currency: "KRW",
      keyBehavior: "open",
    });
    await runtime.keyDown(action);
    expect(opened[1]).toBe("https://www.tossinvest.com/stocks/A005930/order");
    await runtime.destroy();
  });

  it("toggles viewMode between chart and detail on keyDown", async () => {
    const pushed: unknown[] = [];
    const runtime = createRuntime({
      piSender: async (_id, msg) => {
        pushed.push(msg);
      },
    });
    const action = { id: "key-toggle", setImage: async () => undefined };
    await runtime.appear(action, {
      symbol: "005930",
      name: "삼성전자",
      market: "KR",
      currency: "KRW",
      keyBehavior: "toggle-view",
      viewMode: "chart",
    });

    await runtime.keyDown(action);
    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toMatchObject({
      type: "settings-updated",
      settings: { viewMode: "detail" },
    });

    await runtime.keyDown(action);
    expect(pushed).toHaveLength(2);
    expect(pushed[1]).toMatchObject({
      type: "settings-updated",
      settings: { viewMode: "chart" },
    });

    await runtime.destroy();
  });

  it("generates a preview data URI for Property Inspector", () => {
    const runtime = createRuntime();
    const uri = runtime.preview({
      symbol: "005930",
      name: "삼성전자",
      currency: "KRW",
      market: "KR",
      viewMode: "chart",
    });
    expect(uri).toMatch(/^data:image\/svg\+xml,/);
    expect(decodeURIComponent(uri)).toContain("삼성전자");
  });
});
