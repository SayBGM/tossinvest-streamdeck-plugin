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
  /** 연결 수립이 이 시간 안에 완료되지 않으면 새 연결을 시도한다. 기본 15초. */
  readonly handshakeTimeoutMs?: number;
  /** 공식 권장 PING 주기. 기본 60초. */
  readonly heartbeatIntervalMs?: number;
  /** 텍스트 PING 뒤 pong을 기다리는 시간. 기본 15초. */
  readonly heartbeatTimeoutMs?: number;
  readonly onTick: (tick: TradeTick) => void;
  readonly onState?: (state: SocketState, detail?: string) => void;
  readonly onRejected?: (target: string, reason: string) => void;
}

const WS_URL = "wss://openapi-ws.tossinvest.com/ws/v1";
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 15_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 60_000;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 15_000;

export class TossWebSocket {
  private readonly url: string;
  private readonly WebSocketImpl: typeof WebSocket;
  private readonly now: () => number;
  private readonly setTimeoutImpl: typeof setTimeout;
  private readonly clearTimeoutImpl: typeof clearTimeout;
  private readonly setIntervalImpl: typeof setInterval;
  private readonly clearIntervalImpl: typeof clearInterval;
  private readonly random: () => number;
  private readonly handshakeTimeoutMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly heartbeatTimeoutMs: number;
  private readonly desired = new Map<string, Market>();
  private socket?: WebSocket;
  private state: SocketState = "idle";
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private declarationTimer?: ReturnType<typeof setTimeout>;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private handshakeTimer?: ReturnType<typeof setTimeout>;
  private heartbeatDeadlineTimer?: ReturnType<typeof setTimeout>;
  private reconnectAttempt = 0;
  private stopped = false;
  private declarationId = 0;
  private connectEpoch = 0;
  private connectInFlight?: { readonly epoch: number; readonly operation: Promise<void> };

  constructor(private readonly auth: AuthSession, private readonly options: SocketOptions) {
    this.url = options.url ?? WS_URL;
    this.WebSocketImpl = options.WebSocketImpl ?? WebSocket;
    this.now = options.now ?? Date.now;
    this.setTimeoutImpl = options.setTimeout ?? setTimeout;
    this.clearTimeoutImpl = options.clearTimeout ?? clearTimeout;
    this.setIntervalImpl = options.setInterval ?? setInterval;
    this.clearIntervalImpl = options.clearInterval ?? clearInterval;
    this.random = options.random ?? Math.random;
    this.handshakeTimeoutMs = options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;
  }

  get currentState(): SocketState { return this.state; }

  setSymbols(entries: ReadonlyArray<readonly [string, Market]>): void {
    this.desired.clear();
    for (const [symbol, market] of entries.slice(0, 100)) this.desired.set(symbol, market);
    if (this.desired.size === 0) {
      // A token request may still be pending while there is no socket object
      // to close. Advance the epoch so its continuation cannot open one.
      this.connectEpoch += 1;
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
    this.connectEpoch += 1;
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

  private connect(): Promise<void> {
    const epoch = this.connectEpoch;
    if (this.connectInFlight?.epoch === epoch) {
      return this.connectInFlight.operation;
    }
    const operation = this.connectForEpoch(epoch);
    this.connectInFlight = { epoch, operation };
    void operation.then(
      () => {
        if (this.connectInFlight?.operation === operation) {
          this.connectInFlight = undefined;
        }
      },
      () => {
        if (this.connectInFlight?.operation === operation) {
          this.connectInFlight = undefined;
        }
      },
    );
    return operation;
  }

  private async connectForEpoch(epoch: number): Promise<void> {
    if (this.stopped || this.desired.size === 0 || this.socket || epoch !== this.connectEpoch) return;
    this.setState("connecting");
    let token: string;
    try {
      token = await this.auth.getToken();
    } catch (error) {
      if (epoch !== this.connectEpoch || this.stopped || this.desired.size === 0) return;
      this.setState("backoff", safeMessageForError(error));
      this.scheduleReconnect(error instanceof TossError && !error.retryable ? 30_000 : undefined);
      return;
    }

    if (this.stopped || this.desired.size === 0 || epoch !== this.connectEpoch) return;
    let socket: WebSocket;
    try {
      socket = new this.WebSocketImpl(this.url, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (error) {
      if (epoch !== this.connectEpoch || this.stopped || this.desired.size === 0) return;
      this.setState("backoff", safeMessageForError(error));
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    this.startHandshakeTimeout(socket);
    socket.once("open", () => {
      if (this.socket !== socket || this.stopped) return;
      this.stopHandshakeTimeout();
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
      this.reconnectFrom(socket, status === 403 ? "WTS 허용 IP를 확인해 주세요." : `websocket:${status}`, delay);
    });
    socket.on("error", (error) => {
      if (this.socket !== socket) return;
      this.reconnectFrom(socket, safeMessageForError(error));
    });
    socket.once("close", (code, reason) => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      this.stopHeartbeat();
      this.stopHandshakeTimeout();
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
    let payload: unknown;
    try { payload = JSON.parse(raw); } catch { return; }
    if (typeof payload !== "object" || payload === null) return;
    const frame = payload as Record<string, unknown>;
    if (frame.type === "pong") {
      // 텍스트 PING의 공식 응답이다. 체결 틱은 거래가 없으면 오지 않으므로
      // 연결 생존 판단에 쓰지 않는다.
      this.stopHeartbeatDeadline();
      return;
    }
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
      if (code === "server-shutdown") {
        const socket = this.socket;
        if (socket) this.reconnectFrom(socket, typeof error.error?.message === "string" ? error.error.message : code, 1_000);
      } else {
        this.setState("backoff", typeof error.error?.message === "string" ? error.error.message : code);
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
      if (!socket || socket.readyState !== this.WebSocketImpl.OPEN || this.state !== "connected") return;
      // 응답을 기다리는 PING이 있으면 다음 PING으로 deadline을 연장하지 않는다.
      if (this.heartbeatDeadlineTimer !== undefined) return;
      this.sendHeartbeat(socket);
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== undefined) this.clearIntervalImpl(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
    this.stopHeartbeatDeadline();
  }

  private sendHeartbeat(socket: WebSocket): void {
    // 일부 구현은 send 중 동기적으로 message 이벤트를 낼 수 있다. 먼저 arm해야
    // 즉시 도착한 pong이 deadline을 확실히 해제한다.
    this.stopHeartbeatDeadline();
    this.heartbeatDeadlineTimer = this.setTimeoutImpl(() => {
      this.heartbeatDeadlineTimer = undefined;
      if (this.socket === socket) this.reconnectFrom(socket, "heartbeat-timeout");
    }, this.heartbeatTimeoutMs);
    try {
      socket.send("PING");
    } catch {
      this.stopHeartbeatDeadline();
      this.reconnectFrom(socket, "heartbeat-send-failed");
      return;
    }
  }

  private stopHeartbeatDeadline(): void {
    if (this.heartbeatDeadlineTimer !== undefined) this.clearTimeoutImpl(this.heartbeatDeadlineTimer);
    this.heartbeatDeadlineTimer = undefined;
  }

  private startHandshakeTimeout(socket: WebSocket): void {
    this.stopHandshakeTimeout();
    this.handshakeTimer = this.setTimeoutImpl(() => {
      this.handshakeTimer = undefined;
      if (this.socket === socket && socket.readyState !== this.WebSocketImpl.OPEN) {
        this.reconnectFrom(socket, "handshake-timeout");
      }
    }, this.handshakeTimeoutMs);
  }

  private stopHandshakeTimeout(): void {
    if (this.handshakeTimer !== undefined) this.clearTimeoutImpl(this.handshakeTimer);
    this.handshakeTimer = undefined;
  }

  private reconnectFrom(socket: WebSocket, detail: string, delayOverride?: number): void {
    if (this.socket !== socket) return;
    // close 이벤트가 오지 않는 half-open 연결도 있으므로 먼저 소유권을 끊는다.
    this.connectEpoch += 1;
    this.stopSocket(true);
    if (this.stopped || this.desired.size === 0) {
      this.setState(this.stopped ? "stopped" : "idle", detail);
      return;
    }
    this.setState("backoff", detail);
    this.scheduleReconnect(delayOverride);
  }

  private stopSocket(terminate = false): void {
    const socket = this.socket;
    this.socket = undefined;
    this.stopHeartbeat();
    this.stopHandshakeTimeout();
    if (this.declarationTimer !== undefined) this.clearTimeoutImpl(this.declarationTimer);
    this.declarationTimer = undefined;
    if (!socket) return;
    // Keep the error listener registered while a CONNECTING socket is closed.
    // ws can emit its connection error on a later tick; removing every
    // listener here turns that ordinary shutdown into an uncaught exception.
    try {
      if (terminate) socket.terminate();
      else socket.close();
    } catch { /* ignored */ }
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer !== undefined) this.clearTimeoutImpl(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

  private setState(state: SocketState, detail?: string): void {
    this.state = state;
    this.options.onState?.(state, detail);
  }
}
