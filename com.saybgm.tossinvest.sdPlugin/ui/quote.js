(function () {
  "use strict";

  var state = {
    actionSettings: {},
    globalSettings: {},
    request: 0,
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

  var sendCommand = function (type, extra) {
    var reqId = requestId();
    var payload = Object.assign({ type: type, requestId: reqId }, extra || {});

    // Use sdpi.js transport (includes action: actionInfo.action)
    sendToPlugin(payload);

    pendingRequests[reqId] = setTimeout(function () {
      delete pendingRequests[reqId];
      if (type.indexOf("global") === 0) {
        setStatus(
          "globalStatus",
          "요청 시간 초과 (토스증권 WTS IP 허용 및 네트워크를 확인하세요)",
          true,
        );
      } else {
        setStatus(
          "actionStatus",
          "요청 시간 초과 (종목 코드 및 네트워크를 확인하세요)",
          true,
        );
      }
    }, 12000);

    return reqId;
  };

  var actionPayload = function () {
    return {
      schemaVersion: 1,
      symbol: ($("symbol").value || "").trim().toUpperCase(),
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
    state.actionSettings = payload;
    setSettings(payload);
    requestPreview();
  };

  var requestPreview = function () {
    if (state.actionSettings && state.actionSettings.symbol) {
      sendCommand("quote/preview", { settings: state.actionSettings });
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

  var renderGlobal = function (settings, isConfigured) {
    settings = settings || state.globalSettings || {};
    state.globalSettings = settings;

    if (isConfigured !== undefined) {
      state.isConfigured = Boolean(isConfigured);
    } else if (settings.clientId && settings.clientSecret) {
      state.isConfigured = true;
    }

    if (settings.clientId) {
      $("clientId").value = settings.clientId;
    }

    var secretInput = $("clientSecret");
    if (settings.clientSecret && settings.clientSecret !== "••••••••") {
      secretInput.value = settings.clientSecret;
    } else if (state.isConfigured || settings.clientSecret === "••••••••") {
      secretInput.value = "";
      secretInput.placeholder = "•••••••• (저장됨 - 변경 시에만 입력)";
    } else {
      secretInput.placeholder = "Client Secret";
    }

    $("renderMode").value =
      settings.renderMode === "economy" ? "economy" : "realtime";

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
      } else {
        tab.classList.remove("active");
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
    state.actionSettings = settings;

    var sym = settings.symbol || ($("symbol") && $("symbol").value) || "";
    $("symbol").value = sym;
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
        "<div class='resolved-status'>✓ 연결됨</div>" +
        "</div>";
    } else {
      resolved.hidden = true;
    }
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
    $("symbol").value = symbol;
    updateChipActive(symbol);
    saveActionSettings();
    sendCommand("symbol/resolve", { symbol: symbol });
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
    renderGlobal(settings, configured);
    updateStepVisibility(configured);
    if (configured) {
      setStatus("globalStatus", "저장된 자격증명을 확인했습니다.");
    }
  });

  document.addEventListener("piDidReceiveMessage", function (e) {
    var payload = e.detail || {};

    if (payload.requestId && pendingRequests[payload.requestId]) {
      clearTimeout(pendingRequests[payload.requestId]);
      delete pendingRequests[payload.requestId];
    }

    if (payload.image) {
      var img = $("keyPreview");
      if (img) img.src = payload.image;
    }

    if (payload.type === "init") {
      if (payload.globalSettings) {
        renderGlobal(payload.globalSettings, payload.isConfigured);
      }
      updateStepVisibility(payload.isConfigured);
      if (payload.isConfigured) {
        setStatus("globalStatus", "저장된 자격증명을 확인했습니다.");
      }
    } else if (payload.type === "settings-updated" && payload.settings) {
      renderAction(payload.settings);
      requestPreview();
    } else if (
      payload.ok &&
      payload.settings &&
      payload.settings.schemaVersion === 1 &&
      payload.settings.symbol
    ) {
      var merged = Object.assign({}, state.actionSettings, payload.settings, {
        keyBehavior: $("keyBehavior").value,
        viewMode: $("viewMode").value,
        colorTheme: $("colorTheme").value,
        showChart: true,
        showCurrencySymbol: $("showCurrencySymbol").checked,
      });
      state.actionSettings = merged;
      setSettings(merged);
      renderAction(merged);
      requestPreview();
      setStatus(
        "actionStatus",
        "종목을 확인했습니다: " +
          (payload.settings.name || payload.settings.symbol),
      );
    } else if (payload.ok && payload.settings) {
      renderGlobal(payload.settings, payload.isConfigured);
      updateStepVisibility(
        payload.isConfigured !== undefined ? payload.isConfigured : true,
      );
      setStatus("globalStatus", payload.message || "전역 설정을 저장했습니다.");
      requestPreview();
    } else if (payload.ok) {
      if (payload.isConfigured) {
        updateStepVisibility(true);
      }
      setStatus("globalStatus", payload.message || "성공했습니다.");
    } else if (payload.message) {
      setStatus("globalStatus", payload.message, true);
      setStatus("actionStatus", payload.message, true);
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
    sendCommand("global/save", {
      clientId: clientId,
      clientSecret: clientSecret,
      renderMode: $("renderMode").value,
    });
    setStatus("globalStatus", "저장 중…");
  });

  $("testGlobal").addEventListener("click", function () {
    sendCommand("global/test");
    setStatus("globalStatus", "연결 테스트 중…");
  });

  $("resolve").addEventListener("click", function () {
    resolveSymbol();
  });

  $("symbol").addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      resolveSymbol();
    }
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
