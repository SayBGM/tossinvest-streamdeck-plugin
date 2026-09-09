import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import vm from "node:vm";
import AdmZip from "adm-zip";
import { WebSocketServer } from "ws";

const dist = resolve("dist");
const configuredPackagePath = process.env.TOSSINVEST_PI_PACKAGE;
const packageName = configuredPackagePath
  ? basename(configuredPackagePath)
  : readdirSync(dist).find((name) => name.endsWith(".streamDeckPlugin"));
if (!packageName || !packageName.endsWith(".streamDeckPlugin")) throw new Error(".streamDeckPlugin 아카이브가 없습니다.");

const packagePath = configuredPackagePath ? resolve(configuredPackagePath) : resolve(dist, packageName);
const archive = new AdmZip(packagePath);
const fakeDeviceInfo = { id: "device-1", type: 1, size: { columns: 3, rows: 2 }, name: "Fake Stream Deck Mini" };
const manifestEntry = archive.getEntries().find((entry) => /(^|\/)manifest\.json$/.test(entry.entryName));
if (!manifestEntry) throw new Error("패키지에 manifest.json이 없습니다.");
const manifest = JSON.parse(manifestEntry.getData().toString("utf8"));
if (typeof manifest.CodePath !== "string" || !manifest.CodePath) throw new Error("manifest.json에 CodePath가 없습니다.");

const waitFor = async (predicate, message, timeoutMs = 5_000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
  throw new Error(message);
};

const hostMessages = [];
let extractionDir;
let server;
let pluginSocket;
let child;
let childExited = true;
let childClosed = Promise.resolve({ code: null, signal: null });
let registrationTimer;

const waitWithTimeout = async (promise, timeoutMs, fallback = undefined) => {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolvePromise) => { timer = setTimeout(() => resolvePromise(fallback), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const close = async () => {
  if (child && !childExited) {
    try { child.kill("SIGTERM"); } catch { /* 종료 경합 */ }
    await waitWithTimeout(childClosed, 1_000);
    if (!childExited) {
      try { child.kill("SIGKILL"); } catch { /* 종료 경합 */ }
      await waitWithTimeout(childClosed, 1_000);
    }
  }
  pluginSocket?.terminate();
  if (server) {
    for (const socket of server.clients) socket.terminate();
    await waitWithTimeout(new Promise((resolvePromise) => {
      try { server.close(() => resolvePromise()); } catch { resolvePromise(); }
    }), 1_000);
  }
  if (extractionDir) await waitWithTimeout(rm(extractionDir, { recursive: true, force: true }), 1_000);
};

const sendHostEvent = (event, context, payload = undefined) => {
  if (!pluginSocket) throw new Error("플러그인 호스트 소켓이 준비되지 않았습니다.");
  pluginSocket.send(JSON.stringify({
    event,
    action: "com.saybgm.tossinvest.quote",
    context,
    device: "device-1",
    ...(payload === undefined ? {} : { payload }),
  }));
};

const runPiTransport = async (pluginDir, actionContext) => {
  const source = await readFile(resolve(pluginDir, "ui/sdpi.js"), "utf8");
  const sent = [];
  const document = {
    addEventListener() {},
    dispatchEvent() { return true; },
  };
  class FakeWebSocket {
    readyState = 0;
    onopen = null;
    onmessage = null;
    onerror = null;
    constructor() {
      queueMicrotask(() => {
        this.readyState = 1;
        this.onopen?.();
      });
    }
    send(raw) { sent.push(JSON.parse(raw)); }
  }
  const context = vm.createContext({
    WebSocket: FakeWebSocket,
    CustomEvent: class CustomEvent {},
    document,
  });
  vm.runInContext(source, context, { filename: "sdpi.js" });
  context.connectElgatoStreamDeckSocket(
    12345,
    "com.saybgm.tossinvest",
    "registerPropertyInspector",
    "{}",
    JSON.stringify({
      action: "com.saybgm.tossinvest.quote",
      context: actionContext,
      payload: { settings: {} },
    }),
  );
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
  context.sendToPlugin({ type: "quote/preview", requestId: `host-${actionContext}` });
  const command = sent.find((message) => message.event === "sendToPlugin");
  if (!command || command.context !== actionContext) {
    throw new Error(`PI sendToPlugin context가 ${actionContext}와 일치하지 않습니다.`);
  }
  return command;
};

try {
  extractionDir = await mkdtemp(resolve(tmpdir(), "tossinvest-pi-host-"));
  archive.extractAllTo(extractionDir, true);
  const pluginDir = resolve(extractionDir, manifestEntry.entryName.split("/")[0]);
  server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise((resolvePromise, reject) => {
    server.once("listening", resolvePromise);
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("가짜 Stream Deck 호스트 포트를 얻지 못했습니다.");

  let registrationSettled = false;
  let rejectRegistration;
  const registered = new Promise((resolvePromise, reject) => {
    rejectRegistration = (error) => {
      if (registrationSettled) return;
      registrationSettled = true;
      reject(error);
    };
    registrationTimer = setTimeout(() => rejectRegistration(new Error("플러그인 등록 timeout")), 5_000);
    server.on("connection", (socket) => {
      pluginSocket = socket;
      socket.on("message", (raw) => {
        let message;
        try { message = JSON.parse(raw.toString()); } catch { return; }
        hostMessages.push(message);
        if (message.event === "registerPlugin" && message.uuid === "com.saybgm.tossinvest") {
          clearTimeout(registrationTimer);
          registrationSettled = true;
          resolvePromise();
        }
        if (message.event === "getGlobalSettings") {
          socket.send(JSON.stringify({ event: "didReceiveGlobalSettings", payload: { settings: {} } }));
        }
      });
    });
  });
  server.once("close", () => rejectRegistration?.(new Error("가짜 Stream Deck 서버가 등록 전에 닫혔습니다.")));

  child = spawn(process.execPath, [resolve(pluginDir, manifest.CodePath), "-port", String(address.port), "-pluginUUID", "com.saybgm.tossinvest", "-registerEvent", "registerPlugin", "-info", JSON.stringify({ application: { version: "7.4.2", language: "ko" }, devices: [fakeDeviceInfo] })], {
    cwd: pluginDir,
    stdio: ["ignore", "ignore", "ignore"],
  });
  childExited = false;
  childClosed = new Promise((resolvePromise) => {
    child.once("error", () => {
      childExited = true;
      rejectRegistration?.(new Error("플러그인 프로세스 오류"));
      resolvePromise({ code: null, signal: "error" });
    });
    child.once("close", (code, signal) => {
      childExited = true;
      if (!registrationSettled) rejectRegistration?.(new Error(`플러그인이 등록 전에 종료되었습니다 (${code ?? "unknown"}/${signal ?? "none"})`));
      resolvePromise({ code, signal });
    });
  });
  await registered;

  const keyA = "key-context-a";
  const keyB = "key-context-b";
  const actionPayload = { controller: "Keypad", coordinates: { column: 0, row: 0 }, isInMultiAction: false, settings: {} };
  sendHostEvent("willAppear", keyA, actionPayload);
  await waitFor(() => hostMessages.some((message) => message.event === "setImage" && message.context === keyA), "첫 번째 액션이 SDK actionStore에 등록되지 않았습니다.");
  sendHostEvent("propertyInspectorDidAppear", keyA);
  await waitFor(() => hostMessages.some((message) => message.event === "sendToPropertyInspector" && message.context === keyA && message.payload?.type === "init"), "첫 번째 PI init 응답이 없습니다.");

  const commandA = await runPiTransport(pluginDir, keyA);
  pluginSocket.send(JSON.stringify(commandA));
  await waitFor(() => hostMessages.some((message) => message.event === "sendToPropertyInspector" && message.context === keyA && message.payload?.requestId === "host-key-context-a"), "첫 번째 PI sendToPlugin 왕복이 없습니다.");

  sendHostEvent("willAppear", keyB, { ...actionPayload, coordinates: { column: 1, row: 0 } });
  await waitFor(() => hostMessages.some((message) => message.event === "setImage" && message.context === keyB), "두 번째 액션이 SDK actionStore에 등록되지 않았습니다.");
  sendHostEvent("propertyInspectorDidDisappear", keyA);
  sendHostEvent("propertyInspectorDidAppear", keyB);
  await waitFor(() => hostMessages.some((message) => message.event === "sendToPropertyInspector" && message.context === keyB && message.payload?.type === "init"), "새 PI 선택 후 init 응답이 없습니다.");

  const commandB = await runPiTransport(pluginDir, keyB);
  pluginSocket.send(JSON.stringify(commandB));
  await waitFor(() => hostMessages.some((message) => message.event === "sendToPropertyInspector" && message.context === keyB && message.payload?.requestId === "host-key-context-b"), "새 PI 선택 후 sendToPlugin 왕복이 없습니다.");

  console.log(`SDK actionStore/PI context round-trip verified: ${packageName}`);
} finally {
  if (registrationTimer) clearTimeout(registrationTimer);
  await close();
}
