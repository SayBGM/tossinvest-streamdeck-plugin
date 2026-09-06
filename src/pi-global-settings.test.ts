import { describe, expect, it, vi } from "vitest";
import {
  candidateGlobalSettings,
  saveValidatedGlobalSettings,
  type GlobalSettingsRuntime,
} from "./pi-global-settings.js";
import type { GlobalSettingsV1 } from "./types.js";

const existing: GlobalSettingsV1 = {
  schemaVersion: 1,
  clientId: "old-client",
  clientSecret: "old-secret",
  renderMode: "realtime",
};

function fakeRuntime(): GlobalSettingsRuntime {
  let current = existing;
  return {
    get settings() {
      return current;
    },
    updateGlobalSettings: async (settings) => {
      current = settings;
    },
    publicGlobalSettings: () => ({
      ...current,
      clientSecret: current.clientSecret ? "••••••••" : "",
    }),
  };
}

describe("PI global credential commit", () => {
  it("reuses the saved secret when the PI leaves it blank", () => {
    expect(
      candidateGlobalSettings(existing, {
        clientId: "new-client",
        clientSecret: "",
        renderMode: "economy",
      }),
    ).toEqual({
      schemaVersion: 1,
      clientId: "new-client",
      clientSecret: "old-secret",
      renderMode: "economy",
    });
  });

  it("does not update runtime or persist when validation fails", async () => {
    const runtime = fakeRuntime();
    const persist = vi.fn(async () => undefined);
    await expect(
      saveValidatedGlobalSettings(
        runtime,
        { clientId: "new-client", clientSecret: "new-secret" },
        {
          validate: async () => {
            throw new Error("invalid credentials");
          },
          persist,
        },
      ),
    ).rejects.toThrow("invalid credentials");

    expect(runtime.settings).toEqual(existing);
    expect(persist).not.toHaveBeenCalled();
  });

  it("does not update runtime when persistence fails after validation", async () => {
    const runtime = fakeRuntime();
    await expect(
      saveValidatedGlobalSettings(
        runtime,
        { clientId: "new-client", clientSecret: "new-secret" },
        {
          validate: async () => undefined,
          persist: async () => {
            throw new Error("settings write failed");
          },
        },
      ),
    ).rejects.toThrow("settings write failed");

    expect(runtime.settings).toEqual(existing);
  });

  it("validates, persists, then updates runtime with the candidate", async () => {
    const runtime = fakeRuntime();
    const calls: string[] = [];
    const update = runtime.updateGlobalSettings;
    runtime.updateGlobalSettings = async (settings) => {
      calls.push(`update:${settings.clientId}`);
      await update(settings);
    };
    const result = await saveValidatedGlobalSettings(
      runtime,
      { clientId: "new-client", clientSecret: "new-secret" },
      {
        validate: async (candidate) => {
          calls.push(`validate:${candidate.clientId}`);
        },
        persist: async (settings) => {
          calls.push(`persist:${settings.clientId}`);
        },
      },
    );

    expect(calls).toEqual([
      "validate:new-client",
      "persist:new-client",
      "update:new-client",
    ]);
    expect(runtime.settings.clientSecret).toBe("new-secret");
    expect(result.clientSecret).toBe("••••••••");
  });
});
