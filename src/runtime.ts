import type { Action } from "@elgato/streamdeck";
import type {
  Candle,
  GlobalSettingsV1,
  Market,
  QuoteActionSettingsV1,
  QuoteView,
  StockInfo,
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
import { TossRestClient, selectReferencePrice } from "./toss/rest-client.js";
import { TossWebSocket } from "./toss/websocket.js";
import { safeErrorMessage, safeSerialize } from "./core/safe-log.js";

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

interface QuoteState {
  readonly symbol: string;
  info?: StockInfo;
  lastPrice?: string;
  referencePrice?: string;
  highPrice?: string;
  lowPrice?: string;
  candles?: Candle[];
  sparkline?: number[];
  timestamp?: string | null;
  status: QuoteView["status"];
  message?: string;
  refreshing?: boolean;
}

export interface PiSender {
  (actionId: string, message: unknown): Promise<void>;
}

const ACTION_UUID = "com.saybgm.tossinvest.quote";

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
        if (quote && !quote.lastPrice) {
          quote.status = "invalid-symbol";
          quote.message =
            reason === "stock-not-found"
              ? "종목을 찾을 수 없습니다."
              : "구독할 수 없는 종목입니다.";
          void this.renderAll();
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

  async updateGlobalSettings(raw: unknown): Promise<void> {
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
      this.socket.restart();
      for (const quote of this.quotes.values()) {
        quote.status = "connecting";
        quote.message = undefined;
      }
      await this.refreshAll();
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
    this.ensureQuote(settings.symbol);
    await this.renderAction(action.id);
    await this.refreshAll();
  }

  disappear(actionId: string): void {
    const binding = this.bindings.get(actionId);
    if (!binding) return;
    this.scheduler.remove(actionId, binding.generation);
    this.bindings.delete(actionId);
    this.reconcileSubscriptions();
  }

  async keyDown(action: ActionPort): Promise<void> {
    const binding = this.bindings.get(action.id);
    if (!binding) return;
    if (
      binding.settings.keyBehavior === "open" &&
      binding.settings.symbol &&
      binding.settings.market
    ) {
      const url =
        binding.settings.market === "KR"
          ? `https://www.tossinvest.com/stocks/A${binding.settings.symbol}/order`
          : `https://www.tossinvest.com/stocks/${binding.settings.symbol}/order`;
      await this.openUrl(url);
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
        await this.refreshSymbol(binding.settings.symbol, true);
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
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.socket.stop();
    this.scheduler.destroy();
    this.bindings.clear();
  }

  private sanitizedGlobalSettings(): GlobalSettingsV1 {
    return {
      schemaVersion: 1,
      clientId: this.globalSettings.clientId,
      clientSecret: this.globalSettings.clientSecret ? "••••••••" : "",
      renderMode: this.globalSettings.renderMode,
    };
  }

  private ensureQuote(symbol: string): QuoteState | undefined {
    if (!symbol) return undefined;
    const existing = this.quotes.get(symbol);
    if (existing) return existing;
    const quote: QuoteState = { symbol, status: "connecting" };
    this.quotes.set(symbol, quote);
    return quote;
  }

  private async refreshAll(): Promise<void> {
    if (this.destroyed) return;
    const symbols = [
      ...new Set(
        [...this.bindings.values()]
          .map((binding) => binding.settings.symbol)
          .filter(Boolean),
      ),
    ];
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
      const [infos, prices] = await Promise.all([
        this.rest.getStocks(symbols),
        this.rest.getPrices(symbols),
      ]);
      const infosBySymbol = new Map(
        infos.map((info) => [info.symbol.toUpperCase(), info]),
      );
      const pricesBySymbol = new Map(
        prices.map((price) => [price.symbol.toUpperCase(), price]),
      );
      for (const symbol of symbols) {
        const quote = this.ensureQuote(symbol);
        if (!quote) continue;
        const info = infosBySymbol.get(symbol.toUpperCase());
        const price = pricesBySymbol.get(symbol.toUpperCase());
        if (!info || !price) {
          quote.status = "invalid-symbol";
          quote.message = "종목을 찾을 수 없습니다.";
          continue;
        }
        quote.info = info;
        quote.lastPrice = price.lastPrice;
        quote.timestamp = price.timestamp;
        quote.status = "ready";
        try {
          const candles = await this.rest.getCandles(symbol, 10);
          quote.candles = candles;
          const market: Market =
            info.market === "US" || info.currency === "USD" ? "US" : "KR";
          quote.referencePrice = selectReferencePrice(
            candles,
            price.timestamp,
            market,
          );

          const chronological = [...candles].sort((a, b) =>
            a.timestamp.localeCompare(b.timestamp),
          );
          const sparkline = chronological
            .map((c) => Number(c.closePrice))
            .filter((val) => Number.isFinite(val));
          if (price.lastPrice && Number.isFinite(Number(price.lastPrice))) {
            if (sparkline.length > 0) {
              sparkline[sparkline.length - 1] = Number(price.lastPrice);
            } else {
              sparkline.push(Number(price.lastPrice));
            }
          }
          quote.sparkline = sparkline;

          const latestCandle = chronological[chronological.length - 1];
          if (latestCandle) {
            quote.highPrice = latestCandle.highPrice;
            quote.lowPrice = latestCandle.lowPrice;
          }
        } catch {
          quote.referencePrice = undefined;
          quote.sparkline = undefined;
        }
      }
      this.reconcileSubscriptions();
      await this.renderAll();
    } catch (error) {
      const message = safeMessageForError(error);
      for (const symbol of symbols) {
        const quote = this.ensureQuote(symbol);
        if (quote && !quote.lastPrice) {
          quote.status =
            error instanceof TossError && error.code === "INVALID_SYMBOL"
              ? "invalid-symbol"
              : "stale";
          quote.message = message;
        }
      }
      await this.renderAll();
    }
  }

  private async refreshSymbol(
    symbol: string,
    immediate = false,
  ): Promise<void> {
    if (!symbol) return this.renderAll();
    await this.refreshAll();
    if (immediate) {
      for (const binding of this.bindings.values()) {
        if (binding.settings.symbol === symbol)
          await this.renderAction(binding.action.id, true);
      }
    }
  }

  private reconcileSubscriptions(): void {
    const entries: Array<readonly [string, "KR" | "US"]> = [];
    const seen = new Set<string>();
    for (const binding of this.bindings.values()) {
      const symbol = binding.settings.symbol;
      const info = this.quotes.get(symbol)?.info;
      let market = binding.settings.market;
      if (!market && info) {
        try {
          market = this.rest.marketFor(info);
        } catch {
          market = undefined;
        }
      }
      if (!symbol || !market || seen.has(symbol)) continue;
      seen.add(symbol);
      entries.push([symbol, market]);
    }
    this.socket.setSymbols(entries);
  }

  private handleTick(tick: TradeTick): void {
    const quote = this.quotes.get(tick.symbol.toUpperCase());
    if (!quote) return;
    quote.lastPrice = tick.price;
    quote.timestamp = tick.timestamp;
    quote.status = "ready";
    quote.message = undefined;
    if (quote.sparkline && quote.sparkline.length > 0) {
      const priceNum = Number(tick.price);
      if (Number.isFinite(priceNum)) {
        const updated = [...quote.sparkline];
        updated[updated.length - 1] = priceNum;
        quote.sparkline = updated;
      }
    }
    void this.renderAll();
  }

  private async renderAll(): Promise<void> {
    for (const binding of this.bindings.values())
      await this.renderAction(binding.action.id);
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
      commit: (image) => {
        void binding.action.setImage(image);
        void this.sendPush({
          type: "preview",
          actionId,
          image,
        });
      },
    });
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
      status: quote?.status ?? "connecting",
      message: quote?.message,
      colorTheme: settings.colorTheme,
      showChart: settings.showChart,
      viewMode: settings.viewMode,
      showCurrencySymbol: settings.showCurrencySymbol,
      sparkline: quote?.sparkline,
      refreshing: quote?.refreshing,
    };
  }

  private schedulePeriodicRefresh(): void {
    if (this.destroyed) return;
    const delay = this.socket.currentState === "connected" ? 60_000 : 5_000;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.refreshAll().finally(() => this.schedulePeriodicRefresh());
    }, delay);
  }

  private async openUrl(url: string): Promise<void> {
    if (this.openUrlImpl) await this.openUrlImpl(url);
  }
}

export function createRuntime(
  options: ConstructorParameters<typeof QuoteRuntime>[0] = {},
): QuoteRuntime {
  return new QuoteRuntime(options);
}
