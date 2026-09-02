import { describe, expect, it, vi } from "vitest";
import { selectReferencePrice, TossRestClient } from "./rest-client.js";
import { AuthSession } from "./auth-session.js";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("Toss REST client", () => {
  it("shares one token issuance for concurrent callers and batches prices", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response({ access_token: "token", expires_in: 86400 }))
      .mockResolvedValueOnce(response({ result: [{ symbol: "005930", timestamp: null, lastPrice: "72000", currency: "KRW" }] }));
    const auth = new AuthSession({ schemaVersion: 1, clientId: "client", clientSecret: "secret", renderMode: "realtime" }, { fetch });
    const client = new TossRestClient(auth, { fetch });
    await Promise.all([auth.getToken(), auth.getToken()]);
    const prices = await client.getPrices(["005930"]);
    expect(prices[0]?.lastPrice).toBe("72000");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String(fetch.mock.calls[1]?.[0])).toContain("symbols=005930");
  });

  it("selects the candle before the quote trading date", () => {
    expect(selectReferencePrice([
      { timestamp: "2026-09-03T09:00:00+09:00", closePrice: "110", currency: "KRW" },
      { timestamp: "2026-09-02T09:00:00+09:00", closePrice: "100", currency: "KRW" },
    ], "2026-09-03T10:00:00+09:00")).toBe("100");
    expect(selectReferencePrice([
      { timestamp: "2026-09-02T09:00:00+09:00", closePrice: "100", currency: "KRW" },
    ], "2026-09-03T10:00:00+09:00")).toBe("100");
  });
});
