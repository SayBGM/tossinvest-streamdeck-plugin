/** Minimal Stream Deck Property Inspector transport (KIS Stream Deck architecture). */
var websocket = null;
var pluginUUID = null;
var actionContext = null;
var actionInfo = null;

// Called by Stream Deck after the Property Inspector document loads.
function connectElgatoStreamDeckSocket(
  inPort,
  inPluginUUID,
  inRegisterEvent,
  inInfo,
  inActionInfo,
) {
  pluginUUID = inPluginUUID;
  try {
    actionInfo =
      typeof inActionInfo === "string"
        ? JSON.parse(inActionInfo)
        : inActionInfo;
  } catch (_) {
    actionInfo = {
      action: "com.saybgm.tossinvest.quote",
      context: null,
      payload: { settings: {} },
    };
  }
  actionContext =
    actionInfo && typeof actionInfo.context === "string"
      ? actionInfo.context
      : null;

  var wsUrl = "ws://127.0.0.1:" + inPort;
  try {
    websocket = new WebSocket(wsUrl);
  } catch (_) {
    websocket = new WebSocket("ws://localhost:" + inPort);
  }

  websocket.onopen = function () {
    websocket.send(
      JSON.stringify({ event: inRegisterEvent, uuid: inPluginUUID }),
    );
    websocket.send(
      JSON.stringify({ event: "getGlobalSettings", context: pluginUUID }),
    );
    document.dispatchEvent(
      new CustomEvent("piDidReceiveSettings", {
        detail:
          (actionInfo && actionInfo.payload && actionInfo.payload.settings) ||
          {},
      }),
    );
    document.dispatchEvent(new CustomEvent("piDidConnect"));
  };

  websocket.onmessage = function (event) {
    var data;
    try {
      data = JSON.parse(event.data);
    } catch (_) {
      return;
    }
    if (data.event === "didReceiveSettings") {
      document.dispatchEvent(
        new CustomEvent("piDidReceiveSettings", {
          detail: (data.payload && data.payload.settings) || {},
        }),
      );
    } else if (data.event === "didReceiveGlobalSettings") {
      document.dispatchEvent(
        new CustomEvent("piDidReceiveGlobalSettings", {
          detail: (data.payload && data.payload.settings) || {},
        }),
      );
    } else if (data.event === "sendToPropertyInspector") {
      document.dispatchEvent(
        new CustomEvent("piDidReceiveMessage", { detail: data.payload || {} }),
      );
    }
  };

  websocket.onerror = function (err) {
    document.dispatchEvent(new CustomEvent("piError", { detail: err }));
  };
}

function setSettings(settings) {
  if (!websocket || websocket.readyState !== 1 || !actionContext) return;
  websocket.send(
    JSON.stringify({
      event: "setSettings",
      context: actionContext,
      payload: settings,
    }),
  );
}

function getGlobalSettings() {
  if (!websocket || websocket.readyState !== 1) return;
  websocket.send(
    JSON.stringify({ event: "getGlobalSettings", context: pluginUUID }),
  );
}

function setGlobalSettings(settings) {
  if (!websocket || websocket.readyState !== 1) return;
  websocket.send(
    JSON.stringify({
      event: "setGlobalSettings",
      context: pluginUUID,
      payload: settings,
    }),
  );
}

function sendToPlugin(payload) {
  if (!websocket || websocket.readyState !== 1 || !actionInfo || !actionContext) return;
  websocket.send(
    JSON.stringify({
      action:
        (actionInfo && actionInfo.action) || "com.saybgm.tossinvest.quote",
      event: "sendToPlugin",
      context: actionContext,
      payload: payload,
    }),
  );
}
