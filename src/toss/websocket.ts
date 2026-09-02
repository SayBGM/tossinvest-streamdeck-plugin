import WebSocket from "ws";
import type { Market, TradeTick } from "../types.js";
import { AuthSession } from "./auth-session.js";
import { safeMessageForError, TossError } from "./errors.js";

export type SocketState = "idle" | "connecting" | "connected" | "backoff" | "stopped";

interface SubscriptionAck {
  type?: unknown;
  subscribed?: unknown;
  rejected?: unknown;
}

interface ErrorFrame {
  type?: unknown;
  error?: { code?: unknown; message?: unknown };
}

export interface SocketOptions {
  readonly url?: string;
  readonly WebSocketImpl?: typeof WebSocket;
  readonly now?: () => number;
  readonly setTimeout?: typeof setTimeout;
  readonly clearTimeout?: typeof clearTimeout;
  readonly setInterval?: typeof setInterval;
  readonly clearInterval?: typeof clearInterval;
  readonly random?: () => number;
  readonly onTick: (tick: TradeTick) => void;
  readonly onState?: (state: SocketState, detail?: string) => void;
  readonly onRejected?: (target: string, reason: string) => void;
}

const WS_URL = "wss://openapi-ws.tossinvest.com/ws/v1";

export class TossWebSocket {
  private readonly url: string;
  private readonly WebSocketImpl: typeof WebSocket;
  private readonly now: () => number;
  private readonly setTimeoutImpl: typeof setTimeout;
  private readonly clearTimeoutImpl: typeof clearTimeout;
  private readonly setIntervalImpl: typeof setInterval;
  private readonly clearIntervalImpl: typeof clearInterval;
  private readonly random: () => number;
  private readonly desired = new Map<string, Market>();
  private socket?: WebSocket;
  private state: SocketState = "idle";
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private declarationTimer?: ReturnType<typeof setTimeout>;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private reconnectAttempt = 0;
  private stopped = false;
  private declarationId = 0;
  private connectEpoch = 0;

  constructor(private readonly auth: AuthSession, private readonly options: SocketOptions) {
    this.url = options.url ?? WS_URL;
    this.WebSocketImpl = options.WebSocketImpl ?? WebSocket;
    this.now = options.now ?? Date.now;
    this.setTimeoutImpl = options.setTimeout ?? setTimeout;
    this.clearTimeoutImpl = options.clearTimeout ?? clearTimeout;
    this.setIntervalImpl = options.setInterval ?? setInterval;
    this.clearIntervalImpl = options.clearInterval ?? clearInterval;
    this.random = options.random ?? Math.random;
  }

  get currentState(): SocketState { return this.state; }

  setSymbols(entries: ReadonlyArray<readonly [string, Market]>): void {
    this.desired.clear();
    for (const [symbol, market] of entries.slice(0, 100)) this.desired.set(symbol, market);
    if (this.desired.size === 0) {
      this.cancelReconnect();
      this.stopSocket();
      this.setState("idle");
      return;
    }
    if (!this.socket && !this.reconnectTimer && !this.stopped) void this.connect();
    else if (this.state === "connected") this.scheduleDeclare();
  }

  async reconnect(reason = "manual"): Promise<void> {
    if (this.stopped || this.desired.size === 0) return;
    this.cancelReconnect();
    this.stopSocket();
    this.reconnectAttempt = 0;
    this.setState("backoff", reason);
    await this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.connectEpoch += 1;
    this.cancelReconnect();
    this.stopSocket();
    this.desired.clear();
    this.setState("stopped");
  }

  restart(): void {
    this.connectEpoch += 1;
    if (!this.stopped) {
      this.reconnectAttempt = 0;
      this.stopSocket();
    }
    this.stopped = false;
    this.reconnectAttempt = 0;
    if (this.desired.size > 0) void this.connect();
    else this.setState("idle");
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.desired.size === 0 || this.socket) return;
    const epoch = this.connectEpoch;
    this.setState("connecting");
    let token: string;
    try {
      token = await this.auth.getToken();
    } catch (error) {
      this.setState("backoff", safeMessageForError(error));
      this.scheduleReconnect(error instanceof TossError && !error.retryable ? 30_000 : undefined);
      return;
    }

    if (this.stopped || this.desired.size === 0 || epoch !== this.connectEpoch) return;
    const socket = new this.WebSocketImpl(this.url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    this.socket = socket;
    socket.once("open", () => {
      if (this.socket !== socket || this.stopped) return;
      this.reconnectAttempt = 0;
      this.setState("connected");
      this.startHeartbeat();
      this.declare();
    });
    socket.on("message", (raw) => {
      if (this.socket !== socket) return;
      this.handleMessage(raw.toString());
    });
    socket.once("unexpected-response", (_request, response) => {
      if (this.socket !== socket) return;
      const status = response.statusCode ?? 0;
      if (status === 401) this.auth.invalidate();
      const delay = status === 401 || status === 403 ? 30_000 : undefined;
      this.options.onState?.("backoff", status === 403 ? "WTS 허용 IP를 확인해 주세요." : `websocket:${status}`);
      this.stopSocket();
      this.scheduleReconnect(delay);
    });
    socket.on("error", (error) => {
      if (this.socket !== socket) return;
      this.options.onState?.("backoff", safeMessageForError(error));
    });
    socket.once("close", (code, reason) => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      this.stopHeartbeat();
      if (this.stopped || this.desired.size === 0) {
        this.setState(this.stopped ? "stopped" : "idle");
        return;
      }
      this.setState("backoff", `close:${code}:${reason.toString().slice(0, 80)}`);
      this.scheduleReconnect();
    });
  }

  private declare(): void {
    const socket = this.socket;
    if (!socket || this.state !== "connected" || socket.readyState !== this.WebSocketImpl.OPEN) return;
    const kr = [...this.desired].filter(([, market]) => market === "KR").map(([symbol]) => symbol);
    const us = [...this.desired].filter(([, market]) => market === "US").map(([symbol]) => symbol);
    const id = `toss-${this.now()}-${++this.declarationId}`;
    const declaration: Array<Record<string, unknown>> = [{ id }];
    if (kr.length > 0) declaration.push({ type: "trade:kr", codes: kr });
    if (us.length > 0) declaration.push({ type: "trade:us", codes: us });
    try { socket.send(JSON.stringify(declaration)); } catch { /* close handler retries */ }
  }

  private scheduleDeclare(): void {
    if (this.declarationTimer) this.clearTimeoutImpl(this.declarationTimer);
    this.declarationTimer = this.setTimeoutImpl(() => {
      this.declarationTimer = undefined;
      this.declare();
    }, 75);
  }

  private handleMessage(raw: string): void {
    if (raw === "PING") return;
    let payload: unknown;
    try { payload = JSON.parse(raw); } catch { return; }
    if (typeof payload !== "object" || payload === null) return;
    const frame = payload as Record<string, unknown>;
    if (frame.type === "subscriptions") {
      const ack = frame as SubscriptionAck;
      if (Array.isArray(ack.rejected)) {
        for (const item of ack.rejected) {
          if (typeof item !== "object" || item === null) continue;
          const rejected = item as Record<string, unknown>;
          if (typeof rejected.target === "string") {
            this.options.onRejected?.(rejected.target, typeof rejected.code === "string" ? rejected.code : "rejected");
          }
        }
      }
      return;
    }
    if (frame.type === "error") {
      const error = frame as ErrorFrame;
      const code = typeof error.error?.code === "string" ? error.error.code : "unknown";
      this.options.onState?.("backoff", typeof error.error?.message === "string" ? error.error.message : code);
      if (code === "server-shutdown") {
        this.stopSocket();
        this.scheduleReconnect(1_000);
      }
      return;
    }
    if (frame.type !== "message" || typeof frame.topic !== "string" ||
      typeof frame.data !== "object" || frame.data === null) return;
    const match = /^trade:(kr|us):(.+)$/.exec(frame.topic);
    if (!match) return;
    const data = frame.data as Record<string, unknown>;
    if (typeof data.price !== "string" || typeof data.timestamp !== "string" ||
      typeof data.currency !== "string") return;
    const symbol = match[2];
    if (!symbol) return;
    this.options.onTick({
      symbol,
      market: match[1] === "kr" ? "KR" : "US",
      price: data.price,
      timestamp: data.timestamp,
      currency: data.currency,
    });
  }

  private scheduleReconnect(delayOverride?: number): void {
    if (this.stopped || this.desired.size === 0 || this.reconnectTimer) return;
    const exponential = Math.min(30_000, 1_000 * 2 ** Math.min(this.reconnectAttempt, 5));
    const jitter = Math.floor(exponential * 0.2 * this.random());
    const delay = delayOverride ?? exponential + jitter;
    this.reconnectAttempt += 1;
    this.reconnectTimer = this.setTimeoutImpl(() => {
      this.reconnectTimer = undefined;
      void this.connect();
    }, delay);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = this.setIntervalImpl(() => {
      const socket = this.socket;
      if (socket?.readyState === this.WebSocketImpl.OPEN) {
        try { socket.send("PING"); } catch { /* close event recovers */ }
      }
    }, 60_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) this.clearIntervalImpl(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
  }

  private stopSocket(): void {
    const socket = this.socket;
    this.socket = undefined;
    this.stopHeartbeat();
    if (this.declarationTimer) this.clearTimeoutImpl(this.declarationTimer);
    this.declarationTimer = undefined;
    if (!socket) return;
    try { socket.removeAllListeners(); } catch { /* ignored */ }
    try { socket.close(); } catch { /* ignored */ }
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer) this.clearTimeoutImpl(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

  private setState(state: SocketState, detail?: string): void {
    this.state = state;
    this.options.onState?.(state, detail);
  }
}
