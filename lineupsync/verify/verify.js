"use strict";
(() => {
  let initialized = false;
  function initialize() {
  if (initialized) return;
  const status = document.getElementById("status");
  const retry = document.getElementById("retry");
  const bootstrap = window.__LINEUPSYNC_VERIFY__;
  const bridge = window.ReactNativeWebView;
  const allowedOrigin = ["https://cellohill.com", "https://www.cellohill.com"].includes(location.origin);
  const allowedPath = ["/lineupsync/verify", "/lineupsync/verify/"].includes(location.pathname);
  if (window.top !== window.self || !allowedOrigin || !allowedPath || location.search || location.hash) return;
  if (!bridge || typeof bridge.postMessage !== "function" || bootstrap?.version !== 1 ||
      typeof bootstrap.requestId !== "string" || !/^[a-zA-Z0-9-]{16,80}$/.test(bootstrap.requestId)) return;
  initialized = true;

  const requestId = bootstrap.requestId;
  let generation = 0;
  let widgetId;
  let script;
  let deadline;
  let expiry;
  let delivery;
  let pendingToken = null;
  let acknowledged = false;

  function show(message, canRetry = false) {
    status.textContent = message;
    retry.hidden = !canRetry;
  }

  function send(type, token) {
    try {
      bridge.postMessage(JSON.stringify({ source: "lineupsync-verify", version: 1, requestId, type, ...(token ? { token } : {}) }));
      return true;
    } catch {
      return false;
    }
  }

  function clearToken() {
    pendingToken = null;
    clearTimeout(expiry);
    clearTimeout(delivery);
  }

  function fail(message, type = "error") {
    generation += 1;
    clearTimeout(deadline);
    clearToken();
    send(type);
    show(message, true);
  }

  function deliver(attempt = 0) {
    if (!pendingToken || acknowledged) return;
    send("token", pendingToken);
    if (attempt < 4) delivery = setTimeout(() => deliver(attempt + 1), 1000);
    else fail("We couldn't return verification to the app. Try again.");
  }

  window.LineupSyncVerification = Object.freeze({
    acknowledge(id) {
      if (id !== requestId || !pendingToken) return;
      acknowledged = true;
      pendingToken = null;
      clearTimeout(delivery);
      show("Verified. Returning to LineupSync…");
    },
  });

  function render(current) {
    if (current !== generation) return;
    try {
      widgetId = window.turnstile.render("#widget", {
        sitekey: window.LINEUPSYNC_TURNSTILE_SITE_KEY,
        size: "flexible",
        "response-field": false,
        retry: "never",
        "refresh-expired": "never",
        "refresh-timeout": "never",
        callback(token) {
          if (current !== generation) return;
          if (typeof token !== "string" || !token.length || token.length > 2048) {
            fail("Verification could not complete. Try again.");
            return;
          }
          clearTimeout(deadline);
          clearToken();
          acknowledged = false;
          pendingToken = token;
          show("Verified. Returning to LineupSync…");
          expiry = setTimeout(() => fail("Verification expired. Try again.", "expired"), 290000);
          deliver();
        },
        "error-callback": () => { if (current === generation) fail("Verification couldn't load. Check your connection and try again."); },
        "expired-callback": () => { if (current === generation) fail("Verification expired. Try again.", "expired"); },
        "timeout-callback": () => { if (current === generation) fail("Verification timed out. Try again."); },
        "unsupported-callback": () => { if (current === generation) fail("Please update your device's browser software and try again."); },
      });
    } catch {
      fail("Verification couldn't start. Try again.");
    }
  }

  function start() {
    generation += 1;
    const current = generation;
    clearToken();
    clearTimeout(deadline);
    acknowledged = false;
    if (widgetId !== undefined && window.turnstile) window.turnstile.remove(widgetId);
    widgetId = undefined;
    if (script) script.remove();
    if (!/^[a-zA-Z0-9_-]{10,100}$/.test(window.LINEUPSYNC_TURNSTILE_SITE_KEY || "")) {
      show("Verification is not ready yet. Return to LineupSync and try again later.");
      send("unavailable");
      return;
    }
    show("Please complete the verification below.");
    deadline = setTimeout(() => fail("Verification timed out. Check your connection and try again."), 120000);
    if (window.turnstile) return render(current);
    script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = () => render(current);
    script.onerror = () => { if (current === generation) fail("Verification couldn't load. Check your connection and try again."); };
    document.head.appendChild(script);
  }

  retry.addEventListener("click", start);
  window.addEventListener("pagehide", () => {
    generation += 1;
    clearToken();
    clearTimeout(deadline);
  });
  start();
  }
  window.LineupSyncStartVerification = initialize;
  initialize();
})();
