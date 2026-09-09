import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";

const source = await readFile(resolve("com.saybgm.tossinvest.sdPlugin/ui/sdpi.js"), "utf8");
const sent = [];
const listeners = new Map();
const document = {
  addEventListener(type, listener) {
    listeners.set(type, listener);
  },
  dispatchEvent() {
    return true;
  },
};

class FakeWebSocket {
  static instances = [];
  readyState = 0;
  onopen = null;
  onmessage = null;
  onerror = null;

  constructor() {
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.();
    });
  }

  send(raw) {
    sent.push(JSON.parse(raw));
  }
}

const context = vm.createContext({
  WebSocket: FakeWebSocket,
  CustomEvent: class CustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  },
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
    context: "key-context-42",
    payload: { settings: {} },
  }),
);

await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
context.sendToPlugin({ type: "init", requestId: "pi-transport-1" });
context.setSettings({ schemaVersion: 1, symbol: "005930" });

const register = sent.find((message) => message.event === "registerPropertyInspector");
const global = sent.find((message) => message.event === "getGlobalSettings");
const command = sent.find((message) => message.event === "sendToPlugin");
const settings = sent.find((message) => message.event === "setSettings");

if (!register || register.uuid !== "com.saybgm.tossinvest") {
  throw new Error("Property Inspector registration payload가 올바르지 않습니다.");
}
if (!global || global.context !== "com.saybgm.tossinvest") {
  throw new Error("전역 설정 요청은 플러그인 UUID를 context로 사용해야 합니다.");
}
if (!command || command.context !== "key-context-42" || command.action !== "com.saybgm.tossinvest.quote") {
  throw new Error("sendToPlugin이 actionInfo.context를 전달하지 않습니다.");
}
if (!settings || settings.context !== "key-context-42") {
  throw new Error("setSettings가 actionInfo.context를 전달하지 않습니다.");
}

console.log("Property Inspector transport context verified");
