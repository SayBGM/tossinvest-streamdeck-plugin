import { describe, expect, it, vi } from "vitest";
import {
  candidateGlobalSettings,
  saveDisplaySettings,
  saveValidatedGlobalSettings,
  type GlobalSettingsRuntime,
} from "./pi-global-settings.js";
import type { GlobalSettingsV1 } from "./types.js";

const existing: GlobalSettingsV1 = {
  schemaVersion: 1,
  clientId: "old-client",
  clientSecret: "old-secret",
  renderMode: "realtime",
  signalDurationSec: 5,
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
      signalDurationSec: 5,
    });
  });

  it("keeps the existing signalDurationSec when the input omits it, and saves a provided one", () => {
    expect(
      candidateGlobalSettings(existing, {
        clientId: "new-client",
        clientSecret: "",
        renderMode: "economy",
      }).signalDurationSec,
    ).toBe(5);

    expect(
      candidateGlobalSettings(existing, {
        clientId: "new-client",
        clientSecret: "",
        renderMode: "economy",
        signalDurationSec: 10,
      }).signalDurationSec,
    ).toBe(10);
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

describe("PI display preference commit", () => {
  it("preserves credentials and masks the response without authenticating", async () => {
    const runtime = fakeRuntime();
    const persist = vi.fn(async () => undefined);
    const input = { clientId: "ignored", clientSecret: "ignored", renderMode: "economy", signalDurationSec: 10 };
    const result = await saveDisplaySettings(runtime, input, persist);
    expect(persist).toHaveBeenCalledWith({ ...existing, renderMode: "economy", signalDurationSec: 10 });
    expect(runtime.settings.clientSecret).toBe(existing.clientSecret);
    expect(result.clientSecret).toBe("••••••••");
    expect(result.clientId).toBe(existing.clientId);
  });

  it("preserves omitted preferences and does not apply a failed write", async () => {
    const runtime = fakeRuntime();
    await saveDisplaySettings(runtime, { renderMode: "economy" }, async () => undefined);
    expect(runtime.settings.signalDurationSec).toBe(5);
    await expect(saveDisplaySettings(runtime, { signalDurationSec: 10 }, async () => {
      throw new Error("write failed");
    })).rejects.toThrow("write failed");
    expect(runtime.settings).toEqual({ ...existing, renderMode: "economy" });
  });
});
