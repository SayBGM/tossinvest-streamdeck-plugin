import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { WebSocketServer } from "ws";

const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
await once(server, "listening");
const address = server.address();
if (!address || typeof address === "string") throw new Error("fake Stream Deck 호스트 포트를 얻지 못했습니다.");
const info = JSON.stringify({ application: { version: "7.1", language: "ko" } });
const pluginDir = resolve("com.saybgm.tossinvest.sdPlugin");
const child = spawn(process.execPath, [
  resolve(pluginDir, "bin/plugin.js"),
  "-port", String(address.port),
  "-pluginUUID", "com.saybgm.tossinvest",
  "-registerEvent", "registerPlugin",
  "-info", info,
], { cwd: pluginDir, stdio: ["ignore", "pipe", "pipe"] });
let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

let registered = false;
child.on("error", (error) => { stderr += `child error: ${error.message}\n`; });
child.on("exit", (code, signal) => { stderr += `child exit: ${code}/${signal}\n`; });
let resolveDone;
const done = new Promise((resolvePromise) => { resolveDone = resolvePromise; });
server.on("connection", (socket) => {
  stdout += "server connection\n";
  socket.on("message", (raw) => {
    stdout += `server message: ${raw.toString().slice(0, 120)}\n`;
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    if (message.event === "registerPlugin" && message.uuid === "com.saybgm.tossinvest") {
      registered = true;
      resolveDone();
    }
    if (message.event === "getGlobalSettings") {
      socket.send(JSON.stringify({ event: "didReceiveGlobalSettings", payload: { settings: {} } }));
    }
  });
});
try {
  await Promise.race([done, new Promise((_, reject) => setTimeout(() => reject(new Error("fake Stream Deck 등록 timeout")), 5_000))]);
} catch (error) {
  child.kill("SIGKILL");
  await once(child, "close").catch(() => undefined);
  await new Promise((resolvePromise) => server.close(() => resolvePromise()));
  throw new Error(`${error instanceof Error ? error.message : error}\nstdout=${stdout}\nstderr=${stderr}`);
}
child.kill("SIGKILL");
await once(child, "close");
await new Promise((resolvePromise) => server.close(() => resolvePromise()));
if (!registered) throw new Error("plugin registration was not received");
console.log("bundled plugin registered with fake Stream Deck host");
