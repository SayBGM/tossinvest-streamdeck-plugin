import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { AuthSession } from "./auth-session.js";
import { TossWebSocket } from "./websocket.js";

class FakeSocket extends EventEmitter {
  static readonly OPEN = 1;
  static readonly CONNECTING = 0;
  static readonly CLOSED = 3;
  static latest?: FakeSocket;
  readyState = FakeSocket.CONNECTING;
  readonly sent: string[] = [];

  constructor(readonly url: string, readonly options: unknown) {
    super();
    FakeSocket.latest = this;
  }

  send(value: string): void { this.sent.push(value); }
  close(): void { this.readyState = FakeSocket.CLOSED; this.emit("close", 1000, Buffer.from("closed")); }
}

describe("Toss WebSocket", () => {
  it("declares full-replace subscriptions, sends PING, and dispatches ticks", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(JSON.stringify({ access_token: "token", expires_in: 86400 })));
    const auth = new AuthSession({ schemaVersion: 1, clientId: "client", clientSecret: "secret", renderMode: "realtime" }, { fetch });
    const ticks: string[] = [];
    const socket = new TossWebSocket(auth, {
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
      setTimeout, clearTimeout, setInterval, clearInterval,
      onTick: (tick) => ticks.push(`${tick.market}:${tick.symbol}:${tick.price}`),
    });
    socket.setSymbols([["005930", "KR"], ["AAPL", "US"]]);
    await vi.runOnlyPendingTimersAsync();
    const fake = FakeSocket.latest;
    expect(fake).toBeDefined();
    fake!.readyState = FakeSocket.OPEN;
    fake!.emit("open");
    const declaration = JSON.parse(fake!.sent.find((value) => value.startsWith("[")) ?? "[]");
    expect(declaration).toEqual(expect.arrayContaining([
      { type: "trade:kr", codes: ["005930"] },
      { type: "trade:us", codes: ["AAPL"] },
    ]));
    fake!.emit("message", Buffer.from(JSON.stringify({ type: "message", topic: "trade:us:AAPL", data: { price: "185.70", timestamp: "2026-09-03T22:00:00+09:00", currency: "USD" } })));
    expect(ticks).toEqual(["US:AAPL:185.70"]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fake!.sent).toContain("PING");
    socket.stop();
    vi.useRealTimers();
  });
});
