import streamDeck, {
  SingletonAction,
  type DidReceiveSettingsEvent,
  type KeyDownEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";
import type { QuoteActionSettingsV1 } from "./types.js";
import { migrateActionSettings } from "./settings.js";
import { createRuntime, type ActionPort } from "./runtime.js";
import { safeErrorMessage, safeSerialize } from "./core/safe-log.js";

const ACTION_UUID = "com.saybgm.tossinvest.quote";

function actionPort(action: { readonly id: string; setImage(image: string): Promise<void>; showAlert(): Promise<void> }): ActionPort {
  return {
    id: action.id,
    setImage: (image) => action.setImage(image),
    showAlert: () => action.showAlert(),
  };
}

class QuoteAction extends SingletonAction<QuoteActionSettingsV1> {
  override readonly manifestId = ACTION_UUID;

  override async onWillAppear(ev: WillAppearEvent<QuoteActionSettingsV1>): Promise<void> {
    if (!ev.action.isKey()) return;
    await runtime.appear(actionPort(ev.action), ev.payload.settings);
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<QuoteActionSettingsV1>): Promise<void> {
    await runtime.settingsChanged(actionPort(ev.action), ev.payload.settings);
  }

  override onWillDisappear(ev: WillDisappearEvent<QuoteActionSettingsV1>): Promise<void> {
    runtime.disappear(ev.action.id);
    return Promise.resolve();
  }

  override async onKeyDown(ev: KeyDownEvent<QuoteActionSettingsV1>): Promise<void> {
    await runtime.keyDown(actionPort(ev.action));
  }
}

interface PiCommand {
  readonly type?: unknown;
  readonly requestId?: unknown;
  readonly settings?: unknown;
  readonly symbol?: unknown;
  readonly clientId?: unknown;
  readonly clientSecret?: unknown;
  readonly renderMode?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function sendPiResponse(requestId: string, payload: Record<string, unknown>): Promise<void> {
  if (streamDeck.ui.action?.id === undefined) return;
  await streamDeck.ui.sendToPropertyInspector({ requestId, ...payload } as unknown as JsonValue);
}

const runtime = createRuntime({
  piSender: async (_actionId, message) => {
    await streamDeck.ui.sendToPropertyInspector(message as JsonValue);
  },
  openUrl: async (url) => {
    await streamDeck.system.openUrl(url);
  },
});

streamDeck.logger.setLevel("info");

streamDeck.ui.onSendToPlugin((ev) => {
  void handlePiCommand(ev.payload, ev.action.id);
});

streamDeck.settings.onDidReceiveGlobalSettings((ev) => {
  void runtime.updateGlobalSettings(ev.settings);
});

async function handlePiCommand(raw: unknown, actionId: string): Promise<void> {
  const command = isRecord(raw) ? raw as PiCommand : {};
  const requestId = typeof command.requestId === "string" ? command.requestId : crypto.randomUUID();
  try {
    switch (command.type) {
      case "global/save": {
        const existing = runtime.settings;
        await runtime.updateGlobalSettings({
          schemaVersion: 1,
          clientId: typeof command.clientId === "string" ? command.clientId : existing.clientId,
          clientSecret: typeof command.clientSecret === "string" && command.clientSecret !== "••••••••"
            ? command.clientSecret
            : existing.clientSecret,
          renderMode: command.renderMode === "economy" ? "economy" : "realtime",
        });
        await streamDeck.settings.setGlobalSettings(runtime.settings);
        await sendPiResponse(requestId, { ok: true, settings: runtime.publicGlobalSettings() });
        break;
      }
      case "global/test":
        await runtime.testCredentials();
        await sendPiResponse(requestId, { ok: true, message: "인증에 성공했습니다." });
        break;
      case "symbol/resolve": {
        const settings = await runtime.resolveSymbol(command.symbol);
        await sendPiResponse(requestId, { ok: true, settings });
        break;
      }
      case "quote/refresh":
        await runtime.keyDown({ id: actionId, setImage: async () => undefined });
        await sendPiResponse(requestId, { ok: true });
        break;
      default:
        await sendPiResponse(requestId, { ok: false, message: "지원하지 않는 설정 요청입니다." });
    }
  } catch (error) {
    streamDeck.logger.warn(safeSerialize({ event: "pi_command_failed", error: safeErrorMessage(error) }));
    await sendPiResponse(requestId, { ok: false, message: error instanceof Error ? error.message : "요청을 처리하지 못했습니다." });
  }
}

streamDeck.actions.registerAction(new QuoteAction());

void streamDeck.connect()
  .then(async () => {
    const settings = await streamDeck.settings.getGlobalSettings<QuoteActionSettingsV1>();
    await runtime.updateGlobalSettings(settings);
  })
  .catch((error: unknown) => {
    streamDeck.logger.error(safeSerialize({ event: "startup_failed", error: safeErrorMessage(error) }));
  });

process.once("SIGTERM", () => { void runtime.destroy(); });
process.once("SIGINT", () => { void runtime.destroy(); });

export { runtime, QuoteAction, migrateActionSettings };
