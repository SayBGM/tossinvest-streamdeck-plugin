import type { Action } from "@elgato/streamdeck";
import type {
  GlobalSettingsV1,
  Market,
  QuoteActionSettingsV1,
  QuoteView,
  Signal,
  TradeTick,
} from "./types.js";
import {
  migrateActionSettings,
  migrateGlobalSettings,
  normalizeSymbol,
} from "./settings.js";
import { renderQuoteCard, svgToDataUri } from "./renderer/card.js";
import { RenderScheduler } from "./renderer/scheduler.js";
import { AuthSession } from "./toss/auth-session.js";
import { TossError, safeMessageForError } from "./toss/errors.js";
import {
  TossRestClient,
  selectReferencePrice,
} from "./toss/rest-client.js";
import { TossWebSocket } from "./toss/websocket.js";
import { isPriceText } from "./toss/response-validation.js";
import { safeErrorMessage, safeSerialize } from "./core/safe-log.js";
import { detectSignal, type SignalInput } from "./signals/detector.js";
import { movingAverage, signalSessionKey } from "./signals/indicators.js";
import {
  acceptsPriceUpdate,
  beginQuoteSession,
  createQuoteState,
  isQuoteSessionContextCurrent,
  mergeQuoteHighLow,
  numberOrUndefined,
  sessionDateFor,
  timestampMillis,
  type QuoteState,
} from "./runtime/quote-state.js";
import { chunkSymbols, RefreshCoordinator } from "./runtime/refresh-coordinator.js";
import { planSubscriptions } from "./runtime/subscription-plan.js";

export interface ActionPort {
  readonly id: string;
  setImage(image: string): Promise<void>;
  showAlert?(): Promise<void>;
}

interface Binding {
  readonly action: ActionPort;
  readonly generation: number;
  settings: QuoteActionSettingsV1;
}

export interface PiSender {
  (actionId: string, message: unknown): Promise<void>;
}

const ACTION_UUID = "com.saybgm.tossinvest.quote";
const SUBSCRIPTION_LIMIT_MESSAGE =
  "실시간 구독 한도 100종목 초과 · 시세를 주기적으로 조회합니다. 다른 종목 키를 제거하면 자동 복구됩니다.";
const CURRENCY_MISMATCH_MESSAGE = "시세 통화 정보가 종목 정보와 일치하지 않습니다.";

export class QuoteRuntime {
  readonly auth: AuthSession;
  readonly rest: TossRestClient;
  readonly socket: TossWebSocket;
  readonly scheduler = new RenderScheduler();
  private globalSettings: GlobalSettingsV1 = migrateGlobalSettings({});
  private readonly bindings = new Map<string, Binding>();
  private readonly quotes = new Map<string, QuoteState>();
  private readonly piSender?: PiSender;
  private readonly openUrlImpl?: (url: string) => Promise<void>;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private destroyed = false;
  private readonly refreshes = new RefreshCoordinator();
  private refreshEpoch = 0;
  private readonly quoteStatusPushes = new Map<string, string>();

  constructor(
    options: {
      readonly piSender?: PiSender;
      readonly settings?: unknown;
      readonly fetch?: typeof globalThis.fetch;
      readonly socketUrl?: string;
      readonly WebSocketImpl?: ConstructorParameters<
        typeof TossWebSocket
      >[1]["WebSocketImpl"];
      readonly openUrl?: (url: string) => Promise<void>;
    } = {},
  ) {
    this.globalSettings = migrateGlobalSettings(options.settings);
    this.auth = new AuthSession(this.globalSettings, { fetch: options.fetch });
    this.rest = new TossRestClient(this.auth, { fetch: options.fetch });
    this.piSender = options.piSender;
    this.openUrlImpl = options.openUrl;
    this.socket = new TossWebSocket(this.auth, {
      url: options.socketUrl,
      WebSocketImpl: options.WebSocketImpl,
      onTick: (tick) => this.handleTick(tick),
      onState: (state, detail) => {
        if (state === "connected" || state === "backoff") void this.renderAll();
        void this.sendPush({ type: "connection", state, detail });
      },
      onRejected: (target, reason) => {
        const match = /^trade:(?:kr|us):(.+)$/.exec(target);
        if (!match) return;
        const symbol = match[1];
        if (!symbol) return;
        const quote = this.quotes.get(symbol);
        if (quote) {
          quote.subscriptionRejected = true;
          if (quote.lastPrice) {
            quote.status = "stale";
            quote.message = "실시간 구독을 할 수 없어 REST 시세를 표시합니다.";
          } else {
            quote.status = "invalid-symbol";
            quote.message = reason === "stock-not-found"
              ? "종목을 찾을 수 없습니다."
              : "구독할 수 없는 종목입니다.";
          }
          void this.renderSymbol(symbol);
        }
      },
    });
    this.schedulePeriodicRefresh();
  }

  get settings(): GlobalSettingsV1 {
    return this.globalSettings;
  }
  get actionUuid(): string {
    return ACTION_UUID;
  }

  async updateGlobalSettings(
    raw: unknown,
    options: { readonly deferRefresh?: boolean } = {},
  ): Promise<void> {
    const next = migrateGlobalSettings(raw);
    const previousMode = this.globalSettings.renderMode;
    const changed = this.auth.updateSettings(next);
    this.globalSettings = next;
    if (previousMode !== next.renderMode) {
      const interval = next.renderMode === "economy" ? 1_000 : 100;
      for (const binding of this.bindings.values()) {
        this.scheduler.updateInterval(
          binding.action.id,
          binding.generation,
          interval,
        );
      }
      await this.renderAll();
    }
    if (changed) {
      this.refreshEpoch += 1;
      this.socket.restart();
      for (const quote of this.quotes.values()) {
        quote.status = "connecting";
        quote.message = undefined;
      }
      if (options.deferRefresh) {
        void this.refreshAll().catch(() => {
          // refreshAll normally converts failures to safe quote states. Keep a
          // defensive boundary because credential-save acknowledgement must
          // not become an unhandled rejection.
        });
      } else {
        await this.refreshAll();
      }
    }
    await this.sendPush({
      type: "global-settings",
      settings: this.publicGlobalSettings(),
    });
  }

  async appear(action: ActionPort, rawSettings: unknown): Promise<void> {
    const settings = migrateActionSettings(rawSettings);
    const interval = this.globalSettings.renderMode === "economy" ? 1_000 : 100;
    const generation = this.scheduler.activate(action.id, interval);
    this.bindings.set(action.id, { action, generation, settings });
    this.ensureQuote(settings.symbol);
    await this.renderAction(action.id);
    await this.refreshAll();
  }

  async settingsChanged(
    action: ActionPort,
    rawSettings: unknown,
  ): Promise<void> {
    const previous = this.bindings.get(action.id);
    if (previous) this.scheduler.remove(action.id, previous.generation);
    const settings = migrateActionSettings(rawSettings);
    const interval = this.globalSettings.renderMode === "economy" ? 1_000 : 100;
    const generation = this.scheduler.activate(action.id, interval);
    this.bindings.set(action.id, { action, generation, settings });
    const quote = this.ensureQuote(settings.symbol);
    await this.renderAction(action.id);
    const requiresRefresh = !previous ||
      previous.settings.symbol !== settings.symbol ||
      previous.settings.market !== settings.market ||
      !quote?.info;
    if (requiresRefresh) await this.refreshAll();
    else this.reconcileSubscriptions();
  }

  disappear(actionId: string): void {
    const binding = this.bindings.get(actionId);
    if (!binding) return;
    this.scheduler.remove(actionId, binding.generation);
    this.bindings.delete(actionId);
    this.quoteStatusPushes.delete(actionId);
    this.reconcileSubscriptions();
  }

  async keyDown(action: ActionPort): Promise<void> {
    const binding = this.bindings.get(action.id);
    if (!binding) return;
    const activeQuote = this.quotes.get(binding.settings.symbol);
    if (activeQuote?.activeSignal) {
      this.clearSignal(activeQuote);
      return;
    }
    if (
      binding.settings.keyBehavior === "open" &&
      binding.settings.symbol &&
      binding.settings.market
    ) {
      const url =
        binding.settings.market === "KR"
          ? `https://www.tossinvest.com/stocks/A${binding.settings.symbol}/order`
          : `https://www.tossinvest.com/stocks/${binding.settings.symbol}/order`;
      try {
        await this.openUrl(url);
      } catch (error) {
        await this.showActionAlert(action);
        throw error;
      }
    } else if (binding.settings.keyBehavior === "toggle-view") {
      const current = binding.settings.viewMode || "chart";
      binding.settings.viewMode = current === "chart" ? "detail" : "chart";
      await this.renderAction(action.id, true);
      await this.sendPush({
        type: "settings-updated",
        actionId: action.id,
        settings: binding.settings,
      });
    } else if (binding.settings.keyBehavior === "refresh") {
      const quote = this.quotes.get(binding.settings.symbol);
      if (quote) {
        quote.refreshing = true;
        await this.renderAction(action.id, true);
      }
      try {
        const refreshed = await this.refreshSymbol(binding.settings.symbol, true);
        if (!refreshed) await this.showActionAlert(action);
      } finally {
        if (quote) {
          quote.refreshing = false;
          await this.renderAction(action.id, true);
        }
      }
    }
  }

  async resolveSymbol(raw: unknown): Promise<QuoteActionSettingsV1> {
    const symbol = normalizeSymbol(raw);
    if (!symbol) throw new TossError("INVALID_SYMBOL", "Invalid symbol", false);
    const info = await this.rest.resolveSymbol(symbol);
    const market = this.rest.marketFor(info);
    return {
      schemaVersion: 1,
      symbol: info.symbol.toUpperCase(),
      name: info.name,
      market,
      currency: info.currency,
      keyBehavior: "refresh",
      colorTheme: "kr",
      showChart: true,
      viewMode: "chart",
      showCurrencySymbol: true,
    };
  }

  preview(rawSettings: unknown): string {
    const settings = migrateActionSettings(rawSettings);
    const view = this.viewFor(settings);
    if (view.status !== "ready" && settings.symbol) {
      const sampleView: QuoteView = {
        ...view,
        status: "ready",
        name: view.name || settings.name || settings.symbol,
        lastPrice:
          view.lastPrice ?? (settings.currency === "USD" ? "180.50" : "72000"),
        referencePrice:
          view.referencePrice ??
          (settings.currency === "USD" ? "175.00" : "70500"),
        highPrice:
          view.highPrice ?? (settings.currency === "USD" ? "182.50" : "73500"),
        lowPrice:
          view.lowPrice ?? (settings.currency === "USD" ? "174.00" : "70000"),
        sparkline:
          view.sparkline ??
          (settings.currency === "USD"
            ? [172, 174, 173, 176, 178, 180.5]
            : [69000, 70000, 69500, 70500, 71000, 72000]),
      };
      return svgToDataUri(renderQuoteCard(sampleView));
    }
    return svgToDataUri(renderQuoteCard(view));
  }

  async testCredentials(): Promise<void> {
    await this.auth.test();
  }

  publicGlobalSettings(): GlobalSettingsV1 {
    return this.sanitizedGlobalSettings();
  }

  /** Safe current state for a Property Inspector that opens after a render. */
  quoteStatus(actionId: string):
    | { readonly status: QuoteView["status"]; readonly message?: string; readonly live: boolean }
    | undefined {
    const binding = this.bindings.get(actionId);
    if (!binding) return undefined;
    const view = this.viewFor(binding.settings);
    return { status: view.status, message: view.message, live: view.live === true };
  }

  async sendPush(message: unknown): Promise<void> {
    if (!this.piSender) return;
    for (const actionId of this.bindings.keys()) {
      try {
        await this.piSender(actionId, message);
      } catch {
        /* PI may have closed */
      }
    }
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    this.refreshEpoch += 1;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshes.destroy();
    for (const quote of this.quotes.values()) {
      if (quote.activeSignal) {
        clearTimeout(quote.activeSignal.timer);
        quote.activeSignal = undefined;
      }
    }
    this.socket.stop();
    this.scheduler.destroy();
    this.bindings.clear();
    this.quoteStatusPushes.clear();
  }

  private sanitizedGlobalSettings(): GlobalSettingsV1 {
    return {
      schemaVersion: 1,
      clientId: this.globalSettings.clientId,
      clientSecret: this.globalSettings.clientSecret ? "••••••••" : "",
      renderMode: this.globalSettings.renderMode,
      signalDurationSec: this.globalSettings.signalDurationSec,
    };
  }

  private ensureQuote(symbol: string): QuoteState | undefined {
    if (!symbol) return undefined;
    const existing = this.quotes.get(symbol);
    if (existing) return existing;
    const quote = createQuoteState(symbol);
    this.quotes.set(symbol, quote);
    return quote;
  }

  private refreshAll(): Promise<void> {
    return this.refreshes.requestBatch(
      () => this.performRefresh(),
      () => this.destroyed,
    );
  }

  private async performRefresh(symbolsOverride?: readonly string[]): Promise<void> {
    if (this.destroyed) return;
    const refreshEpoch = this.refreshEpoch;
    const symbols = [...new Set(symbolsOverride ??
      [...this.bindings.values()].map((binding) => binding.settings.symbol).filter(Boolean))];
    if (symbols.length === 0) return;
    if (!this.auth.isConfigured()) {
      for (const symbol of symbols) {
        const quote = this.ensureQuote(symbol);
        if (quote) {
          quote.status = "auth-required";
          quote.message = "Property Inspector에서 API 인증정보를 입력하세요.";
        }
      }
      await this.renderAll();
      return;
    }
    for (const symbol of symbols) this.ensureQuote(symbol);
    try {
      const batches = chunkSymbols(symbols);
      const [infoBatches, priceBatches] = await Promise.all([
        Promise.all(batches.map((batch) => this.rest.getStocks(batch))),
        Promise.all(batches.map((batch) => this.rest.getPrices(batch))),
      ]);
      const infos = infoBatches.flat();
      const prices = priceBatches.flat();
      if (this.destroyed || refreshEpoch !== this.refreshEpoch) return;
      const infosBySymbol = new Map(
        infos.map((info) => [info.symbol.toUpperCase(), info]),
      );
      const pricesBySymbol = new Map(
        prices.map((price) => [price.symbol.toUpperCase(), price]),
      );
      const contexts: Array<{ symbol: string; quote: QuoteState; market: Market }> = [];
      for (const symbol of symbols) {
        const quote = this.ensureQuote(symbol);
        if (!quote) continue;
        const info = infosBySymbol.get(symbol.toUpperCase());
        const price = pricesBySymbol.get(symbol.toUpperCase());
        if (!info || !price) {
          if (quote.lastPrice) {
            quote.status = "stale";
            quote.message = "시세가 지연되었습니다.";
          } else {
            quote.status = "invalid-symbol";
            quote.message = "종목을 찾을 수 없습니다.";
          }
          continue;
        }
        if (info.currency !== price.currency) {
          quote.status = quote.lastPrice ? "stale" : "invalid-symbol";
          quote.message = CURRENCY_MISMATCH_MESSAGE;
          continue;
        }
        quote.info = info;
        const market: Market =
          info.market === "US" || info.currency === "USD" ? "US" : "KR";
        quote.market = market;
        const acceptsPrice = acceptsPriceUpdate(
          quote.timestamp,
          price.timestamp,
          "rest",
        );
        const currentTimestamp = timestampMillis(quote.timestamp);
        const priceTimestamp = timestampMillis(price.timestamp);
        const sameTimestamp = currentTimestamp !== undefined &&
          currentTimestamp === priceTimestamp;
        const priceSessionDate = sessionDateFor(price.timestamp, market);
        if (acceptsPrice && priceSessionDate) {
          beginQuoteSession(quote, priceSessionDate, price.lastPrice);
        }
        if (acceptsPrice) {
          quote.lastPrice = price.lastPrice;
          quote.timestamp = price.timestamp;
        }
        // A credential change may yield the same REST snapshot as the last
        // live tick. It is still a valid confirmation that the quote can be
        // shown again, but it must not turn a rejected subscription into live.
        if (acceptsPrice || sameTimestamp) {
          if (quote.subscriptionCapped) {
            quote.status = quote.lastPrice ? "stale" : "no-data";
            quote.message = SUBSCRIPTION_LIMIT_MESSAGE;
          } else if (quote.subscriptionRejected) {
            quote.status = quote.lastPrice ? "stale" : "invalid-symbol";
            quote.message = quote.lastPrice
              ? "실시간 구독을 할 수 없어 REST 시세를 표시합니다."
              : "구독할 수 없는 종목입니다.";
          } else {
            quote.status = "ready";
            quote.message = undefined;
          }
        }
        contexts.push({ symbol, quote, market });
      }

      // Metadata is sufficient to validate and subscribe. Start that before
      // the slower per-symbol daily-candle calls so live ticks are not held
      // behind 130-day history retrieval.
      this.reconcileSubscriptions();
      await this.renderAll();

      for (const { symbol, quote, market } of contexts) {
        // Overflow keys already have the latest REST price. Avoid one candle
        // and one price-limit request per overflow symbol until a socket slot
        // is restored for it.
        if (quote.subscriptionCapped) continue;
        if (this.destroyed || refreshEpoch !== this.refreshEpoch) return;
        const contextTimestamp = quote.timestamp;
        const contextSessionDate = sessionDateFor(contextTimestamp, market);
        const contextSessionVersion = quote.sessionVersion;
        try {
          const candles = await this.rest.getCandles(symbol, 130);
          if (this.destroyed || refreshEpoch !== this.refreshEpoch) return;
          if (!isQuoteSessionContextCurrent(
            quote,
            market,
            contextSessionDate,
            contextSessionVersion,
          )) continue;
          quote.candles = candles;
          quote.referencePrice = selectReferencePrice(
            candles,
            quote.timestamp,
            market,
          );

          const chronological = [...candles].sort((a, b) =>
            a.timestamp.localeCompare(b.timestamp),
          );
          // Sparkline mirrors prior behaviour: only the most recent 10
          // chronological candles are used, even though we now fetch a much
          // deeper history (130) to support the 120-day moving average.
          const recent = chronological.slice(-10);
          const sparkline = recent
            .map((c) => Number(c.closePrice))
            .filter((val) => Number.isFinite(val));
          if (quote.lastPrice && Number.isFinite(Number(quote.lastPrice))) {
            if (sparkline.length > 0) {
              sparkline[sparkline.length - 1] = Number(quote.lastPrice);
            } else {
              sparkline.push(Number(quote.lastPrice));
            }
          }
          quote.sparkline = sparkline;

          const latestCandle = chronological[chronological.length - 1];
          if (
            latestCandle &&
            sessionDateFor(latestCandle.timestamp, market) === contextSessionDate
          ) {
            mergeQuoteHighLow(quote, latestCandle.highPrice, latestCandle.lowPrice);
          }
          const latestPrice = numberOrUndefined(quote.lastPrice);
          if (latestPrice !== undefined) {
            mergeQuoteHighLow(quote, quote.lastPrice, quote.lastPrice);
          }

          quote.movingAverages = ([20, 60, 120] as const)
            .map((period) => ({
              period,
              value: movingAverage(candles, period, quote.timestamp, market),
            }))
            .filter(
              (entry): entry is { period: 20 | 60 | 120; value: number } =>
                entry.value !== undefined,
            );
          if (contextSessionDate) {
            quote.sessionDate = contextSessionDate;
            quote.pendingSessionDate = undefined;
          }
        } catch {
          if (this.destroyed || refreshEpoch !== this.refreshEpoch) return;
          if (!isQuoteSessionContextCurrent(
            quote,
            market,
            contextSessionDate,
            contextSessionVersion,
          )) continue;
          quote.referencePrice = undefined;
          quote.sparkline = undefined;
          quote.movingAverages = undefined;
        }

        if (market === "KR" && contextSessionDate) {
          const today = contextSessionDate;
          if (quote.priceLimit?.date !== today) {
            try {
              const limit = await this.rest.getPriceLimit(symbol);
              if (this.destroyed || refreshEpoch !== this.refreshEpoch) return;
              if (!isQuoteSessionContextCurrent(
                quote,
                market,
                contextSessionDate,
                contextSessionVersion,
              )) continue;
              quote.priceLimit = {
                upper: limit.upperLimitPrice !== undefined
                  ? Number(limit.upperLimitPrice)
                  : undefined,
                lower: limit.lowerLimitPrice !== undefined
                  ? Number(limit.lowerLimitPrice)
                  : undefined,
                date: today,
              };
            } catch {
              // Price limit is best-effort; leave it undefined and keep the
              // rest of the refresh (price/candles) intact on failure.
            }
          }
        }

        this.evaluateSignals(quote);
      }
      await this.renderAll();
    } catch (error) {
      if (this.destroyed || refreshEpoch !== this.refreshEpoch) return;
      const message = safeMessageForError(error);
      for (const symbol of symbols) {
        const quote = this.ensureQuote(symbol);
        if (quote) {
          quote.status = quote.lastPrice
            ? "stale"
            : error instanceof TossError && error.code === "INVALID_SYMBOL"
              ? "invalid-symbol"
              : "stale";
          quote.message = quote.lastPrice ? "시세가 지연되었습니다." : message;
        }
      }
      await this.renderAll();
    }
  }

  private async refreshSymbol(
    symbol: string,
    immediate = false,
  ): Promise<boolean> {
    if (!symbol) {
      await this.renderAll();
      return false;
    }
    await this.refreshes.requestSymbol(
      symbol,
      () => this.quotes.get(symbol)?.sessionVersion,
      () => this.performRefresh([symbol]),
      () => this.destroyed,
    );
    const refreshed = this.quotes.get(symbol)?.status === "ready";
    if (immediate) {
      for (const binding of this.bindings.values()) {
        if (binding.settings.symbol === symbol)
          await this.renderAction(binding.action.id, true);
      }
    }
    return refreshed;
  }

  private reconcileSubscriptions(): void {
    const plan = planSubscriptions(this.bindings.values(), this.quotes, (info) =>
      this.rest.marketFor(info),
    );
    const activeSymbols = new Set(
      [...this.bindings.values()].map((binding) => binding.settings.symbol).filter(Boolean),
    );
    for (const symbol of activeSymbols) {
      const quote = this.quotes.get(symbol);
      if (!quote?.info) continue;
      const capped = plan.cappedSymbols.has(symbol);
      if (quote.subscriptionCapped === capped) continue;
      quote.subscriptionCapped = capped;
      if (capped) {
        quote.status = quote.lastPrice ? "stale" : "no-data";
        quote.message = SUBSCRIPTION_LIMIT_MESSAGE;
      } else if (quote.message === SUBSCRIPTION_LIMIT_MESSAGE) {
        quote.status = quote.lastPrice ? "ready" : "connecting";
        quote.message = undefined;
      }
      void this.renderSymbol(symbol);
    }
    this.socket.setSymbols(plan.entries);
  }

  private handleTick(tick: TradeTick): void {
    const quote = this.quotes.get(tick.symbol.toUpperCase());
    if (!quote) return;
    // A late frame from a just-replaced declaration must not make an overflow
    // key look live again after the planner moved it to REST fallback.
    if (quote.subscriptionCapped) return;
    if (quote.market && quote.market !== tick.market) return;
    if (!isPriceText(tick.price)) return;
    if (quote.info?.currency && quote.info.currency !== tick.currency) {
      quote.status = quote.lastPrice ? "stale" : "invalid-symbol";
      quote.message = CURRENCY_MISMATCH_MESSAGE;
      void this.renderSymbol(quote.symbol);
      return;
    }
    const tickSessionDate = sessionDateFor(tick.timestamp, tick.market);
    if (!tickSessionDate || !acceptsPriceUpdate(quote.timestamp, tick.timestamp, "tick")) return;

    const isNewSession = beginQuoteSession(quote, tickSessionDate, tick.price);
    if (isNewSession) {
      void this.refreshSymbol(quote.symbol).catch(() => undefined);
    }
    quote.lastPrice = tick.price;
    quote.timestamp = tick.timestamp;
    quote.status = "ready";
    quote.message = undefined;
    quote.subscriptionRejected = false;
    quote.subscriptionCapped = false;
    const priceNum = Number(tick.price);
    if (Number.isFinite(priceNum)) mergeQuoteHighLow(quote, tick.price, tick.price);
    if (quote.sparkline && quote.sparkline.length > 0) {
      if (Number.isFinite(priceNum)) {
        const updated = [...quote.sparkline];
        updated[updated.length - 1] = priceNum;
        quote.sparkline = updated;
      }
    }
    this.evaluateSignals(quote);
    void this.renderSymbol(tick.symbol.toUpperCase());
  }

  /**
   * Runs the pure signal detector against this quote's latest state and, if
   * it reports a new signal, switches the symbol's keys to the signal card
   * for `signalDurationSec` seconds. A no-op when the quote isn't ready or
   * lacks the numbers a detector needs (this also covers "arming": the
   * detector itself withholds the very first evaluation per session).
   */
  private evaluateSignals(quote: QuoteState): void {
    if (quote.status !== "ready") return;
    const lastPrice = numberOrUndefined(quote.lastPrice);
    const referencePrice = numberOrUndefined(quote.referencePrice);
    if (lastPrice === undefined || referencePrice === undefined) return;
    const market = quote.market ?? "KR";
    const timestamp = quote.timestamp;
    const sessionDate = sessionDateFor(timestamp, market);
    if (!timestamp || !sessionDate || quote.sessionDate !== sessionDate || quote.pendingSessionDate) return;
    const sessionKey = signalSessionKey(
      quote.referencePrice as string,
      timestamp,
      market,
    );
    const input: SignalInput = {
      lastPrice,
      referencePrice,
      market,
      sessionKey,
      timestamp,
      priceText: quote.lastPrice as string,
      upperLimit: quote.priceLimit?.date === sessionDate
        ? quote.priceLimit.upper
        : undefined,
      lowerLimit: quote.priceLimit?.date === sessionDate
        ? quote.priceLimit.lower
        : undefined,
      movingAverages: quote.movingAverages ?? [],
    };
    const signal = detectSignal(quote.signalMemory, input);
    if (signal) this.showSignal(quote, signal);
  }

  private showSignal(quote: QuoteState, signal: Signal): void {
    if (quote.activeSignal) clearTimeout(quote.activeSignal.timer);
    const durationMs = Math.max(1, this.globalSettings.signalDurationSec) * 1000;
    const timer = setTimeout(() => {
      this.clearSignal(quote);
    }, durationMs);
    quote.activeSignal = { signal, timer };
    void this.renderSymbol(quote.symbol, true);
  }

  private clearSignal(quote: QuoteState): void {
    if (!quote.activeSignal) return;
    clearTimeout(quote.activeSignal.timer);
    quote.activeSignal = undefined;
    void this.renderSymbol(quote.symbol, true);
  }

  private async renderAll(): Promise<void> {
    for (const binding of this.bindings.values())
      await this.renderAction(binding.action.id);
  }

  private async renderSymbol(
    symbol: string,
    immediate = false,
  ): Promise<void> {
    for (const binding of this.bindings.values()) {
      if (binding.settings.symbol === symbol)
        await this.renderAction(binding.action.id, immediate);
    }
  }

  private async renderAction(
    actionId: string,
    immediate = false,
  ): Promise<void> {
    const binding = this.bindings.get(actionId);
    if (!binding) return;
    const view = this.viewFor(binding.settings);
    const key = safeSerialize(view);
    this.scheduler.submit(actionId, binding.generation, {
      priority: immediate ? "immediate" : "normal",
      key,
      render: () => svgToDataUri(renderQuoteCard(view)),
      commit: async (image) => {
        await binding.action.setImage(image);
        await this.sendPush({
          type: "preview",
          actionId,
          image,
        });
        await this.sendQuoteStatusIfChanged(actionId, view);
      },
    });
  }

  /** Trade ticks redraw the key, but PI status travels only on state changes. */
  private async sendQuoteStatusIfChanged(
    actionId: string,
    view: QuoteView,
  ): Promise<void> {
    const status = { status: view.status, message: view.message, live: view.live === true };
    const key = safeSerialize(status);
    if (this.quoteStatusPushes.get(actionId) === key) return;
    this.quoteStatusPushes.set(actionId, key);
    if (!this.piSender) return;
    try {
      await this.piSender(actionId, { type: "quote-status", actionId, ...status });
    } catch {
      // PI can close between scheduling and committing. Retry after a state
      // transition rather than retaining a false delivered marker.
      this.quoteStatusPushes.delete(actionId);
    }
  }

  private viewFor(settings: QuoteActionSettingsV1): QuoteView {
    const quote = this.quotes.get(settings.symbol);
    if (!settings.symbol)
      return {
        symbol: "",
        name: "TossInvest",
        currency: "",
        status: "auth-required",
        message: "종목 코드를 설정하세요.",
      };
    const capped = quote?.subscriptionCapped === true;
    const status = capped
      ? quote?.lastPrice ? "stale" : "no-data"
      : quote?.status ?? "connecting";
    return {
      symbol: settings.symbol,
      name: quote?.info?.name ?? settings.name,
      market: settings.market,
      currency: quote?.info?.currency ?? settings.currency,
      lastPrice: quote?.lastPrice,
      referencePrice: quote?.referencePrice,
      highPrice: quote?.highPrice,
      lowPrice: quote?.lowPrice,
      timestamp: quote?.timestamp,
      status,
      message: capped ? SUBSCRIPTION_LIMIT_MESSAGE : quote?.message,
      colorTheme: settings.colorTheme,
      showChart: settings.showChart,
      viewMode: settings.viewMode,
      showCurrencySymbol: settings.showCurrencySymbol,
      sparkline: quote?.sparkline,
      refreshing: quote?.refreshing,
      live: this.socket.currentState === "connected" && !quote?.subscriptionRejected && !capped,
      signal: capped ? undefined : quote?.activeSignal?.signal,
    };
  }

  private schedulePeriodicRefresh(): void {
    if (this.destroyed) return;
    const delay = this.socket.currentState === "connected" ? 60_000 : 10_000;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.refreshAll().finally(() => this.schedulePeriodicRefresh());
    }, delay);
  }

  private async openUrl(url: string): Promise<void> {
    if (this.openUrlImpl) await this.openUrlImpl(url);
  }

  private async showActionAlert(action: ActionPort): Promise<void> {
    if (!action.showAlert) return;
    try {
      await action.showAlert();
    } catch {
      // Preserve the original action error if alert delivery itself fails.
    }
  }
}

export function createRuntime(
  options: ConstructorParameters<typeof QuoteRuntime>[0] = {},
): QuoteRuntime {
  return new QuoteRuntime(options);
}
