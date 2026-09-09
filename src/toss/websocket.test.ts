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
  static instances: FakeSocket[] = [];
  readyState = FakeSocket.CONNECTING;
  readonly sent: string[] = [];
  readonly terminate = vi.fn(() => {
    this.readyState = FakeSocket.CLOSED;
    this.emit("close", 1006, Buffer.from("terminated"));
  });

  constructor(readonly url: string, readonly options: unknown) {
    super();
    FakeSocket.latest = this;
    FakeSocket.instances.push(this);
  }

  send(value: string): void { this.sent.push(value); }
  close(): void { this.readyState = FakeSocket.CLOSED; this.emit("close", 1000, Buffer.from("closed")); }
}

describe("Toss WebSocket", () => {
  it("shares an in-flight authentication connection and drops a stale continuation", async () => {
    FakeSocket.instances = [];
    let resolveTokenResponse: ((response: Response) => void) | undefined;
    const fetch = vi.fn<typeof globalThis.fetch>(
      () => new Promise<Response>((resolve) => { resolveTokenResponse = resolve; }),
    );
    const auth = new AuthSession({ schemaVersion: 1, clientId: "client", clientSecret: "secret", renderMode: "realtime", signalDurationSec: 5 }, { fetch });
    const socket = new TossWebSocket(auth, {
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
      onTick: () => undefined,
    });

    socket.setSymbols([["005930", "KR"]]);
    socket.setSymbols([["005930", "KR"], ["AAPL", "US"]]);
    expect(fetch).toHaveBeenCalledTimes(1);

    resolveTokenResponse?.(new Response(JSON.stringify({ access_token: "token", expires_in: 86400 })));
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1));

    socket.setSymbols([]);
    expect(() => FakeSocket.instances[0]?.emit("error", new Error("late close error"))).not.toThrow();
    socket.stop();
  });

  it("does not open a socket after stop while authentication is pending", async () => {
    FakeSocket.instances = [];
    let resolveTokenResponse: ((response: Response) => void) | undefined;
    const fetch = vi.fn<typeof globalThis.fetch>(
      () => new Promise<Response>((resolve) => { resolveTokenResponse = resolve; }),
    );
    const auth = new AuthSession({ schemaVersion: 1, clientId: "client", clientSecret: "secret", renderMode: "realtime", signalDurationSec: 5 }, { fetch });
    const socket = new TossWebSocket(auth, {
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
      onTick: () => undefined,
    });

    socket.setSymbols([["005930", "KR"]]);
    socket.stop();
    resolveTokenResponse?.(new Response(JSON.stringify({ access_token: "token", expires_in: 86400 })));
    await Promise.resolve();
    await Promise.resolve();
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it("declares full-replace subscriptions, sends PING, and dispatches ticks", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(JSON.stringify({ access_token: "token", expires_in: 86400 })));
    const auth = new AuthSession({ schemaVersion: 1, clientId: "client", clientSecret: "secret", renderMode: "realtime", signalDurationSec: 5 }, { fetch });
    const ticks: string[] = [];
    const socket = new TossWebSocket(auth, {
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
      setTimeout, clearTimeout, setInterval, clearInterval,
      onTick: (tick) => ticks.push(`${tick.market}:${tick.symbol}:${tick.price}`),
    });
    socket.setSymbols([["005930", "KR"], ["AAPL", "US"]]);
    await vi.advanceTimersByTimeAsync(0);
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

  it("abandons a socket whose handshake never opens and retries it", async () => {
    vi.useFakeTimers();
    FakeSocket.instances = [];
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(JSON.stringify({ access_token: "token", expires_in: 86400 })));
    const auth = new AuthSession({ schemaVersion: 1, clientId: "client", clientSecret: "secret", renderMode: "realtime", signalDurationSec: 5 }, { fetch });
    const states: string[] = [];
    const socket = new TossWebSocket(auth, {
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
      setTimeout, clearTimeout, setInterval, clearInterval, random: () => 0,
      handshakeTimeoutMs: 100, onTick: () => undefined,
      onState: (state, detail) => states.push(`${state}:${detail ?? ""}`),
    });

    socket.setSymbols([["005930", "KR"]]);
    await vi.advanceTimersByTimeAsync(0);
    const first = FakeSocket.latest!;
    await vi.advanceTimersByTimeAsync(100);
    expect(first.readyState).toBe(FakeSocket.CLOSED);
    expect(first.terminate).toHaveBeenCalledTimes(1);
    expect(socket.currentState).toBe("backoff");
    expect(states).toContain("backoff:handshake-timeout");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeSocket.instances).toHaveLength(2);
    socket.stop();
    vi.useRealTimers();
  });

  it("keeps a quiet subscription connected across repeated pong replies, then ignores a stale socket pong", async () => {
    vi.useFakeTimers();
    FakeSocket.instances = [];
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(JSON.stringify({ access_token: "token", expires_in: 86400 })));
    const auth = new AuthSession({ schemaVersion: 1, clientId: "client", clientSecret: "secret", renderMode: "realtime", signalDurationSec: 5 }, { fetch });
    const socket = new TossWebSocket(auth, {
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
      setTimeout, clearTimeout, setInterval, clearInterval, random: () => 0,
      heartbeatIntervalMs: 60, heartbeatTimeoutMs: 20, onTick: () => undefined,
    });

    socket.setSymbols([["005930", "KR"]]);
    await vi.advanceTimersByTimeAsync(0);
    const first = FakeSocket.latest!;
    first.readyState = FakeSocket.OPEN;
    first.emit("open");
    for (let round = 0; round < 3; round += 1) {
      await vi.advanceTimersToNextTimerAsync();
      expect(first.sent).toContain("PING");
      // 체결 메시지 없이 pong만 와도 정상 연결을 유지한다.
      first.emit("message", Buffer.from(JSON.stringify({ type: "pong" })));
      await vi.advanceTimersByTimeAsync(1);
      expect(socket.currentState).toBe("connected");
    }

    await vi.advanceTimersToNextTimerAsync();
    await vi.advanceTimersByTimeAsync(20);
    expect(first.readyState).toBe(FakeSocket.CLOSED);
    expect(first.terminate).toHaveBeenCalledTimes(1);
    expect(socket.currentState).toBe("backoff");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeSocket.instances).toHaveLength(2);
    const second = FakeSocket.latest!;
    second.readyState = FakeSocket.OPEN;
    second.emit("open");
    await vi.advanceTimersToNextTimerAsync();
    // 해제된 이전 socket의 pong이 새 socket의 deadline을 취소하면 안 된다.
    first.emit("message", Buffer.from(JSON.stringify({ type: "pong" })));
    await vi.advanceTimersByTimeAsync(20);
    expect(second.terminate).toHaveBeenCalledTimes(1);
    socket.stop();
    vi.useRealTimers();
  });

  it("does not extend an unanswered heartbeat deadline when the interval is shorter", async () => {
    vi.useFakeTimers();
    FakeSocket.instances = [];
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(JSON.stringify({ access_token: "token", expires_in: 86400 })));
    const auth = new AuthSession({ schemaVersion: 1, clientId: "client", clientSecret: "secret", renderMode: "realtime", signalDurationSec: 5 }, { fetch });
    const socket = new TossWebSocket(auth, {
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
      setTimeout, clearTimeout, setInterval, clearInterval, random: () => 0,
      heartbeatIntervalMs: 10, heartbeatTimeoutMs: 25, onTick: () => undefined,
    });

    socket.setSymbols([["005930", "KR"]]);
    await vi.advanceTimersByTimeAsync(0);
    const first = FakeSocket.latest!;
    first.readyState = FakeSocket.OPEN;
    first.emit("open");
    await vi.advanceTimersByTimeAsync(34);
    expect(first.sent.filter((value) => value === "PING")).toHaveLength(1);
    expect(first.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(first.terminate).toHaveBeenCalledTimes(1);
    socket.stop();
    vi.useRealTimers();
  });
});
