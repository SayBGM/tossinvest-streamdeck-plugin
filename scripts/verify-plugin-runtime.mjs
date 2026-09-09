import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import AdmZip from "adm-zip";
import { WebSocketServer } from "ws";

const dist = resolve("dist");
const packageName = readdirSync(dist).find((name) => name.endsWith(".streamDeckPlugin"));
if (!packageName) throw new Error("dist에 .streamDeckPlugin 파일이 없습니다.");
const packagePath = resolve(dist, packageName);
const archive = new AdmZip(packagePath);
const manifestEntry = archive.getEntries().find((entry) => /(^|\/)manifest\.json$/.test(entry.entryName));
if (!manifestEntry) throw new Error("패키지에 manifest.json이 없습니다.");
const manifest = JSON.parse(manifestEntry.getData().toString("utf8"));
if (typeof manifest.CodePath !== "string" || manifest.CodePath.length === 0) throw new Error("manifest.json에 CodePath가 없습니다.");

let extractionDir;
let server;
let child;
let timeout;
const sockets = new Set();
let childClosed = Promise.resolve({ code: null, signal: null });

const waitWithTimeout = async (promise, timeoutMs, fallback) => {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolvePromise) => {
        timer = setTimeout(() => resolvePromise(fallback), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const closeServer = async () => {
  const socketClosures = [...sockets].map((socket) => waitWithTimeout(
    new Promise((resolvePromise) => {
      if (socket.readyState === 3) {
        resolvePromise();
        return;
      }
      socket.once("close", resolvePromise);
      socket.terminate();
    }),
    1_000,
    undefined,
  ));
  await Promise.all(socketClosures);
  sockets.clear();
  if (!server) return;
  if (server.clients) for (const socket of server.clients) socket.terminate();
  await waitWithTimeout(
    new Promise((resolvePromise) => {
      try {
        server.close(() => resolvePromise());
      } catch {
        resolvePromise();
      }
    }),
    1_000,
    undefined,
  );
};

const stopChild = async () => {
  if (!child) return { code: null, signal: null };
  if (!child.killed) child.kill("SIGKILL");
  child.unref();
  return waitWithTimeout(
    childClosed,
    1_000,
    { code: null, signal: "cleanup-timeout" },
  );
};

try {
  extractionDir = await mkdtemp(resolve(tmpdir(), "tossinvest-runtime-"));
  archive.extractAllTo(extractionDir, true);
  const pluginDir = resolve(extractionDir, manifestEntry.entryName.split("/")[0]);
  server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  const serverListening = new Promise((resolvePromise, reject) => {
    server.once("listening", resolvePromise);
    server.once("error", reject);
  });
  await serverListening;
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fake Stream Deck 호스트 포트를 얻지 못했습니다.");

  let registered = false;
  let resolveRegistered;
  let rejectRegistered;
  const registration = new Promise((resolvePromise, reject) => {
    resolveRegistered = resolvePromise;
    rejectRegistered = reject;
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.on("message", (raw) => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { return; }
      if (message.event === "registerPlugin" && message.uuid === "com.saybgm.tossinvest") {
        registered = true;
        resolveRegistered();
      }
      if (message.event === "getGlobalSettings") socket.send(JSON.stringify({ event: "didReceiveGlobalSettings", payload: { settings: {} } }));
    });
  });

  child = spawn(process.execPath, [resolve(pluginDir, manifest.CodePath), "-port", String(address.port), "-pluginUUID", "com.saybgm.tossinvest", "-registerEvent", "registerPlugin", "-info", JSON.stringify({ application: { version: "7.1", language: "ko" } })], { cwd: pluginDir, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", () => undefined);
  child.stderr.on("data", () => undefined);
  childClosed = new Promise((resolvePromise) => {
    child.once("error", () => resolvePromise({ code: null, signal: "error" }));
    child.once("close", (code, signal) => resolvePromise({ code, signal }));
  });
  child.once("error", () => rejectRegistered(new Error("plugin process error")));
  child.once("close", (code, signal) => { if (!registered) rejectRegistered(new Error(`plugin exited before registration (${code ?? "unknown"}/${signal ?? "none"})`)); });
  timeout = setTimeout(() => rejectRegistered(new Error("fake Stream Deck 등록 timeout")), 5_000);
  await registration;
  console.log(`bundled plugin registered with fake Stream Deck host: ${packageName}`);
} finally {
  if (timeout) clearTimeout(timeout);
  await stopChild();
  await closeServer();
  if (extractionDir) await rm(extractionDir, { recursive: true, force: true });
}
