import { describe, expect, it, vi } from "vitest";
import {
  marketDate,
  selectReferencePrice,
  TossRestClient,
} from "./rest-client.js";
import { AuthSession } from "./auth-session.js";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Toss REST client", () => {
  it("shares one token issuance for concurrent callers and batches prices", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        response({ access_token: "token", expires_in: 86400 }),
      )
      .mockResolvedValueOnce(
        response({
          result: [
            {
              symbol: "005930",
              timestamp: null,
              lastPrice: "72000",
              currency: "KRW",
            },
          ],
        }),
      );
    const auth = new AuthSession(
      {
        schemaVersion: 1,
        clientId: "client",
        clientSecret: "secret",
        renderMode: "realtime",
        signalDurationSec: 5,
      },
      { fetch },
    );
    const client = new TossRestClient(auth, { fetch });
    await Promise.all([auth.getToken(), auth.getToken()]);
    const prices = await client.getPrices(["005930"]);
    expect(prices[0]?.lastPrice).toBe("72000");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String(fetch.mock.calls[1]?.[0])).toContain("symbols=005930");
  });

  it("selects the candle before the quote trading date", () => {
    expect(
      selectReferencePrice(
        [
          {
            timestamp: "2026-09-03T09:00:00+09:00",
            closePrice: "110",
            currency: "KRW",
          },
          {
            timestamp: "2026-09-02T09:00:00+09:00",
            closePrice: "100",
            currency: "KRW",
          },
        ],
        "2026-09-03T10:00:00+09:00",
        "KR",
      ),
    ).toBe("100");

    expect(
      selectReferencePrice(
        [
          {
            timestamp: "2026-09-02T09:00:00+09:00",
            closePrice: "100",
            currency: "KRW",
          },
        ],
        "2026-09-03T10:00:00+09:00",
        "KR",
      ),
    ).toBe("100");

    // US stock: today is Sep 2 EDT (Sep 3 KST). Yesterday is Sep 1 EDT.
    expect(
      selectReferencePrice(
        [
          {
            timestamp: "2026-09-02T13:30:00Z",
            closePrice: "185.50",
            currency: "USD",
          },
          {
            timestamp: "2026-09-01T13:30:00Z",
            closePrice: "180.00",
            currency: "USD",
          },
        ],
        "2026-09-02T17:30:00Z",
        "US",
      ),
    ).toBe("180.00");

    // Null timestamp fallback: selects previous day sorted[1] (전일 종가)
    expect(
      selectReferencePrice(
        [
          {
            timestamp: "2026-09-02T13:30:00Z",
            closePrice: "185.50",
            currency: "USD",
          },
          {
            timestamp: "2026-09-01T13:30:00Z",
            closePrice: "180.00",
            currency: "USD",
          },
        ],
        null,
        "US",
      ),
    ).toBe("180.00");
  });

  it("formats market dates for KR (Asia/Seoul) and US (America/New_York), falling back on invalid input", () => {
    expect(marketDate("2026-09-02T16:00:00Z", "KR")).toBe("2026-09-03");
    expect(marketDate("2026-09-02T16:00:00Z", "US")).toBe("2026-09-02");
    expect(marketDate("2026-09-02T16:00:00Z")).toBe("2026-09-03");
    expect(marketDate("not-a-real-date")).toBe("not-a-real");
  });

  it("fetches and normalizes price limits, mapping null to undefined", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        response({ access_token: "token", expires_in: 86400 }),
      )
      .mockResolvedValueOnce(
        response({
          result: {
            timestamp: "2026-09-07T09:00:00+09:00",
            upperLimitPrice: "93600",
            lowerLimitPrice: "50400",
            currency: "KRW",
          },
        }),
      );
    const auth = new AuthSession(
      {
        schemaVersion: 1,
        clientId: "client",
        clientSecret: "secret",
        renderMode: "realtime",
        signalDurationSec: 5,
      },
      { fetch },
    );
    const client = new TossRestClient(auth, { fetch });
    const limit = await client.getPriceLimit("005930");
    expect(limit).toEqual({
      timestamp: "2026-09-07T09:00:00+09:00",
      upperLimitPrice: "93600",
      lowerLimitPrice: "50400",
      currency: "KRW",
    });
    expect(String(fetch.mock.calls[1]?.[0])).toContain(
      "/api/v1/price-limits?symbol=005930",
    );

    const fetchUs = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        response({ access_token: "token", expires_in: 86400 }),
      )
      .mockResolvedValueOnce(
        response({
          result: {
            timestamp: null,
            upperLimitPrice: null,
            lowerLimitPrice: null,
            currency: "USD",
          },
        }),
      );
    const authUs = new AuthSession(
      {
        schemaVersion: 1,
        clientId: "client",
        clientSecret: "secret",
        renderMode: "realtime",
        signalDurationSec: 5,
      },
      { fetch: fetchUs },
    );
    const clientUs = new TossRestClient(authUs, { fetch: fetchUs });
    const usLimit = await clientUs.getPriceLimit("AAPL");
    expect(usLimit).toEqual({
      timestamp: null,
      upperLimitPrice: undefined,
      lowerLimitPrice: undefined,
      currency: "USD",
    });
  });

  it("normalizes symbols before building URLs and enforces the candle count range", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        response({ access_token: "token", expires_in: 86400 }),
      )
      .mockResolvedValueOnce(
        response({ result: [{ symbol: "AAPL", timestamp: null, lastPrice: "0", currency: "USD" }] }),
      );
    const auth = new AuthSession(
      {
        schemaVersion: 1,
        clientId: "client",
        clientSecret: "secret",
        renderMode: "realtime",
        signalDurationSec: 5,
      },
      { fetch },
    );
    const client = new TossRestClient(auth, { fetch });
    await client.getPrices([" aapl "]);
    expect(String(fetch.mock.calls[1]?.[0])).toContain("symbols=AAPL");
    await expect(client.getCandles("AAPL", 0)).rejects.toMatchObject({
      code: "API",
      retryable: false,
    });
    await expect(client.getCandles("AAPL", 201)).rejects.toMatchObject({
      code: "API",
      retryable: false,
    });
    await expect(client.getPrices(["bad symbol"])).rejects.toMatchObject({
      code: "INVALID_SYMBOL",
    });
  });

  it("does not wait indefinitely for an excessive valid Retry-After value", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        response({ access_token: "token", expires_in: 86400 }),
      )
      .mockResolvedValueOnce(
        new Response("", {
          status: 429,
          headers: { "Retry-After": "120" },
        }),
      );
    const auth = new AuthSession(
      {
        schemaVersion: 1,
        clientId: "client",
        clientSecret: "secret",
        renderMode: "realtime",
        signalDurationSec: 5,
      },
      { fetch },
    );
    const client = new TossRestClient(auth, { fetch });
    await expect(client.getPrices(["005930"])).rejects.toMatchObject({
      code: "RATE_LIMITED",
      retryable: true,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
