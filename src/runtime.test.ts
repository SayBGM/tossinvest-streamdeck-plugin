import { describe, expect, it } from "vitest";
import { createRuntime } from "./runtime.js";

describe("QuoteRuntime", () => {
  it("opens the validated KR and US Toss stock routes per key setting", async () => {
    const opened: string[] = [];
    const runtime = createRuntime({ openUrl: async (url) => { opened.push(url); } });
    const action = { id: "key-1", setImage: async () => undefined };
    await runtime.appear(action, { symbol: "AAPL", name: "애플", market: "US", currency: "USD", keyBehavior: "open" });
    await runtime.keyDown(action);
    expect(opened).toEqual(["https://www.tossinvest.com/stocks/AAPL/order"]);
    await runtime.settingsChanged(action, { symbol: "005930", name: "삼성전자", market: "KR", currency: "KRW", keyBehavior: "open" });
    await runtime.keyDown(action);
    expect(opened[1]).toBe("https://www.tossinvest.com/stocks/A005930/order");
    await runtime.destroy();
  });
});
