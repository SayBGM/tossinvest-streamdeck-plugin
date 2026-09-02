import streamDeck, {
  SingletonAction,
  type DidReceiveSettingsEvent,
  type KeyDownEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";
import type { GlobalSettingsV1, QuoteActionSettingsV1 } from "./types.js";
import { credentialsConfigured, migrateActionSettings } from "./settings.js";
import { createRuntime, type ActionPort } from "./runtime.js";
import { safeErrorMessage, safeSerialize } from "./core/safe-log.js";
import { safeMessageForError } from "./toss/errors.js";

const ACTION_UUID = "com.saybgm.tossinvest.quote";

function actionPort(action: {
  readonly id: string;
  setImage(image: string): Promise<void>;
  showAlert(): Promise<void>;
}): ActionPort {
  return {
    id: action.id,
    setImage: (image) => action.setImage(image),
    showAlert: () => action.showAlert(),
  };
}

class QuoteAction extends SingletonAction<QuoteActionSettingsV1> {
  override readonly manifestId = ACTION_UUID;

  override async onWillAppear(
    ev: WillAppearEvent<QuoteActionSettingsV1>,
  ): Promise<void> {
    if (!ev.action.isKey()) return;
    await runtime.appear(actionPort(ev.action), ev.payload.settings);
  }

  override async onDidReceiveSettings(
    ev: DidReceiveSettingsEvent<QuoteActionSettingsV1>,
  ): Promise<void> {
    await runtime.settingsChanged(actionPort(ev.action), ev.payload.settings);
  }

  override onWillDisappear(
    ev: WillDisappearEvent<QuoteActionSettingsV1>,
  ): Promise<void> {
    runtime.disappear(ev.action.id);
    return Promise.resolve();
  }

  override async onKeyDown(
    ev: KeyDownEvent<QuoteActionSettingsV1>,
  ): Promise<void> {
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

async function sendPiResponse(
  requestId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await streamDeck.ui.sendToPropertyInspector({
    requestId,
    ...payload,
  } as unknown as JsonValue);
}

const runtime = createRuntime({
  piSender: async (_actionId, message) => {
    await streamDeck.ui.sendToPropertyInspector(message as JsonValue);
  },
  openUrl: async (url) => {
    await streamDeck.system.openUrl(url);
  },
});

streamDeck.logger.setLevel("debug");

streamDeck.ui.onDidAppear(async (ev) => {
  streamDeck.logger.debug(
    safeSerialize({ event: "pi_did_appear", action: ev.action.id }),
  );
  await streamDeck.ui.sendToPropertyInspector({
    type: "init",
    globalSettings: runtime.publicGlobalSettings(),
    isConfigured: credentialsConfigured(runtime.settings),
  } as unknown as JsonValue);
});

streamDeck.ui.onSendToPlugin((ev) => {
  streamDeck.logger.debug(
    safeSerialize({
      event: "pi_send_to_plugin",
      action: ev.action.id,
      payload: ev.payload,
    }),
  );
  void handlePiCommand(ev.payload, ev.action.id);
});

streamDeck.settings.onDidReceiveGlobalSettings((ev) => {
  void runtime.updateGlobalSettings(ev.settings);
});

async function handlePiCommand(raw: unknown, actionId: string): Promise<void> {
  const command = isRecord(raw) ? (raw as PiCommand) : {};
  const requestId =
    typeof command.requestId === "string"
      ? command.requestId
      : crypto.randomUUID();
  try {
    switch (command.type) {
      case "init": {
        if (!credentialsConfigured(runtime.settings)) {
          try {
            const fresh = await Promise.race([
              streamDeck.settings.getGlobalSettings<GlobalSettingsV1>(),
              new Promise<GlobalSettingsV1>((_, reject) =>
                setTimeout(() => reject(new Error("Timeout")), 600),
              ),
            ]);
            if (
              fresh &&
              typeof fresh === "object" &&
              credentialsConfigured(fresh)
            ) {
              await runtime.updateGlobalSettings(fresh);
            }
          } catch {
            /* ignore fallback error */
          }
        }
        await sendPiResponse(requestId, {
          type: "init",
          globalSettings: runtime.publicGlobalSettings(),
          isConfigured: credentialsConfigured(runtime.settings),
        });
        break;
      }
      case "global/save": {
        const existing = runtime.settings;
        const rawClientId =
          typeof command.clientId === "string" ? command.clientId.trim() : "";
        const rawSecret =
          typeof command.clientSecret === "string"
            ? command.clientSecret.trim()
            : "";

        const clientId = rawClientId || existing.clientId;
        const clientSecret =
          rawSecret && rawSecret !== "••••••••"
            ? rawSecret
            : existing.clientSecret;

        await runtime.updateGlobalSettings({
          schemaVersion: 1,
          clientId,
          clientSecret,
          renderMode: command.renderMode === "economy" ? "economy" : "realtime",
        });
        await streamDeck.settings.setGlobalSettings(runtime.settings);
        const configured = credentialsConfigured(runtime.settings);
        await sendPiResponse(requestId, {
          ok: true,
          isConfigured: configured,
          settings: runtime.publicGlobalSettings(),
          message: configured
            ? "전역 설정을 저장했습니다."
            : "Client ID와 Client Secret을 입력하세요.",
        });
        break;
      }
      case "global/test":
        await runtime.testCredentials();
        await sendPiResponse(requestId, {
          ok: true,
          isConfigured: credentialsConfigured(runtime.settings),
          message: "토스증권 API 인증에 성공했습니다.",
        });
        break;
      case "symbol/resolve": {
        const settings = await runtime.resolveSymbol(command.symbol);
        await sendPiResponse(requestId, { ok: true, settings });
        break;
      }
      case "quote/refresh":
        await runtime.keyDown({
          id: actionId,
          setImage: async () => undefined,
        });
        await sendPiResponse(requestId, { ok: true });
        break;
      case "quote/preview": {
        const image = runtime.preview(command.settings);
        await sendPiResponse(requestId, { ok: true, image });
        break;
      }
      default:
        await sendPiResponse(requestId, {
          ok: false,
          message: "지원하지 않는 설정 요청입니다.",
        });
    }
  } catch (error) {
    streamDeck.logger.warn(
      safeSerialize({
        event: "pi_command_failed",
        error: safeErrorMessage(error),
      }),
    );
    const message = safeMessageForError(error);
    await sendPiResponse(requestId, { ok: false, message });
  }
}

streamDeck.actions.registerAction(new QuoteAction());

void streamDeck
  .connect()
  .then(async () => {
    streamDeck.logger.info("TossInvest plugin connected to Stream Deck host");
    try {
      const settings = await Promise.race([
        streamDeck.settings.getGlobalSettings<GlobalSettingsV1>(),
        new Promise<GlobalSettingsV1>((_, reject) =>
          setTimeout(() => reject(new Error("Timeout")), 2000),
        ),
      ]);
      if (settings && typeof settings === "object") {
        await runtime.updateGlobalSettings(settings);
        streamDeck.logger.info(
          safeSerialize({
            event: "global_settings_loaded",
            hasClientId: Boolean(runtime.settings.clientId),
            hasSecret: Boolean(runtime.settings.clientSecret),
          }),
        );
      }
    } catch (error) {
      streamDeck.logger.warn(
        safeSerialize({
          event: "startup_global_settings_failed",
          error: safeErrorMessage(error),
        }),
      );
    }
  })
  .catch((error: unknown) => {
    streamDeck.logger.error(
      safeSerialize({
        event: "startup_failed",
        error: safeErrorMessage(error),
      }),
    );
  });

process.once("SIGTERM", () => {
  void runtime.destroy();
});
process.once("SIGINT", () => {
  void runtime.destroy();
});

export { runtime, QuoteAction, migrateActionSettings };
