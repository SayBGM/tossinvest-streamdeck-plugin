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
    const runtime = createRuntime({
      settings: {
        schemaVersion: 1,
        clientId: "c",
        clientSecret: "s",
        renderMode: "realtime",
        signalDurationSec: 5,
      },
    });
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
    // The first REST price is intentionally rendered before daily-history
    // enrichment; let both queued passes settle before measuring the tick.
    await new Promise((resolve) => setTimeout(resolve, 450));

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

  it("drops out-of-order ticks and clears prior-session signal context", async () => {
    const runtime = createRuntime();
    const quotes = (runtime as unknown as {
      quotes: Map<string, Record<string, unknown>>;
    }).quotes;
    quotes.set("005930", {
      symbol: "005930",
      market: "KR",
      lastPrice: "100",
      timestamp: "2026-09-07T01:00:00Z",
      status: "ready",
      referencePrice: "90",
      highPrice: "110",
      lowPrice: "80",
      sparkline: [90, 100],
      priceLimit: { upper: 120, lower: 60, date: "2026-09-07" },
      movingAverages: [{ period: 20, value: 95 }],
      sessionDate: "2026-09-07",
      signalMemory: {},
    });

    const handleTick = (runtime as unknown as {
      handleTick(tick: unknown): void;
    }).handleTick.bind(runtime);
    handleTick({
      symbol: "005930",
      market: "KR",
      price: "105",
      timestamp: "2026-09-07T01:05:00Z",
      currency: "KRW",
    });
    handleTick({
      symbol: "005930",
      market: "KR",
      price: "99",
      timestamp: "2026-09-07T01:04:00Z",
      currency: "KRW",
    });
    expect(quotes.get("005930")?.lastPrice).toBe("105");

    handleTick({
      symbol: "005930",
      market: "KR",
      price: "115",
      timestamp: "2026-09-08T01:00:00Z",
      currency: "KRW",
    });
    const nextSession = quotes.get("005930");
    expect(nextSession).toMatchObject({
      lastPrice: "115",
      referencePrice: undefined,
      priceLimit: undefined,
      movingAverages: undefined,
      pendingSessionDate: "2026-09-08",
    });
    await runtime.destroy();
  });

  it("keeps a newer live tick when an older REST snapshot finishes later", async () => {
    let resolveStocks: ((value: unknown[]) => void) | undefined;
    let resolvePrices: ((value: unknown[]) => void) | undefined;
    const runtime = createRuntime({
      settings: {
        schemaVersion: 1,
        clientId: "c",
        clientSecret: "s",
        renderMode: "realtime",
        signalDurationSec: 5,
      },
    });
    const rest = (runtime as unknown as {
      rest: {
        getStocks: (symbols: readonly string[]) => Promise<unknown[]>;
        getPrices: (symbols: readonly string[]) => Promise<unknown[]>;
        getCandles: (symbol: string, count: number) => Promise<unknown[]>;
      };
    }).rest;
    rest.getStocks = () => new Promise((resolve) => { resolveStocks = resolve; });
    rest.getPrices = () => new Promise((resolve) => { resolvePrices = resolve; });
    rest.getCandles = async () => [];

    const quotes = (runtime as unknown as {
      quotes: Map<string, Record<string, unknown>>;
    }).quotes;
    quotes.set("005930", {
      symbol: "005930",
      market: "KR",
      lastPrice: "100",
      timestamp: "2026-09-07T01:00:00Z",
      sessionDate: "2026-09-07",
      status: "ready",
      signalMemory: {},
    });
    const refresh = (runtime as unknown as {
      performRefresh(symbols: readonly string[]): Promise<void>;
    }).performRefresh(["005930"]);

    (runtime as unknown as { handleTick(tick: unknown): void }).handleTick({
      symbol: "005930",
      market: "KR",
      price: "105",
      timestamp: "2026-09-07T01:05:00Z",
      currency: "KRW",
    });
    resolveStocks?.([{ symbol: "005930", name: "삼성전자", market: "KR", currency: "KRW" }]);
    resolvePrices?.([{ symbol: "005930", lastPrice: "101", timestamp: "2026-09-07T01:01:00Z", currency: "KRW" }]);
    await refresh;

    expect(quotes.get("005930")).toMatchObject({
      lastPrice: "105",
      timestamp: "2026-09-07T01:05:00Z",
    });
    await runtime.destroy();
  });

  it("restores a connecting quote from an equal REST timestamp without replacing its live price", async () => {
    const runtime = createRuntime({
      settings: {
        schemaVersion: 1,
        clientId: "c",
        clientSecret: "s",
        renderMode: "realtime",
        signalDurationSec: 5,
      },
    });
    const rest = (runtime as unknown as {
      rest: {
        getStocks: () => Promise<unknown[]>;
        getPrices: () => Promise<unknown[]>;
        getCandles: () => Promise<unknown[]>;
        getPriceLimit: () => Promise<unknown>;
      };
    }).rest;
    rest.getStocks = async () => [
      { symbol: "005930", name: "삼성전자", market: "KR", currency: "KRW" },
    ];
    rest.getPrices = async () => [
      { symbol: "005930", lastPrice: "101", timestamp: "2026-09-07T01:05:00Z", currency: "KRW" },
    ];
    rest.getCandles = async () => [];
    rest.getPriceLimit = async () => ({});
    const quotes = (runtime as unknown as {
      quotes: Map<string, Record<string, unknown>>;
    }).quotes;
    quotes.set("005930", {
      symbol: "005930",
      market: "KR",
      lastPrice: "105",
      timestamp: "2026-09-07T01:05:00Z",
      sessionDate: "2026-09-07",
      status: "connecting",
      signalMemory: {},
    });

    await (runtime as unknown as {
      performRefresh(symbols: readonly string[]): Promise<void>;
    }).performRefresh(["005930"]);

    expect(quotes.get("005930")).toMatchObject({
      lastPrice: "105",
      timestamp: "2026-09-07T01:05:00Z",
      status: "ready",
    });
    await runtime.destroy();
  });

  it("keeps session-tick highs and lows while candle history is pending", async () => {
    const runtime = createRuntime();
    const quotes = (runtime as unknown as {
      quotes: Map<string, Record<string, unknown>>;
    }).quotes;
    quotes.set("005930", {
      symbol: "005930",
      market: "KR",
      lastPrice: "100",
      timestamp: "2026-09-07T01:00:00Z",
      sessionDate: "2026-09-07",
      status: "ready",
      referencePrice: "90",
      highPrice: "110",
      lowPrice: "80",
      signalMemory: {},
    });
    const handleTick = (runtime as unknown as {
      handleTick(tick: unknown): void;
    }).handleTick.bind(runtime);

    handleTick({ symbol: "005930", market: "KR", price: "115", timestamp: "2026-09-08T01:00:00Z", currency: "KRW" });
    handleTick({ symbol: "005930", market: "KR", price: "108", timestamp: "2026-09-08T01:01:00Z", currency: "KRW" });
    handleTick({ symbol: "005930", market: "KR", price: "120", timestamp: "2026-09-08T01:02:00Z", currency: "KRW" });

    expect(quotes.get("005930")).toMatchObject({
      pendingSessionDate: "2026-09-08",
      highPrice: "120",
      lowPrice: "108",
    });
    await runtime.destroy();
  });

  it("does not let an older-session candle overwrite new-session tick extremes", async () => {
    let resolveCandles: ((value: unknown[]) => void) | undefined;
    const runtime = createRuntime({
      settings: {
        schemaVersion: 1,
        clientId: "c",
        clientSecret: "s",
        renderMode: "realtime",
        signalDurationSec: 5,
      },
    });
    const rest = (runtime as unknown as {
      rest: {
        getStocks: () => Promise<unknown[]>;
        getPrices: () => Promise<unknown[]>;
        getCandles: () => Promise<unknown[]>;
        getPriceLimit: () => Promise<unknown>;
      };
    }).rest;
    rest.getStocks = async () => [
      { symbol: "005930", name: "삼성전자", market: "KR", currency: "KRW" },
    ];
    rest.getPrices = async () => [
      { symbol: "005930", lastPrice: "105", timestamp: "2026-09-08T01:00:00Z", currency: "KRW" },
    ];
    rest.getCandles = () => new Promise((resolve) => { resolveCandles = resolve; });
    rest.getPriceLimit = async () => ({});
    const quotes = (runtime as unknown as {
      quotes: Map<string, Record<string, unknown>>;
    }).quotes;
    quotes.set("005930", {
      symbol: "005930",
      market: "KR",
      lastPrice: "100",
      timestamp: "2026-09-07T01:00:00Z",
      sessionDate: "2026-09-07",
      status: "ready",
      referencePrice: "90",
      highPrice: "110",
      lowPrice: "80",
      signalMemory: {},
    });
    const refresh = (runtime as unknown as {
      performRefresh(symbols: readonly string[]): Promise<void>;
    }).performRefresh(["005930"]);
    await vi.waitFor(() => expect(resolveCandles).toBeTypeOf("function"));

    const handleTick = (runtime as unknown as {
      handleTick(tick: unknown): void;
    }).handleTick.bind(runtime);
    handleTick({ symbol: "005930", market: "KR", price: "120", timestamp: "2026-09-08T01:01:00Z", currency: "KRW" });
    handleTick({ symbol: "005930", market: "KR", price: "108", timestamp: "2026-09-08T01:02:00Z", currency: "KRW" });
    resolveCandles?.([
      { timestamp: "2026-09-07T00:00:00Z", closePrice: "100", highPrice: "999", lowPrice: "1" },
    ]);
    await refresh;

    expect(quotes.get("005930")).toMatchObject({
      highPrice: "120",
      lowPrice: "105",
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

  it("keeps the cached quote visible and explains the REST fallback past 100 unique symbols", async () => {
    const runtime = createRuntime({
      settings: {
        schemaVersion: 1,
        clientId: "c",
        clientSecret: "s",
        renderMode: "realtime",
        signalDurationSec: 5,
      },
    });
    (runtime.socket as unknown as { state: string }).state = "connected";
    const internals = runtime as unknown as {
      bindings: Map<string, {
        action: { id: string; setImage(image: string): Promise<void> };
        generation: number;
        settings: Record<string, unknown>;
      }>;
      quotes: Map<string, Record<string, unknown>>;
      reconcileSubscriptions(): void;
      performRefresh(): Promise<void>;
    };
    const setSymbols = vi.spyOn(runtime.socket, "setSymbols").mockImplementation(() => undefined);
    let refreshSecond = 0;
    vi.spyOn(runtime.rest, "getStocks").mockImplementation(async (symbols) =>
      symbols.map((symbol) => ({ symbol, name: symbol, market: "US", currency: "USD" })),
    );
    vi.spyOn(runtime.rest, "getPrices").mockImplementation(async (symbols) => {
      refreshSecond += 1;
      return symbols.map((symbol) => ({
        symbol,
        lastPrice: "181.00",
        currency: "USD",
        timestamp: `2026-09-07T01:00:${String(refreshSecond).padStart(2, "0")}Z`,
      }));
    });
    vi.spyOn(runtime.rest, "getCandles").mockResolvedValue([]);

    for (let index = 0; index <= 100; index += 1) {
      const symbol = `T${String(index).padStart(3, "0")}`;
      internals.bindings.set(`key-${index}`, {
        action: { id: `key-${index}`, setImage: async () => undefined },
        generation: 1,
        settings: {
          schemaVersion: 1,
          symbol,
          name: symbol,
          market: "US",
          currency: "USD",
          keyBehavior: "refresh",
        },
      });
      internals.quotes.set(symbol, {
        symbol,
        info: { symbol, name: symbol, market: "US", currency: "USD" },
        market: "US",
        lastPrice: "180.50",
        referencePrice: "175.00",
        status: "ready",
        signalMemory: {},
      });
    }
    // A second key for the first symbol does not consume another socket slot.
    internals.bindings.set("key-duplicate", {
      action: { id: "key-duplicate", setImage: async () => undefined },
      generation: 1,
      settings: {
        schemaVersion: 1,
        symbol: "T000",
        name: "T000",
        market: "US",
        currency: "USD",
        keyBehavior: "refresh",
      },
    });

    await internals.performRefresh();
    const firstPlan = setSymbols.mock.calls.at(-1)?.[0] ?? [];
    expect(firstPlan).toHaveLength(100);
    expect(firstPlan.map(([symbol]) => symbol)).not.toContain("T100");
    expect(runtime.quoteStatus("key-100")).toEqual({
      status: "stale",
      message: "실시간 구독 한도 100종목 초과 · 시세를 주기적으로 조회합니다. 다른 종목 키를 제거하면 자동 복구됩니다.",
      live: false,
    });
    // A later REST timestamp must not clear the cap warning or mark this key
    // live while the same 100 earlier symbols still occupy all slots.
    await internals.performRefresh();
    expect(runtime.quoteStatus("key-100")).toEqual({
      status: "stale",
      message: "실시간 구독 한도 100종목 초과 · 시세를 주기적으로 조회합니다. 다른 종목 키를 제거하면 자동 복구됩니다.",
      live: false,
    });
    // Removing the only two keys for T000 frees a slot for the prior overflow.
    runtime.disappear("key-0");
    runtime.disappear("key-duplicate");
    const restoredPlan = setSymbols.mock.calls.at(-1)?.[0] ?? [];
    expect(restoredPlan).toHaveLength(100);
    expect(restoredPlan.map(([symbol]) => symbol)).toContain("T100");
    expect(runtime.quoteStatus("key-100")).toEqual({
      status: "ready",
      message: undefined,
      live: true,
    });

    await runtime.destroy();
  });

  it("does not accept a tick whose currency differs from validated metadata", async () => {
    const runtime = createRuntime();
    const quotes = (runtime as unknown as {
      quotes: Map<string, Record<string, unknown>>;
      handleTick(tick: unknown): void;
    }).quotes;
    quotes.set("AAPL", {
      symbol: "AAPL",
      info: { symbol: "AAPL", name: "Apple", market: "US", currency: "USD" },
      market: "US",
      lastPrice: "180.50",
      timestamp: "2026-09-07T01:00:00Z",
      status: "ready",
      signalMemory: {},
    });

    (runtime as unknown as { handleTick(tick: unknown): void }).handleTick({
      symbol: "AAPL",
      market: "US",
      price: "99999",
      timestamp: "2026-09-07T01:01:00Z",
      currency: "KRW",
    });

    expect(quotes.get("AAPL")).toMatchObject({
      lastPrice: "180.50",
      status: "stale",
      message: "시세 통화 정보가 종목 정보와 일치하지 않습니다.",
    });
    await runtime.destroy();
  });

  it("does not let a malformed WebSocket price change quote state", async () => {
    const runtime = createRuntime();
    const internals = runtime as unknown as {
      quotes: Map<string, Record<string, unknown>>;
      handleTick(tick: unknown): void;
    };
    internals.quotes.set("AAPL", {
      symbol: "AAPL",
      info: { symbol: "AAPL", name: "Apple", market: "US", currency: "USD" },
      market: "US",
      lastPrice: "180.50",
      timestamp: "2026-09-07T01:00:00Z",
      status: "ready",
      signalMemory: {},
    });

    internals.handleTick({
      symbol: "AAPL",
      market: "US",
      price: "NaN",
      timestamp: "2026-09-07T01:01:00Z",
      currency: "USD",
    });

    expect(internals.quotes.get("AAPL")).toMatchObject({
      lastPrice: "180.50",
      timestamp: "2026-09-07T01:00:00Z",
      status: "ready",
    });
    await runtime.destroy();
  });
});
