(function () {
  "use strict";

  var state = {
    actionSettings: {},
    globalSettings: {},
    request: 0,
    draftSymbol: "",
    resolveRequestId: null,
    globalSaveRequestId: null,
    displaySaveRequestId: null,
    previewRequestId: null,
    connectionState: "idle",
    globalDraftDirty: false,
  };
  var pendingRequests = {};

  var $ = function (id) {
    return document.getElementById(id);
  };

  var requestId = function () {
    state.request += 1;
    return "pi-" + Date.now() + "-" + state.request;
  };

  var setStatus = function (id, text, error) {
    var el = $(id);
    if (!el) return;
    el.textContent = text || "";
    el.style.color = error ? "#F04452" : "#00C073";
  };

  var setBusy = function (scope, busy) {
    var ids =
      scope === "global"
        ? ["saveGlobal", "testGlobal"]
        : scope === "display"
          ? ["saveDisplay"]
        : ["resolve", "symbol"];
    if (scope === "global" || scope === "display") {
      var saveBusy = Boolean(state.globalSaveRequestId || state.displaySaveRequestId);
      ["saveGlobal", "saveDisplay"].forEach(function (id) {
        var el = $(id);
        if (el) el.disabled = saveBusy;
      });
    } else {
      ids.forEach(function (id) {
        var el = $(id);
        if (el) el.disabled = busy;
      });
    }
    if (scope === "resolve") {
      document.querySelectorAll(".chip").forEach(function (chip) {
        chip.disabled = busy;
      });
    }
  };

  var clearPendingRequest = function (reqId) {
    var pending = pendingRequests[reqId];
    if (!pending) return null;
    clearTimeout(pending.timeout);
    delete pendingRequests[reqId];
    return pending;
  };

  var sendCommand = function (type, extra) {
    var reqId = requestId();
    var payload = Object.assign({ type: type, requestId: reqId }, extra || {});

    // Use sdpi.js transport (includes action: actionInfo.action)
    sendToPlugin(payload);

    pendingRequests[reqId] = {
      type: type,
      timeout: setTimeout(function () {
        var pending = pendingRequests[reqId];
        if (!pending) return;
        delete pendingRequests[reqId];
        if (type === "global/save") {
          if (state.globalSaveRequestId === reqId) {
            state.globalSaveRequestId = null;
            setBusy("global", false);
          }
          setStatus(
            "globalStatus",
            "인증 확인 시간이 초과되었습니다. WTS IP 허용과 네트워크를 확인하세요.",
            true,
          );
        } else if (type === "display/save") {
          if (state.displaySaveRequestId === reqId) {
            state.displaySaveRequestId = null;
            setBusy("display", false);
          }
          setStatus("displayStatus", "표시 설정 저장 시간이 초과되었습니다.", true);
        } else if (type === "symbol/resolve") {
          if (state.resolveRequestId !== reqId) return;
          state.resolveRequestId = null;
          setBusy("resolve", false);
          setStatus(
            "actionStatus",
            "요청 시간 초과 (종목 코드 및 네트워크를 확인하세요)",
            true,
          );
        }
      }, type === "global/save" || type === "display/save" ? 20_000 : 12_000),
    };

    return reqId;
  };

  var actionPayload = function () {
    return {
      schemaVersion: 1,
      // The input can contain an unverified draft. Persist only the resolved
      // settings that were previously accepted by the official API.
      symbol: (state.actionSettings && state.actionSettings.symbol) || "",
      name: (state.actionSettings && state.actionSettings.name) || "",
      market:
        (state.actionSettings && state.actionSettings.market) || undefined,
      currency: (state.actionSettings && state.actionSettings.currency) || "",
      keyBehavior: $("keyBehavior").value || "refresh",
      viewMode: $("viewMode").value || "chart",
      colorTheme: $("colorTheme").value || "kr",
      showChart: true,
      showCurrencySymbol: $("showCurrencySymbol").checked,
    };
  };

  var saveActionSettings = function () {
    var payload = actionPayload();
    if (!payload.symbol) return;
    state.actionSettings = payload;
    setSettings(payload);
    requestPreview();
  };

  var requestPreview = function () {
    if (state.actionSettings && state.actionSettings.symbol) {
      state.previewRequestId = sendCommand("quote/preview", {
        settings: state.actionSettings,
      });
    }
  };

  var updateChipActive = function (currentSymbol) {
    currentSymbol = (currentSymbol || ($("symbol") && $("symbol").value) || "")
      .trim()
      .toUpperCase();
    document.querySelectorAll(".chip").forEach(function (chip) {
      if (chip.getAttribute("data-symbol") === currentSymbol) {
        chip.classList.add("active");
      } else {
        chip.classList.remove("active");
      }
    });
  };

  var renderGlobal = function (settings, isConfigured, options) {
    settings = settings || state.globalSettings || {};
    state.globalSettings = settings;

    if (isConfigured !== undefined) {
      state.isConfigured = Boolean(isConfigured);
    } else if (settings.clientId && settings.clientSecret) {
      state.isConfigured = true;
    }

    var preserveCredentialDraft = options && options.preserveCredentialDraft;
    if (settings.clientId && !preserveCredentialDraft) {
      $("clientId").value = settings.clientId;
    }

    var secretInput = $("clientSecret");
    if (!preserveCredentialDraft && settings.clientSecret && settings.clientSecret !== "••••••••") {
      secretInput.value = settings.clientSecret;
    } else if (!preserveCredentialDraft && (state.isConfigured || settings.clientSecret === "••••••••")) {
      secretInput.value = "";
      secretInput.placeholder = "•••••••• (저장됨 - 변경 시에만 입력)";
    } else {
      secretInput.placeholder = "Client Secret";
    }

    $("renderMode").value =
      settings.renderMode === "economy" ? "economy" : "realtime";

    if ($("signalDuration")) {
      $("signalDuration").value = String(settings.signalDurationSec || 5);
    }

    var savedBadge = $("savedKeyBadge");
    var globalFields = $("globalFields");
    var savedBadgeClientId = $("savedBadgeClientId");
    var toggleBtn = $("toggleGlobalBtn");

    if (state.isConfigured) {
      if (savedBadge) savedBadge.hidden = false;
      if (savedBadgeClientId && settings.clientId) {
        var maskedId =
          settings.clientId.length > 8
            ? settings.clientId.slice(0, 4) +
              "•••" +
              settings.clientId.slice(-4)
            : settings.clientId;
        savedBadgeClientId.textContent = "ID: " + maskedId;
      }
      if (globalFields && !state.globalUserExpanded) {
        globalFields.classList.add("collapsed");
        if (toggleBtn) toggleBtn.textContent = "설정 변경 ▾";
      }
    } else {
      if (savedBadge) savedBadge.hidden = true;
      if (globalFields) {
        globalFields.classList.remove("collapsed");
      }
    }
  };

  var setViewMode = function (mode, shouldSave) {
    mode = mode || "chart";
    var viewModeEl = $("viewMode");
    if (viewModeEl) viewModeEl.value = mode;

    var tabs = document.querySelectorAll(".view-mode-tab");
    tabs.forEach(function (tab) {
      if (tab.getAttribute("data-mode") === mode) {
        tab.classList.add("active");
        tab.setAttribute("aria-selected", "true");
        tab.setAttribute("tabindex", "0");
      } else {
        tab.classList.remove("active");
        tab.setAttribute("aria-selected", "false");
        tab.setAttribute("tabindex", "-1");
      }
    });

    var descEl = $("viewModeDesc");
    if (descEl) {
      if (mode === "chart") {
        descEl.textContent = "현재가, 등락폭, 미니 차트가 함께 표시됩니다.";
      } else {
        descEl.textContent =
          "현재가, 등락 정보, 당일 고가/저가를 1줄로 깔끔하게 확인합니다.";
      }
    }

    if (shouldSave) {
      saveActionSettings();
    }
  };

  var renderAction = function (settings) {
    settings = settings || state.actionSettings || {};
    if (settings.symbol !== state.actionSettings.symbol) {
      renderQuoteStatus({});
    }
    state.actionSettings = settings;

    var sym = settings.symbol || "";
    if (!state.resolveRequestId) {
      state.draftSymbol = sym;
      $("symbol").value = sym;
    }
    $("keyBehavior").value = settings.keyBehavior || "refresh";
    setViewMode(settings.viewMode || "chart", false);
    $("colorTheme").value = settings.colorTheme || "kr";
    $("showCurrencySymbol").checked = settings.showCurrencySymbol !== false;

    updateChipActive(sym);

    var resolved = $("resolved");
    if (settings.name && settings.symbol) {
      resolved.hidden = false;
      var isKr = settings.market === "KR";
      var badgeClass = isKr ? "badge-kr" : "badge-us";
      var marketText = isKr ? "KR" : "US";
      var currencyText = settings.currency || (isKr ? "KRW" : "USD");
      var connection = connectionStatus(state.connectionState);
      resolved.innerHTML =
        "<div class='resolved-card'>" +
        "<div class='resolved-main'>" +
        "<div class='resolved-name-row'>" +
        "<span class='resolved-name'>" +
        escapeHtml(settings.name) +
        "</span>" +
        "<span class='market-badge " +
        badgeClass +
        "'>" +
        marketText +
        "</span>" +
        "</div>" +
        "<div class='resolved-meta'>" +
        escapeHtml(settings.symbol) +
        " · " +
        escapeHtml(currencyText) +
        "</div>" +
        "</div>" +
        "<div class='resolved-status-group'>" +
        "<div class='resolved-status resolved-status-confirmed'>✓ 종목 확인됨</div>" +
        "<div class='resolved-status resolved-status-connection " + connection.className + "'>" +
        connection.label +
        "</div>" +
        "</div>" +
        "</div>";
    } else {
      resolved.hidden = true;
    }
  };

  var renderQuoteStatus = function (status) {
    var output = $("quoteStatus");
    if (!output) return;
    var message = status && typeof status.message === "string" ? status.message : "";
    output.textContent = message;
    output.hidden = !message;
  };

  var updateResolvedConnectionStatus = function () {
    var status = document.querySelector(".resolved-status-connection");
    if (!status) return;
    var connection = connectionStatus(state.connectionState);
    status.textContent = connection.label;
    status.className =
      "resolved-status resolved-status-connection " + connection.className;
  };

  var connectionStatus = function (stateName) {
    var statuses = {
      idle: { label: "시세 연결 대기 중", className: "status-idle" },
      connecting: { label: "시세 연결 중…", className: "status-connecting" },
      connected: { label: "시세 서버 연결됨", className: "status-connected" },
      backoff: { label: "시세 연결 재시도 중…", className: "status-backoff" },
      stopped: { label: "시세 연결 중지됨", className: "status-stopped" },
    };
    return statuses[stateName] || statuses.idle;
  };

  var escapeHtml = function (str) {
    return String(str || "").replace(/[&<>"']/g, function (m) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[m];
    });
  };

  var resolveSymbol = function (sym) {
    var symbol = (sym || $("symbol").value).trim().toUpperCase();
    if (!symbol) {
      setStatus("actionStatus", "종목 코드 또는 티커를 입력하세요.", true);
      return;
    }
    if (state.resolveRequestId) return;
    state.draftSymbol = symbol;
    $("symbol").value = symbol;
    var reqId = sendCommand("symbol/resolve", { symbol: symbol });
    state.resolveRequestId = reqId;
    setBusy("resolve", true);
    setStatus("actionStatus", "종목 확인 중…");
  };

  // Event handlers for SDPI
  document.addEventListener("piDidConnect", function () {
    // Proactively request initial settings and status from plugin
    sendCommand("init");
    requestPreview();
  });

  document.addEventListener("piDidReceiveSettings", function (e) {
    var settings = e.detail || {};
    renderAction(settings);
    requestPreview();
  });

  var updateStepVisibility = function (isConfigured) {
    var actionSection = $("actionSection");
    var setupGuide = $("setupGuide");
    var savedKeyBadge = $("savedKeyBadge");
    if (!actionSection) return;

    if (isConfigured !== undefined) {
      state.isConfigured = Boolean(isConfigured);
    } else if (state.isConfigured === undefined) {
      state.isConfigured = Boolean(
        state.globalSettings &&
        state.globalSettings.clientId &&
        (state.globalSettings.clientSecret || $("clientSecret").value.trim()),
      );
    }

    if (state.isConfigured) {
      actionSection.hidden = false;
      if (setupGuide) setupGuide.hidden = true;
      if (savedKeyBadge) savedKeyBadge.hidden = false;
    } else {
      actionSection.hidden = true;
      if (setupGuide) setupGuide.hidden = false;
      if (savedKeyBadge) savedKeyBadge.hidden = true;
    }
  };

  document.addEventListener("piDidReceiveGlobalSettings", function (e) {
    var settings = e.detail || {};
    var configured = Boolean(settings.clientId && settings.clientSecret);
    renderGlobal(settings, configured, {
      preserveCredentialDraft: state.globalDraftDirty,
    });
    updateStepVisibility(configured);
    if (configured) {
      setStatus("globalStatus", "저장된 자격증명을 확인했습니다.");
    }
  });

  document.addEventListener("piDidReceiveMessage", function (e) {
    var payload = e.detail || {};
    if (
      payload.actionId &&
      (!actionInfo || payload.actionId !== actionInfo.context)
    ) {
      return;
    }
    var pending = payload.requestId
      ? clearPendingRequest(payload.requestId)
      : null;
    var requestType = pending && pending.type;

    if (
      payload.image &&
      (payload.type === "preview" ||
        (requestType === "quote/preview" &&
          payload.requestId === state.previewRequestId))
    ) {
      var img = $("keyPreview");
      var placeholder = $("previewPlaceholder");
      if (img) {
        img.src = payload.image;
        img.hidden = false;
      }
      if (placeholder) placeholder.hidden = true;
    }

    if (payload.type === "init") {
      if (payload.quoteStatus) renderQuoteStatus(payload.quoteStatus);
      if (typeof payload.connectionState === "string") {
        state.connectionState = payload.connectionState;
        updateResolvedConnectionStatus();
      }
      if (payload.globalSettings) {
        renderGlobal(payload.globalSettings, payload.isConfigured);
      }
      updateStepVisibility(payload.isConfigured);
      if (payload.isConfigured) {
        setStatus("globalStatus", "저장된 자격증명을 확인했습니다.");
      }
    } else if (payload.type === "quote-status") {
      renderQuoteStatus(payload);
    } else if (payload.type === "global-settings" && payload.settings) {
      renderGlobal(payload.settings, payload.isConfigured, { preserveCredentialDraft: true });
      updateStepVisibility(payload.isConfigured);
    } else if (payload.type === "connection") {
      state.connectionState = typeof payload.state === "string" ? payload.state : "idle";
      updateResolvedConnectionStatus();
    } else if (payload.type === "settings-updated" && payload.settings) {
      renderAction(payload.settings);
      requestPreview();
    } else if (
      payload.ok &&
      payload.settings &&
      payload.settings.schemaVersion === 1 &&
      payload.settings.symbol
    ) {
      // Ignore a superseded resolver response. The key remains bound to its
      // last confirmed symbol until the newest request succeeds.
      if (requestType !== "symbol/resolve" ||
          payload.requestId !== state.resolveRequestId) {
        return;
      }
      state.resolveRequestId = null;
      setBusy("resolve", false);
      var merged = Object.assign({}, state.actionSettings, payload.settings, {
        keyBehavior: $("keyBehavior").value,
        viewMode: $("viewMode").value,
        colorTheme: $("colorTheme").value,
        showChart: true,
        showCurrencySymbol: $("showCurrencySymbol").checked,
      });
      state.actionSettings = merged;
      state.draftSymbol = merged.symbol;
      setSettings(merged);
      renderAction(merged);
      requestPreview();
      setStatus(
        "actionStatus",
        "종목을 확인했습니다: " +
          (payload.settings.name || payload.settings.symbol),
      );
    } else if (payload.ok && payload.settings && requestType === "global/save") {
      if (requestType !== "global/save") return;
      if (requestType === "global/save") {
        state.globalSaveRequestId = null;
        setBusy("global", false);
      }
      renderGlobal(payload.settings, payload.isConfigured);
      state.globalDraftDirty = false;
      updateStepVisibility(
        payload.isConfigured !== undefined ? payload.isConfigured : true,
      );
      setStatus("globalStatus", payload.message || "전역 설정을 저장했습니다.");
      requestPreview();
    } else if (payload.ok && requestType === "display/save") {
      state.displaySaveRequestId = null;
      setBusy("display", false);
      if (payload.settings) renderGlobal(payload.settings, payload.isConfigured, { preserveCredentialDraft: true });
      setStatus("displayStatus", payload.message || "표시 설정을 저장했습니다.");
    } else if (payload.ok) {
      if (requestType === "global/test") {
        setStatus("globalStatus", payload.message || "인증에 성공했습니다.");
      } else if (payload.isConfigured) {
        updateStepVisibility(true);
        setStatus("globalStatus", payload.message || "성공했습니다.");
      }
    } else if (payload.message) {
      if (requestType === "global/save" || requestType === "global/test") {
        if (requestType === "global/save") {
          state.globalSaveRequestId = null;
          setBusy("global", false);
        }
        setStatus("globalStatus", payload.message, true);
      } else if (requestType === "symbol/resolve") {
        if (payload.requestId !== state.resolveRequestId) return;
        state.resolveRequestId = null;
        setBusy("resolve", false);
        setStatus("actionStatus", payload.message, true);
      } else if (requestType === "display/save") {
        state.displaySaveRequestId = null;
        setBusy("display", false);
        setStatus("displayStatus", payload.message, true);
      }
    }
  });

  document.addEventListener("piError", function () {
    setStatus("globalStatus", "Stream Deck 통신 연결 실패", true);
  });

  // UI Event Listeners
  $("saveGlobal").addEventListener("click", function () {
    var clientId = $("clientId").value.trim();
    var clientSecret = $("clientSecret").value.trim();
    if (!clientId) {
      setStatus("globalStatus", "Client ID를 입력하세요.", true);
      return;
    }
    if (!clientSecret && !state.isConfigured) {
      setStatus("globalStatus", "Client Secret을 입력하세요.", true);
      return;
    }
    var reqId = sendCommand("global/save", {
      clientId: clientId,
      clientSecret: clientSecret,
      renderMode: $("renderMode").value,
      signalDurationSec: Number($("signalDuration").value),
    });
    state.globalSaveRequestId = reqId;
    setBusy("global", true);
    setStatus("globalStatus", "인증 확인 중…");
  });

  $("saveDisplay").addEventListener("click", function () {
    if (state.displaySaveRequestId) return;
    var reqId = sendCommand("display/save", {
      renderMode: $("renderMode").value,
      signalDurationSec: Number($("signalDuration").value),
    });
    state.displaySaveRequestId = reqId;
    setBusy("display", true);
    setStatus("displayStatus", "표시 설정 저장 중…");
  });

  // Keep the legacy command compatible when an older inspector injects the
  // control, while current markup exposes only the validate-and-save CTA.
  if ($("testGlobal")) {
    $("testGlobal").addEventListener("click", function () {
      sendCommand("global/test");
      setStatus("globalStatus", "연결 테스트 중…");
    });
    $("testGlobal").hidden = true;
  }

  $("resolve").addEventListener("click", function () {
    resolveSymbol();
  });

  $("symbol").addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      resolveSymbol();
    }
  });

  $("symbol").addEventListener("input", function () {
    state.draftSymbol = $("symbol").value;
    if (!state.resolveRequestId) setStatus("actionStatus", "");
  });

  $("clientId").addEventListener("input", function () {
    state.globalDraftDirty = true;
  });
  $("clientSecret").addEventListener("input", function () {
    state.globalDraftDirty = true;
  });

  document.querySelectorAll(".chip").forEach(function (chip) {
    chip.addEventListener("click", function () {
      var sym = chip.getAttribute("data-symbol");
      if (sym) resolveSymbol(sym);
    });
  });

  document.querySelectorAll(".view-mode-tab").forEach(function (tab) {
    tab.addEventListener("click", function () {
      var mode = tab.getAttribute("data-mode");
      if (mode) setViewMode(mode, true);
    });
    tab.addEventListener("keydown", function (e) {
      var tabs = Array.prototype.slice.call(document.querySelectorAll(".view-mode-tab"));
      var index = tabs.indexOf(tab);
      var next = index;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (index + 1) % tabs.length;
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (index - 1 + tabs.length) % tabs.length;
      if (next !== index) {
        e.preventDefault();
        tabs[next].focus();
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        var mode = tab.getAttribute("data-mode");
        if (mode) setViewMode(mode, true);
      }
    });
  });

  document.querySelectorAll(".preview-size-btn").forEach(function (button) {
    button.addEventListener("click", function () {
      var size = button.getAttribute("data-preview-size") === "144" ? 144 : 72;
      var box = document.querySelector(".preview-box");
      var image = $("keyPreview");
      document.querySelectorAll(".preview-size-btn").forEach(function (item) {
        item.classList.toggle("active", item === button);
        item.setAttribute("aria-pressed", item === button ? "true" : "false");
      });
      if (box) {
        box.style.width = size + "px";
        box.style.height = size + "px";
      }
      if (image) {
        image.width = size;
        image.height = size;
        image.style.width = size + "px";
        image.style.height = size + "px";
      }
      var placeholder = $("previewPlaceholder");
      if (placeholder) {
        placeholder.style.width = size + "px";
        placeholder.style.height = size + "px";
      }
    });
  });

  $("keyBehavior").addEventListener("change", saveActionSettings);
  $("viewMode").addEventListener("change", saveActionSettings);
  $("colorTheme").addEventListener("change", saveActionSettings);
  $("showCurrencySymbol").addEventListener("change", saveActionSettings);

  var toggleBtn = $("toggleGlobalBtn");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", function () {
      var globalFields = $("globalFields");
      if (!globalFields) return;
      var isCollapsed = globalFields.classList.contains("collapsed");
      if (isCollapsed) {
        globalFields.classList.remove("collapsed");
        toggleBtn.textContent = "접기 ▴";
        state.globalUserExpanded = true;
      } else {
        globalFields.classList.add("collapsed");
        toggleBtn.textContent = "설정 변경 ▾";
        state.globalUserExpanded = false;
      }
    });
  }

  renderGlobal();
  renderAction();
  updateStepVisibility();
})();
