import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";

const source = readFileSync(new URL("../lineupsync/verify/verify.js", import.meta.url), "utf8");
const requestId = "verification-request-123456";

function page({ bridge = true, bootstrap = true, origin = "https://cellohill.com", key = "test-public-site-key", search = "", framed = false } = {}) {
  const elements = { status: { textContent: "Open this page from the LineupSync app to continue." }, retry: { hidden: true, addEventListener: (_, callback) => { elements.retry.click = callback; } } };
  const timers = new Map();
  const messages = [];
  const scripts = [];
  const widgets = [];
  const events = {};
  let sequence = 0;
  const window = {
    LINEUPSYNC_TURNSTILE_SITE_KEY: key,
    addEventListener: (name, callback) => { events[name] = callback; },
  };
  window.self = window;
  window.top = framed ? {} : window;
  if (bridge) window.ReactNativeWebView = { postMessage: (message) => messages.push(JSON.parse(message)) };
  if (bootstrap) window.__LINEUPSYNC_VERIFY__ = { version: 1, requestId };
  const context = {
    window,
    location: { origin, pathname: "/lineupsync/verify/", search, hash: "" },
    document: {
      getElementById: (id) => elements[id],
      createElement: () => ({ remove() {} }),
      head: { appendChild: (script) => scripts.push(script) },
    },
    setTimeout: (callback, delay) => { timers.set(++sequence, { callback, delay }); return sequence; },
    clearTimeout: (id) => timers.delete(id),
  };
  runInNewContext(source, context);
  return {
    window, messages, scripts, elements, widgets, events,
    load() {
      window.turnstile = { render: (_, options) => { widgets.push(options); return widgets.length; }, remove() {} };
      scripts.at(-1).onload();
    },
    tick(delay) {
      const match = [...timers.entries()].find(([, timer]) => timer.delay === delay);
      assert.ok(match, `Missing timer ${delay}`);
      timers.delete(match[0]);
      match[1].callback();
    },
  };
}

test("direct visits, iframes, untrusted origins and query input never load the widget", () => {
  for (const options of [{ bridge: false }, { bootstrap: false }, { origin: "https://evil.test" }, { search: "?sitekey=untrusted" }, { framed: true }]) {
    const state = page(options);
    assert.equal(state.scripts.length, 0);
    assert.equal(state.messages.length, 0);
  }
});

test("missing configuration fails closed without a provider request", () => {
  const state = page({ key: "" });
  assert.equal(state.scripts.length, 0);
  assert.equal(state.messages[0].type, "unavailable");
});

test("Android late bootstrap starts once and tokens are delivered only through the native bridge", () => {
  const state = page({ bootstrap: false });
  state.window.__LINEUPSYNC_VERIFY__ = { version: 1, requestId };
  state.window.LineupSyncStartVerification();
  state.window.LineupSyncStartVerification();
  assert.equal(state.scripts.length, 1);
  state.load();
  assert.equal(state.widgets[0]["response-field"], false);
  state.widgets[0].callback("a-private-test-token");
  assert.deepEqual(state.messages[0], { source: "lineupsync-verify", version: 1, requestId, type: "token", token: "a-private-test-token" });
  assert.ok(!state.elements.status.textContent.includes("a-private-test-token"));
  state.window.LineupSyncVerification.acknowledge("wrong-request");
  state.tick(1000);
  assert.equal(state.messages.length, 2);
  state.window.LineupSyncVerification.acknowledge(requestId);
  state.tick(290000);
  assert.equal(state.messages.at(-1).type, "expired");
  assert.equal(state.elements.retry.hidden, false);
});

test("errors and retries reject stale widget callbacks", () => {
  const state = page();
  state.load();
  const stale = state.widgets[0];
  stale["error-callback"]();
  stale.callback("stale-token");
  assert.equal(state.messages.filter((message) => message.type === "token").length, 0);
  state.elements.retry.click();
  state.widgets.at(-1).callback("fresh-token");
  assert.equal(state.messages.at(-1).token, "fresh-token");
});

test("lost delivery is bounded and page departure invalidates callbacks", () => {
  const state = page();
  state.load();
  state.widgets[0].callback("test-token");
  for (let attempt = 0; attempt < 4; attempt += 1) state.tick(1000);
  assert.equal(state.messages.at(-1).type, "error");
  assert.equal(state.elements.retry.hidden, false);
  state.events.pagehide();
  const before = state.messages.length;
  state.widgets[0].callback("late-token");
  assert.equal(state.messages.length, before);
});

test("script failure, timeout and provider expiry offer a fresh retry", () => {
  const failed = page();
  failed.scripts[0].onerror();
  assert.equal(failed.elements.retry.hidden, false);
  const timedOut = page();
  timedOut.tick(120000);
  assert.equal(timedOut.elements.retry.hidden, false);
  const expired = page();
  expired.load();
  expired.widgets[0]["expired-callback"]();
  assert.equal(expired.messages.at(-1).type, "expired");
});
