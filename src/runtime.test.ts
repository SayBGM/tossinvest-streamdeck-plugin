import { describe, expect, it, vi } from "vitest";
import { createRuntime } from "./runtime.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

class StubWebSocket {
  static OPEN = 1;
  readyState = 0;
  once() {
    /* no-op */
  }
  on() {
    /* no-op */
  }
  removeAllListeners() {
    /* no-op */
  }
  close() {
    /* no-op */
  }
  send() {
    /* no-op */
  }
}

function decodeImage(image: string): string {
  return decodeURIComponent(image.replace(/^data:image\/svg\+xml,/, ""));
}

/**
 * Builds a KR single-symbol fetch mock (005930, reference price 72000 via
 * candles closing 72000 -> 73000) with a `/api/v1/price-limits` branch, for
 * the signal-detection runtime tests below. `lastPrice` is the price the
 * first REST refresh reports.
 */
function createSignalFetchMock(lastPrice: string) {
  const stocksResult = [
    { symbol: "005930", name: "삼성전자", market: "KR", currency: "KRW" },
  ];
  const pricesResult = [
    {
      symbol: "005930",
      timestamp: "2026-09-07T01:00:00Z",
      lastPrice,
      currency: "KRW",
    },
  ];
  const candlesResult = {
    candles: [
      {
        timestamp: "2026-09-04T00:00:00Z",
        closePrice: "72000",
        highPrice: "72500",
        lowPrice: "71000",
      },
      {
        timestamp: "2026-09-07T00:00:00Z",
        closePrice: "73000",
        highPrice: "74500",
        lowPrice: "72800",
      },
    ],
  };
  const priceLimitResult = {
    timestamp: "2026-09-07T01:00:00Z",
    upperLimitPrice: "999999",
    lowerLimitPrice: "1",
    currency: "KRW",
  };
  return vi.fn<typeof globalThis.fetch>(async (input) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    if (url.includes("/oauth2/token")) {
      return jsonResponse({ access_token: "t", expires_in: 3600 });
    }
    if (url.includes("/api/v1/stocks")) {
      return jsonResponse({ result: stocksResult });
    }
    if (url.includes("/api/v1/prices")) {
      return jsonResponse({ result: pricesResult });
    }
    if (url.includes("/api/v1/candles")) {
      return jsonResponse({ result: candlesResult });
    }
    if (url.includes("/api/v1/price-limits")) {
      return jsonResponse({ result: priceLimitResult });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
}

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

    const settingsUpdates = () =>
      pushed.filter(
        (msg): msg is { type: string; settings: unknown } =>
          typeof msg === "object" &&
          msg !== null &&
          (msg as { type?: unknown }).type === "settings-updated",
      );

    await runtime.keyDown(action);
    expect(settingsUpdates()).toHaveLength(1);
    expect(settingsUpdates()[0]).toMatchObject({
      type: "settings-updated",
      settings: { viewMode: "detail" },
    });

    await runtime.keyDown(action);
    expect(settingsUpdates()).toHaveLength(2);
    expect(settingsUpdates()[1]).toMatchObject({
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
            signalDurationSec: 5,
          },
          { deferRefresh: true },
        )
        .then(() => "acknowledged"),
      new Promise<string>((resolve) =>
        setTimeout(() => resolve("timed-out"), 100),
      ),
    ]);

    expect(outcome).toBe("acknowledged");
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await runtime.destroy();
  });

  it("coalesces refreshes from several keys into one REST batch", async () => {
    const stocksResult = [
      { symbol: "005930", name: "삼성전자", market: "KR", currency: "KRW" },
      { symbol: "000660", name: "SK하이닉스", market: "KR", currency: "KRW" },
      { symbol: "005380", name: "현대차", market: "KR", currency: "KRW" },
    ];
    const pricesResult = stocksResult.map((stock) => ({
      symbol: stock.symbol,
      timestamp: "2026-09-07T01:00:00Z",
      lastPrice: "74000",
      currency: "KRW",
    }));
    const candlesResult = {
      candles: [
        {
          timestamp: "2026-09-04T00:00:00Z",
          closePrice: "72000",
          highPrice: "72500",
          lowPrice: "71000",
        },
        {
          timestamp: "2026-09-07T00:00:00Z",
          closePrice: "73000",
          highPrice: "74500",
          lowPrice: "72800",
        },
      ],
    };
    const jsonResponse = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/oauth2/token")) {
        return jsonResponse({ access_token: "t", expires_in: 3600 });
      }
      if (url.includes("/api/v1/stocks")) {
        return jsonResponse({ result: stocksResult });
      }
      if (url.includes("/api/v1/prices")) {
        return jsonResponse({ result: pricesResult });
      }
      if (url.includes("/api/v1/candles")) {
        return jsonResponse({ result: candlesResult });
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    class StubWebSocket {
      static OPEN = 1;
      readyState = 0;
      once() {
        /* no-op */
      }
      on() {
        /* no-op */
      }
      removeAllListeners() {
        /* no-op */
      }
      close() {
        /* no-op */
      }
      send() {
        /* no-op */
      }
    }

    const runtime = createRuntime({
      fetch,
      settings: {
        schemaVersion: 1,
        clientId: "c",
        clientSecret: "s",
        renderMode: "realtime",
        signalDurationSec: 5,
      },
      socketUrl: "ws://localhost:1",
      WebSocketImpl: StubWebSocket as unknown as ConstructorParameters<
        typeof import("./toss/websocket.js").TossWebSocket
      >[1]["WebSocketImpl"],
    });

    const actionA = { id: "key-a", setImage: async () => undefined };
    const actionB = { id: "key-b", setImage: async () => undefined };
    const actionC = { id: "key-c", setImage: async () => undefined };

    await Promise.all([
      runtime.appear(actionA, {
        symbol: "005930",
        name: "삼성전자",
        market: "KR",
        currency: "KRW",
      }),
      runtime.appear(actionB, {
        symbol: "000660",
        name: "SK하이닉스",
        market: "KR",
        currency: "KRW",
      }),
      runtime.appear(actionC, {
        symbol: "005380",
        name: "현대차",
        market: "KR",
        currency: "KRW",
      }),
    ]);

    const stocksCalls = fetch.mock.calls.filter(([input]) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      return url.includes("/api/v1/stocks");
    });
    expect(stocksCalls).toHaveLength(1);
    const stocksUrl =
      typeof stocksCalls[0]![0] === "string"
        ? (stocksCalls[0]![0] as string)
        : (stocksCalls[0]![0] as Request).url;
    const decodedQuery = decodeURIComponent(stocksUrl);
    expect(decodedQuery).toContain("005930");
    expect(decodedQuery).toContain("000660");
    expect(decodedQuery).toContain("005380");

    await runtime.destroy();
  });

  it("applies trade ticks to high/low and renders only that key", async () => {
    const stocksResult = [
      { symbol: "005930", name: "삼성전자", market: "KR", currency: "KRW" },
      { symbol: "000660", name: "SK하이닉스", market: "KR", currency: "KRW" },
    ];
    const pricesResult = stocksResult.map((stock) => ({
      symbol: stock.symbol,
      timestamp: "2026-09-07T01:00:00Z",
      lastPrice: "74000",
      currency: "KRW",
    }));
    const candlesResult = {
      candles: [
        {
          timestamp: "2026-09-04T00:00:00Z",
          closePrice: "72000",
          highPrice: "72500",
          lowPrice: "71000",
        },
        {
          timestamp: "2026-09-07T00:00:00Z",
          closePrice: "73000",
          highPrice: "74500",
          lowPrice: "72800",
        },
      ],
    };
    const jsonResponse = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/oauth2/token")) {
        return jsonResponse({ access_token: "t", expires_in: 3600 });
      }
      if (url.includes("/api/v1/stocks")) {
        return jsonResponse({ result: stocksResult });
      }
      if (url.includes("/api/v1/prices")) {
        return jsonResponse({ result: pricesResult });
      }
      if (url.includes("/api/v1/candles")) {
        return jsonResponse({ result: candlesResult });
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    class StubWebSocket {
      static OPEN = 1;
      readyState = 0;
      once() {
        /* no-op */
      }
      on() {
        /* no-op */
      }
      removeAllListeners() {
        /* no-op */
      }
      close() {
        /* no-op */
      }
      send() {
        /* no-op */
      }
    }

    const runtime = createRuntime({
      fetch,
      settings: {
        schemaVersion: 1,
        clientId: "c",
        clientSecret: "s",
        renderMode: "realtime",
        signalDurationSec: 5,
      },
      socketUrl: "ws://localhost:1",
      WebSocketImpl: StubWebSocket as unknown as ConstructorParameters<
        typeof import("./toss/websocket.js").TossWebSocket
      >[1]["WebSocketImpl"],
    });

    const samsungImages: string[] = [];
    let hynixImageCount = 0;
    const actionSamsung = {
      id: "key-samsung",
      setImage: async (image: string) => {
        samsungImages.push(image);
      },
    };
    const actionHynix = {
      id: "key-hynix",
      setImage: async () => {
        hynixImageCount += 1;
      },
    };

    await Promise.all([
      runtime.appear(actionSamsung, {
        symbol: "005930",
        name: "삼성전자",
        market: "KR",
        currency: "KRW",
      }),
      runtime.appear(actionHynix, {
        symbol: "000660",
        name: "SK하이닉스",
        market: "KR",
        currency: "KRW",
      }),
    ]);

    // Wait for the coalesced REST refresh to land and be committed to the
    // Samsung key (i.e. the fetched lastPrice of 74000, not just the initial
    // "connecting" placeholder render) before recording baselines, so the
    // settling renders triggered by refreshAll don't get mistaken for
    // renders caused by the tick below.
    await vi.waitFor(
      () => {
        const last = samsungImages[samsungImages.length - 1];
        expect(last).toBeDefined();
        const decoded = decodeURIComponent(
          (last ?? "").replace(/^data:image\/svg\+xml,/, ""),
        );
        expect(decoded).toContain("74,000");
      },
      { timeout: 2000 },
    );
    // Give the sibling key's render (submitted alongside Samsung's from the
    // same refreshAll pass) time to settle too.
    await new Promise((resolve) => setTimeout(resolve, 150));

    const samsungCountBeforeTick = samsungImages.length;
    const hynixCountBeforeTick = hynixImageCount;

    (
      runtime as unknown as { handleTick(tick: unknown): void }
    ).handleTick({
      symbol: "005930",
      market: "KR",
      price: "76000",
      timestamp: "2026-09-07T01:05:00Z",
      currency: "KRW",
    });

    await vi.waitFor(
      () => expect(samsungImages.length).toBeGreaterThan(samsungCountBeforeTick),
      { timeout: 2000 },
    );

    const latestSamsungImage = samsungImages[samsungImages.length - 1]!;
    const decodedSamsung = decodeURIComponent(
      latestSamsungImage.replace(/^data:image\/svg\+xml,/, ""),
    );
    expect(decodedSamsung).toContain("76,000");

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(hynixImageCount).toBe(hynixCountBeforeTick);

    const previewUri = runtime.preview({
      symbol: "005930",
      name: "삼성전자",
      market: "KR",
      currency: "KRW",
      viewMode: "detail",
    });
    const decodedPreview = decodeURIComponent(
      previewUri.replace(/^data:image\/svg\+xml,/, ""),
    );
    expect(decodedPreview).toContain("76,000");

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

  it("shows a rate-level signal on both keys of the same symbol when a tick crosses +10%", async () => {
    // First REST load reports 74000 (~+2.8% vs the 72000 reference) so the
    // detector only arms; it must not fire yet.
    const fetch = createSignalFetchMock("74000");
    const runtime = createRuntime({
      fetch,
      settings: {
        schemaVersion: 1,
        clientId: "c",
        clientSecret: "s",
        renderMode: "realtime",
        signalDurationSec: 5,
      },
      socketUrl: "ws://localhost:1",
      WebSocketImpl: StubWebSocket as unknown as ConstructorParameters<
        typeof import("./toss/websocket.js").TossWebSocket
      >[1]["WebSocketImpl"],
    });

    const imagesA: string[] = [];
    const imagesB: string[] = [];
    const actionA = {
      id: "key-signal-a",
      setImage: async (image: string) => {
        imagesA.push(image);
      },
    };
    const actionB = {
      id: "key-signal-b",
      setImage: async (image: string) => {
        imagesB.push(image);
      },
    };

    await Promise.all([
      runtime.appear(actionA, {
        symbol: "005930",
        name: "삼성전자",
        market: "KR",
        currency: "KRW",
      }),
      runtime.appear(actionB, {
        symbol: "005930",
        name: "삼성전자",
        market: "KR",
        currency: "KRW",
      }),
    ]);

    // Wait for the arming REST refresh to settle before ticking, so we don't
    // mistake its renders for the tick's.
    await vi.waitFor(
      () => {
        const last = imagesA[imagesA.length - 1];
        expect(last).toBeDefined();
        expect(decodeImage(last ?? "")).toContain("74,000");
      },
      { timeout: 2000 },
    );

    (
      runtime as unknown as { handleTick(tick: unknown): void }
    ).handleTick({
      symbol: "005930",
      market: "KR",
      price: "79200", // exactly +10% vs the 72000 reference
      timestamp: "2026-09-07T01:05:00Z",
      currency: "KRW",
    });

    await vi.waitFor(
      () => {
        const last = imagesA[imagesA.length - 1];
        expect(last).toBeDefined();
        expect(decodeImage(last ?? "")).toContain("10% 상승");
      },
      { timeout: 2000 },
    );
    await vi.waitFor(
      () => {
        const last = imagesB[imagesB.length - 1];
        expect(last).toBeDefined();
        expect(decodeImage(last ?? "")).toContain("10% 상승");
      },
      { timeout: 2000 },
    );

    await runtime.destroy();
  });

  it("dismisses an active signal on keyDown without running the key's normal behavior", async () => {
    const opened: string[] = [];
    const fetch = createSignalFetchMock("74000");
    const runtime = createRuntime({
      fetch,
      openUrl: async (url) => {
        opened.push(url);
      },
      settings: {
        schemaVersion: 1,
        clientId: "c",
        clientSecret: "s",
        renderMode: "realtime",
        signalDurationSec: 5,
      },
      socketUrl: "ws://localhost:1",
      WebSocketImpl: StubWebSocket as unknown as ConstructorParameters<
        typeof import("./toss/websocket.js").TossWebSocket
      >[1]["WebSocketImpl"],
    });

    const images: string[] = [];
    const action = {
      id: "key-signal-dismiss",
      setImage: async (image: string) => {
        images.push(image);
      },
    };

    await runtime.appear(action, {
      symbol: "005930",
      name: "삼성전자",
      market: "KR",
      currency: "KRW",
      keyBehavior: "open",
    });

    await vi.waitFor(
      () => {
        const last = images[images.length - 1];
        expect(last).toBeDefined();
        expect(decodeImage(last ?? "")).toContain("74,000");
      },
      { timeout: 2000 },
    );

    (
      runtime as unknown as { handleTick(tick: unknown): void }
    ).handleTick({
      symbol: "005930",
      market: "KR",
      price: "79200", // +10%
      timestamp: "2026-09-07T01:05:00Z",
      currency: "KRW",
    });

    await vi.waitFor(
      () => {
        const last = images[images.length - 1];
        expect(last).toBeDefined();
        expect(decodeImage(last ?? "")).toContain("10% 상승");
      },
      { timeout: 2000 },
    );

    await runtime.keyDown(action);
    expect(opened).toEqual([]);

    await vi.waitFor(
      () => {
        const last = images[images.length - 1];
        expect(last).toBeDefined();
        expect(decodeImage(last ?? "")).not.toContain("10% 상승");
      },
      { timeout: 2000 },
    );

    await runtime.destroy();
  });

  it("returns to the normal quote card once the signal duration elapses", async () => {
    const fetch = createSignalFetchMock("74000");
    const runtime = createRuntime({
      fetch,
      settings: {
        schemaVersion: 1,
        clientId: "c",
        clientSecret: "s",
        renderMode: "realtime",
        signalDurationSec: 1,
      },
      socketUrl: "ws://localhost:1",
      WebSocketImpl: StubWebSocket as unknown as ConstructorParameters<
        typeof import("./toss/websocket.js").TossWebSocket
      >[1]["WebSocketImpl"],
    });

    const images: string[] = [];
    const action = {
      id: "key-signal-expiry",
      setImage: async (image: string) => {
        images.push(image);
      },
    };

    await runtime.appear(action, {
      symbol: "005930",
      name: "삼성전자",
      market: "KR",
      currency: "KRW",
    });

    await vi.waitFor(
      () => {
        const last = images[images.length - 1];
        expect(last).toBeDefined();
        expect(decodeImage(last ?? "")).toContain("74,000");
      },
      { timeout: 2000 },
    );

    (
      runtime as unknown as { handleTick(tick: unknown): void }
    ).handleTick({
      symbol: "005930",
      market: "KR",
      price: "79200", // +10%
      timestamp: "2026-09-07T01:05:00Z",
      currency: "KRW",
    });

    await vi.waitFor(
      () => {
        const last = images[images.length - 1];
        expect(last).toBeDefined();
        expect(decodeImage(last ?? "")).toContain("10% 상승");
      },
      { timeout: 2000 },
    );

    await vi.waitFor(
      () => {
        const last = images[images.length - 1];
        expect(last).toBeDefined();
        const decoded = decodeImage(last ?? "");
        expect(decoded).not.toContain("10% 상승");
        expect(decoded).toContain("79,200");
      },
      { timeout: 3000 },
    );

    await runtime.destroy();
  });

  it("does not fire a signal on the very first REST load, even when already past a threshold", async () => {
    // First load is already at +12% vs the 72000 reference (80640) — this
    // should only arm the detector, not display a signal.
    const fetch = createSignalFetchMock("80640");
    const runtime = createRuntime({
      fetch,
      settings: {
        schemaVersion: 1,
        clientId: "c",
        clientSecret: "s",
        renderMode: "realtime",
        signalDurationSec: 5,
      },
      socketUrl: "ws://localhost:1",
      WebSocketImpl: StubWebSocket as unknown as ConstructorParameters<
        typeof import("./toss/websocket.js").TossWebSocket
      >[1]["WebSocketImpl"],
    });

    const images: string[] = [];
    const action = {
      id: "key-signal-arm-only",
      setImage: async (image: string) => {
        images.push(image);
      },
    };

    await runtime.appear(action, {
      symbol: "005930",
      name: "삼성전자",
      market: "KR",
      currency: "KRW",
    });

    await vi.waitFor(
      () => {
        const last = images[images.length - 1];
        expect(last).toBeDefined();
        expect(decodeImage(last ?? "")).toContain("80,640");
      },
      { timeout: 2000 },
    );

    const decoded = decodeImage(images[images.length - 1] ?? "");
    expect(decoded).not.toContain("상승");
    expect(decoded).not.toContain("하락");

    await runtime.destroy();
  });
});
