import type { GlobalSettingsV1 } from "./types.js";
import { migrateGlobalSettings } from "./settings.js";

export interface GlobalSettingsInput {
  readonly clientId?: unknown;
  readonly clientSecret?: unknown;
  readonly renderMode?: unknown;
  readonly signalDurationSec?: unknown;
}

export interface GlobalSettingsRuntime {
  readonly settings: GlobalSettingsV1;
  updateGlobalSettings(settings: GlobalSettingsV1): Promise<void>;
  publicGlobalSettings(): GlobalSettingsV1;
}

function inputString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Creates an unsaved candidate. A blank secret deliberately retains the secret
 * already held by the runtime, so the PI never needs to receive it again.
 */
export function candidateGlobalSettings(
  existing: GlobalSettingsV1,
  input: GlobalSettingsInput,
): GlobalSettingsV1 {
  const rawClientId = inputString(input.clientId);
  const rawSecret = inputString(input.clientSecret);
  return migrateGlobalSettings({
    schemaVersion: 1,
    clientId: rawClientId || existing.clientId,
    clientSecret:
      rawSecret && rawSecret !== "••••••••" ? rawSecret : existing.clientSecret,
    renderMode: input.renderMode,
    signalDurationSec: input.signalDurationSec ?? existing.signalDurationSec,
  });
}

/**
 * Persists credentials only after the supplied official API validation passes.
 * Keeping this independent from Stream Deck makes the commit boundary testable.
 */
export async function saveValidatedGlobalSettings(
  runtime: GlobalSettingsRuntime,
  input: GlobalSettingsInput,
  options: {
    readonly validate: (candidate: GlobalSettingsV1) => Promise<void>;
    readonly persist: (settings: GlobalSettingsV1) => Promise<void>;
    readonly apply?: (settings: GlobalSettingsV1) => Promise<void>;
  },
): Promise<GlobalSettingsV1> {
  const candidate = candidateGlobalSettings(runtime.settings, input);
  await options.validate(candidate);
  await options.persist(candidate);
  await (options.apply?.(candidate) ?? runtime.updateGlobalSettings(candidate));
  return runtime.publicGlobalSettings();
}
