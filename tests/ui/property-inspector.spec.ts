import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

interface SentMessage {
  readonly event?: string;
  readonly payload?: Record<string, unknown>;
  readonly [key: string]: unknown;
}

declare global {
  interface Window {
    __sdSent: SentMessage[];
    __sdSocket: { emit(message: unknown): void };
    connectElgatoStreamDeckSocket(
      port: number,
      uuid: string,
      registerEvent: string,
      info: string,
      actionInfo: string,
    ): void;
  }
}

const inspectorUrl = pathToFileURL(
  resolve("com.saybgm.tossinvest.sdPlugin/ui/quote.html"),
).href;

const sampleImage =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144"><rect width="144" height="144" rx="18" fill="#101013"/><text x="72" y="78" text-anchor="middle" fill="white" font-size="32">72,500</text></svg>',
  );

async function openInspector(
  page: Page,
  actionSettings: Record<string, unknown> = {},
): Promise<void> {
  await page.addInitScript(() => {
    class FakeWebSocket {
      readyState = 0;
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      onerror: (() => void) | null = null;

      constructor() {
        window.__sdSocket = this;
        setTimeout(() => {
          this.readyState = 1;
          this.onopen?.();
        }, 0);
      }

      send(raw: string): void {
        window.__sdSent.push(JSON.parse(raw) as SentMessage);
      }

      emit(message: unknown): void {
        this.onmessage?.({ data: JSON.stringify(message) });
      }

      close(): void {
        this.readyState = 3;
      }
    }

    window.__sdSent = [];
    Object.defineProperty(window, "WebSocket", {
      configurable: true,
      value: FakeWebSocket,
    });
  });

  await page.goto(inspectorUrl);
  await page.evaluate((settings) => {
    window.connectElgatoStreamDeckSocket(
      12345,
      "key-context",
      "registerPropertyInspector",
      "{}",
      JSON.stringify({
        action: "com.saybgm.tossinvest.quote",
        context: "key-context",
        payload: { settings },
      }),
    );
  }, actionSettings);
  await expect.poll(async () => (await pluginCommands(page)).length).toBeGreaterThan(0);
}

async function sentMessages(page: Page): Promise<SentMessage[]> {
  return page.evaluate(() => window.__sdSent);
}

async function pluginCommands(page: Page): Promise<Array<Record<string, unknown>>> {
  return (await sentMessages(page))
    .filter((message) => message.event === "sendToPlugin")
    .map((message) => message.payload ?? {});
}

async function latestCommand(
  page: Page,
  type: string,
  minimumCount = 1,
): Promise<Record<string, unknown>> {
  await expect
    .poll(async () => {
      const commands = await pluginCommands(page);
      return commands.filter((command) => command.type === type).length;
    })
    .toBeGreaterThanOrEqual(minimumCount);
  const commands = (await pluginCommands(page)).filter(
    (command) => command.type === type,
  );
  return commands[commands.length - 1] ?? {};
}

async function respond(page: Page, payload: Record<string, unknown>): Promise<void> {
  await page.evaluate((response) => {
    window.__sdSocket.emit({
      event: "sendToPropertyInspector",
      payload: response,
    });
  }, payload);
}

async function initialize(
  page: Page,
  configured: boolean,
): Promise<void> {
  const init = await latestCommand(page, "init");
  await respond(page, {
    requestId: init.requestId,
    type: "init",
    isConfigured: configured,
    globalSettings: configured
      ? {
          schemaVersion: 1,
          clientId: "client-12345678",
          clientSecret: "••••••••",
          renderMode: "realtime",
          signalDurationSec: 5,
        }
      : {
          schemaVersion: 1,
          clientId: "",
          clientSecret: "",
          renderMode: "realtime",
          signalDurationSec: 5,
        },
  });
}

test("초기 설정은 읽기 쉬운 단일 인증 Flow를 제공한다", async ({ page }) => {
  await openInspector(page);
  await initialize(page, false);

  await expect(page.getByRole("button", { name: "저장 및 연결 확인" })).toBeVisible();
  await expect(page.getByRole("button", { name: "연결 테스트" })).toHaveCount(0);
  await expect(page.locator("#setupGuide")).toBeVisible();
  await expect(page.locator("#actionSection")).toBeHidden();

  const sizes = await page.locator("body *").evaluateAll((elements) =>
    elements
      .filter((element) => getComputedStyle(element).display !== "none")
      .map((element) => Number.parseFloat(getComputedStyle(element).fontSize))
      .filter(Number.isFinite),
  );
  expect(sizes.every((size) => Number.isInteger(size) && size >= 12)).toBe(true);

  await expect(page).toHaveScreenshot("property-inspector-initial.png", {
    fullPage: true,
  });
});

test("인증 실패는 설정 단계를 열지 않고 해당 영역에만 표시한다", async ({ page }) => {
  await openInspector(page);
  await initialize(page, false);

  await page.getByLabel("Client ID").fill("candidate-client");
  await page.getByLabel("Client Secret").fill("candidate-secret");
  await page.getByRole("button", { name: "저장 및 연결 확인" }).click();
  const save = await latestCommand(page, "global/save");

  await expect(page.getByRole("button", { name: "저장 및 연결 확인" })).toBeDisabled();
  await respond(page, {
    requestId: save.requestId,
    ok: false,
    message: "API 인증정보를 확인해 주세요.",
  });

  await expect(page.locator("#globalStatus")).toContainText("API 인증정보");
  await expect(page.locator("#actionStatus")).toHaveText("");
  await expect(page.locator("#actionSection")).toBeHidden();
  await expect(page.getByRole("button", { name: "저장 및 연결 확인" })).toBeEnabled();
});

test("잘못된 종목은 기존 확정 설정을 보존하고 성공한 최신 종목만 저장한다", async ({ page }) => {
  const samsung = {
    schemaVersion: 1,
    symbol: "005930",
    name: "삼성전자",
    market: "KR",
    currency: "KRW",
    keyBehavior: "refresh",
    colorTheme: "kr",
    showChart: true,
    viewMode: "chart",
    showCurrencySymbol: true,
  };
  await openInspector(page, samsung);
  await initialize(page, true);

  await expect(page.locator("#resolved")).toContainText("삼성전자");
  const settingsBefore = (await sentMessages(page)).filter(
    (message) => message.event === "setSettings",
  ).length;

  await page.getByLabel("종목 코드 / 티커").fill("INVALID");
  await page.getByRole("button", { name: "확인" }).click();
  const invalid = await latestCommand(page, "symbol/resolve");
  await expect(page.getByRole("button", { name: "확인" })).toBeDisabled();
  await respond(page, {
    requestId: invalid.requestId,
    ok: false,
    message: "종목을 찾을 수 없습니다.",
  });

  await expect(page.locator("#resolved")).toContainText("삼성전자");
  await expect(page.locator("#actionStatus")).toContainText("종목을 찾을 수 없습니다");
  expect(
    (await sentMessages(page)).filter((message) => message.event === "setSettings"),
  ).toHaveLength(settingsBefore);

  await page.getByLabel("종목 코드 / 티커").fill("AAPL");
  await page.getByRole("button", { name: "확인" }).click();
  const appleRequest = await latestCommand(page, "symbol/resolve", 2);
  await respond(page, {
    requestId: appleRequest.requestId,
    ok: true,
    settings: {
      ...samsung,
      symbol: "AAPL",
      name: "Apple",
      market: "US",
      currency: "USD",
    },
  });

  await expect(page.locator("#resolved")).toContainText("Apple");
  const stored = (await sentMessages(page)).filter(
    (message) => message.event === "setSettings",
  );
  expect(stored).toHaveLength(settingsBefore + 1);
  expect(stored[stored.length - 1]?.payload).toMatchObject({ symbol: "AAPL" });

  const preview = await latestCommand(page, "quote/preview", 2);
  await respond(page, {
    requestId: preview.requestId,
    ok: true,
    image: sampleImage,
  });
  await expect(page.locator("#previewPlaceholder")).toBeHidden();
  await expect(page.locator("#keyPreview")).toBeVisible();

  const largePreview = page.getByRole("button", { name: "144px" });
  await largePreview.click();
  await expect(largePreview).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#keyPreview")).toHaveCSS("width", "144px");
  await expect(page).toHaveScreenshot("property-inspector-configured.png", {
    fullPage: true,
  });
});

test("시그널 표시 시간을 바꾸면 저장 커맨드에 반영된다", async ({ page }) => {
  await openInspector(page);
  await initialize(page, true);

  // Saved credentials collapse the global card, so expand it before editing.
  await page.locator("#toggleGlobalBtn").click();
  await expect(page.locator("#signalDuration")).toBeVisible();
  await expect(page.locator("#signalDuration")).toHaveValue("5");

  await page.locator("#signalDuration").selectOption("10");
  await page.getByRole("button", { name: "저장 및 연결 확인" }).click();

  const save = await latestCommand(page, "global/save");
  expect(save).toMatchObject({ signalDurationSec: 10 });
});

test("화면 모드 탭은 선택 상태와 자동 저장을 동기화한다", async ({ page }) => {
  await openInspector(page, {
    schemaVersion: 1,
    symbol: "AAPL",
    name: "Apple",
    market: "US",
    currency: "USD",
    keyBehavior: "refresh",
    viewMode: "chart",
  });
  await initialize(page, true);

  await respond(page, {
    type: "settings-updated",
    actionId: "another-key",
    settings: {
      schemaVersion: 1,
      symbol: "TSLA",
      name: "Tesla",
      market: "US",
      currency: "USD",
      keyBehavior: "refresh",
      viewMode: "detail",
    },
  });
  await expect(page.getByLabel("종목 코드 / 티커")).toHaveValue("AAPL");

  const detail = page.getByRole("tab", { name: "시세 모드" });
  await detail.focus();
  await detail.press("Enter");
  await expect(detail).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: "차트 모드" })).toHaveAttribute(
    "aria-selected",
    "false",
  );

  await expect
    .poll(async () => {
      const messages = await sentMessages(page);
      return messages.some(
        (message) =>
          message.event === "setSettings" && message.payload?.viewMode === "detail",
      );
    })
    .toBe(true);
});
