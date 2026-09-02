(function () {
  "use strict";
  var state = { socket: null, context: null, actionSettings: {}, globalSettings: {}, request: 0 };
  var $ = function (id) { return document.getElementById(id); };
  var requestId = function () { state.request += 1; return "pi-" + Date.now() + "-" + state.request; };
  var setStatus = function (id, text, error) { var el = $(id); el.textContent = text || ""; el.style.color = error ? "#ff8f8f" : "#9fe5c5"; };
  var send = function (message) { if (state.socket && state.socket.readyState === 1) state.socket.send(JSON.stringify(message)); };
  var sendCommand = function (type, extra) { send({ event: "sendToPlugin", context: state.context, payload: Object.assign({ type: type, requestId: requestId() }, extra || {}) }); };
  var setActionSettings = function (settings) { state.actionSettings = settings; send({ event: "setSettings", context: state.context, payload: settings }); renderAction(); };
  var renderGlobal = function () {
    var settings = state.globalSettings || {};
    $("clientId").value = settings.clientId || "";
    if (settings.clientSecret && settings.clientSecret !== "••••••••") $("clientSecret").value = settings.clientSecret;
    $("renderMode").value = settings.renderMode === "economy" ? "economy" : "realtime";
  };
  var renderAction = function () {
    var settings = state.actionSettings || {};
    $("symbol").value = settings.symbol || $("symbol").value || "";
    $("keyBehavior").value = settings.keyBehavior || "refresh";
    var resolved = $("resolved");
    if (settings.name && settings.market) { resolved.hidden = false; resolved.textContent = settings.name + " · " + settings.symbol + " · " + settings.market + " / " + settings.currency; }
    else resolved.hidden = true;
  };
  var handleMessage = function (message) {
    if (message.event === "didReceiveSettings") { state.actionSettings = message.payload && message.payload.settings || {}; renderAction(); }
    if (message.event === "didReceiveGlobalSettings") { state.globalSettings = message.payload && message.payload.settings || {}; renderGlobal(); }
    if (message.event === "sendToPropertyInspector") {
      var payload = message.payload || {};
      if (payload.ok && payload.settings && payload.settings.schemaVersion === 1 && payload.settings.symbol) { setActionSettings(Object.assign({}, state.actionSettings, payload.settings, { keyBehavior: $("keyBehavior").value })); setStatus("actionStatus", "종목을 확인했습니다."); }
      else if (payload.ok && payload.settings) { state.globalSettings = payload.settings; renderGlobal(); setStatus("globalStatus", payload.message || "저장했습니다."); }
      else if (payload.ok) setStatus("globalStatus", payload.message || "연결에 성공했습니다.");
      else if (payload.message) { setStatus("globalStatus", payload.message, true); setStatus("actionStatus", payload.message, true); }
    }
  };
  window.connectElgatoStreamDeckSocket = function (port, uuid, registerEvent, info, actionInfo) {
    state.context = actionInfo && actionInfo.context;
    state.socket = new WebSocket("ws://localhost:" + port);
    state.socket.onopen = function () { send({ event: registerEvent, uuid: uuid }); send({ event: "getSettings", context: state.context }); send({ event: "getGlobalSettings", context: uuid }); };
    state.socket.onmessage = function (event) { try { handleMessage(JSON.parse(event.data)); } catch (_) { /* ignore malformed host frames */ } };
  };
  $("saveGlobal").addEventListener("click", function () { sendCommand("global/save", { clientId: $("clientId").value.trim(), clientSecret: $("clientSecret").value, renderMode: $("renderMode").value }); setStatus("globalStatus", "저장 중…"); });
  $("testGlobal").addEventListener("click", function () { sendCommand("global/test"); setStatus("globalStatus", "연결 테스트 중…"); });
  $("resolve").addEventListener("click", function () { var symbol = $("symbol").value.trim(); if (!symbol) { setStatus("actionStatus", "종목 코드를 입력하세요.", true); return; } sendCommand("symbol/resolve", { symbol: symbol }); setStatus("actionStatus", "종목 확인 중…"); });
  $("keyBehavior").addEventListener("change", function () { if (state.actionSettings && state.actionSettings.symbol) setActionSettings(Object.assign({}, state.actionSettings, { keyBehavior: $("keyBehavior").value })); });
  renderGlobal(); renderAction();
}());
