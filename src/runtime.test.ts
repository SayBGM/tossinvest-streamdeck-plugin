import { describe, expect, it, vi } from "vitest";
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

  it("alerts and preserves the open error when opening a quote fails", async () => {
    let alerts = 0;
    const failure = new Error("browser unavailable");
    const runtime = createRuntime({
      openUrl: async () => {
        throw failure;
      },
    });
    const action = {
      id: "key-open-error",
      setImage: async () => undefined,
      showAlert: async () => {
        alerts += 1;
      },
    };
    await runtime.appear(action, {
      symbol: "AAPL",
      market: "US",
      currency: "USD",
      keyBehavior: "open",
    });

    await expect(runtime.keyDown(action)).rejects.toBe(failure);
    expect(alerts).toBe(1);
    await runtime.destroy();
  });

  it("alerts when a manual refresh cannot run without credentials", async () => {
    let alerts = 0;
    const runtime = createRuntime();
    const action = {
      id: "key-refresh-error",
      setImage: async () => undefined,
      showAlert: async () => {
        alerts += 1;
      },
    };
    await runtime.appear(action, {
      symbol: "005930",
      market: "KR",
      currency: "KRW",
      keyBehavior: "refresh",
    });

    await runtime.keyDown(action);
    expect(alerts).toBe(1);
    await runtime.destroy();
  });

  it("acknowledges deferred credential updates without waiting for quote I/O", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      () => new Promise<Response>(() => undefined),
    );
    const runtime = createRuntime({ fetch });
    const action = { id: "key-deferred-auth", setImage: async () => undefined };
    await runtime.appear(action, {
      symbol: "005930",
      market: "KR",
      currency: "KRW",
      keyBehavior: "refresh",
    });

    const outcome = await Promise.race([
      runtime
        .updateGlobalSettings(
          {
            schemaVersion: 1,
            clientId: "client",
            clientSecret: "secret",
            renderMode: "realtime",
          },
          { deferRefresh: true },
        )
        .then(() => "acknowledged"),
      new Promise<string>((resolve) =>
        setTimeout(() => resolve("timed-out"), 100),
      ),
    ]);

    expect(outcome).toBe("acknowledged");
    expect(fetch).toHaveBeenCalledTimes(1);
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
