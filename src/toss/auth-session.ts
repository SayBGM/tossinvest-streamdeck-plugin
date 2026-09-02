import type { GlobalSettingsV1 } from "../types.js";
import { credentialsConfigured } from "../settings.js";
import { TossError } from "./errors.js";

interface TokenResponse {
  access_token?: unknown;
  expires_in?: unknown;
}

export interface AuthSessionOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly baseUrl?: string;
  readonly now?: () => number;
}

export class AuthSession {
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly baseUrl: string;
  private readonly now: () => number;
  private settings: GlobalSettingsV1;
  private accessToken?: string;
  private expiresAt = 0;
  private issuance?: Promise<string>;
  private generation = 0;

  constructor(settings: GlobalSettingsV1, options: AuthSessionOptions = {}) {
    this.settings = settings;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.baseUrl = options.baseUrl ?? "https://openapi.tossinvest.com";
    this.now = options.now ?? Date.now;
  }

  updateSettings(settings: GlobalSettingsV1): boolean {
    const changed = settings.clientId !== this.settings.clientId ||
      settings.clientSecret !== this.settings.clientSecret;
    this.settings = settings;
    if (changed) this.invalidate();
    return changed;
  }

  isConfigured(): boolean {
    return credentialsConfigured(this.settings);
  }

  invalidate(): void {
    this.generation += 1;
    this.accessToken = undefined;
    this.expiresAt = 0;
    this.issuance = undefined;
  }

  async test(): Promise<void> {
    this.invalidate();
    await this.getToken();
  }

  async getToken(): Promise<string> {
    if (!this.isConfigured()) {
      throw new TossError("AUTH_REQUIRED", "Credentials are not configured", false);
    }
    if (this.accessToken && this.expiresAt - this.now() > 5 * 60_000) {
      return this.accessToken;
    }
    if (this.issuance) return this.issuance;
    const generation = this.generation;
    const operation = this.issue(generation).finally(() => {
      if (this.issuance === operation) this.issuance = undefined;
    });
    this.issuance = operation;
    return operation;
  }

  private async issue(generation: number): Promise<string> {
    let response: Response;
    try {
      const body = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.settings.clientId,
        client_secret: this.settings.clientSecret,
      });
      response = await this.fetchImpl(`${this.baseUrl}/oauth2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new TossError("NETWORK", error instanceof Error ? error.message : "Network error", true);
    }

    if (response.status === 401) {
      throw new TossError("INVALID_CREDENTIALS", "Client authentication failed", false);
    }
    if (response.status === 403) {
      throw new TossError("IP_NOT_ALLOWED", "IP address is not allowed", false);
    }
    if (response.status === 429) {
      throw new TossError("RATE_LIMITED", "Authentication rate limit exceeded", true);
    }
    if (!response.ok) {
      throw new TossError("API", `Token request failed (${response.status})`, response.status >= 500);
    }

    const payload = await response.json() as TokenResponse;
    if (typeof payload.access_token !== "string" || payload.access_token.length === 0) {
      throw new TossError("API", "Token response is invalid", true);
    }
    const expiresIn = typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in)
      ? payload.expires_in
      : 86_400;
    if (generation !== this.generation) {
      throw new TossError("AUTH_REQUIRED", "Credentials changed during authentication", true);
    }
    this.accessToken = payload.access_token;
    this.expiresAt = this.now() + Math.max(60, expiresIn) * 1_000;
    return payload.access_token;
  }
}
