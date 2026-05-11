/**
 * Terra Theme Browser — Background Script
 *
 * Connects to the terratheme-browser native messaging host,
 * receives palette updates, applies browser chrome theming,
 * and broadcasts palette data to content scripts.
 */

const NATIVE_HOST = "terratheme_browser";
const STORAGE_KEY_PALETTES = "terratheme_palettes";
const STORAGE_KEY_DISABLED = "terratheme_disabled_origins";

let port = null;
let currentPalette = null;
let reconnectTimer = null;

// ── Native messaging connection ──────────────────────────────────

function connect() {
  if (port) {
    try { port.disconnect(); } catch (_) {}
    port = null;
  }

  try {
    port = browser.runtime.connectNative(NATIVE_HOST);
  } catch (e) {
    console.warn("terratheme: failed to connect native host:", e.message);
    scheduleReconnect();
    return;
  }

  port.onMessage.addListener(onHostMessage);
  port.onDisconnect.addListener(() => {
    const err = browser.runtime.lastError;
    if (err) {
      console.warn("terratheme: native host disconnected:", err.message);
    } else {
      console.log("terratheme: native host disconnected");
    }
    port = null;
    scheduleReconnect();
  });
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, 5000);
}

// ── Processing palette updates ───────────────────────────────────

function onHostMessage(msg) {
  if (!msg || msg.type !== "palette_update") return;

  const palette = {
    mode: msg.mode || "dark",
    light: msg.light || {},
    dark: msg.dark || {},
  };

  currentPalette = palette;

  // Persist in storage for content scripts
  browser.storage.session.set({ [STORAGE_KEY_PALETTES]: palette }).catch(() => {});

  // Apply browser chrome theme
  applyBrowserTheme(palette);
}

// ── Firefox browser chrome theming ───────────────────────────────

function applyBrowserTheme(palette) {
  const colors = palette.mode === "light" ? palette.light : palette.dark;
  const inverse = palette.mode === "light" ? palette.dark : palette.light;

  browser.theme.update({
    colors: {
      // Main chrome
      frame:                  colors.low || "#131520",
      toolbar:                colors.high || "#232639",
      toolbar_text:           colors.standard || "#e8e8e9",
      toolbar_top_separator:  colors.outline || "#595d73",
      toolbar_bottom_separator: colors.outline || "#595d73",

      // Tabs
      tab_background_text:     colors.muted || "#959597",
      tab_line:                colors.c4 || colors.standard || "#e8e8e9",
      tab_loading:             colors.c4 || colors.standard || "#e8e8e9",
      tab_selected:            colors.top || "#4e557e",

      // URL bar / toolbar fields
      toolbar_field:                  colors.low || "#131520",
      toolbar_field_text:             colors.standard || "#e8e8e9",
      toolbar_field_border:           colors.outline || "#595d73",
      toolbar_field_focus:            colors.high || "#363b58",
      toolbar_field_border_focus:     colors.c4 || colors.standard || "#e8e8e9",
      toolbar_field_highlight:        colors.c4 || "#93adec",
      toolbar_field_highlight_text:   colors.on_c4 || "#181c35",

      // Dropdowns / popups
      popup:                  colors.base || "#232639",
      popup_text:             colors.standard || "#e8e8e9",
      popup_border:           colors.outline || "#595d73",
      popup_highlight:        colors.high || "#363b58",
      popup_highlight_text:   colors.standard || "#e8e8e9",

      // Sidebar
      sidebar_border:                 colors.outline || "#595d73",
      sidebar_highlight:              colors.high || "#363b58",
      sidebar_highlight_text:         colors.standard || "#e8e8e9",

      // Buttons
      button_background_hover:  colors.high || "#363b58",
      button_background_active: colors.top || "#4e557e",

      // New tab page
      ntp_background: colors.bottom || "#08080d",
      ntp_text:       colors.standard || "#e8e8e9",
    },
  });
}

// ── Per-site disable management ──────────────────────────────────

async function isDisabledForOrigin(origin) {
  try {
    const result = await browser.storage.local.get(STORAGE_KEY_DISABLED);
    const list = result[STORAGE_KEY_DISABLED] || [];
    return list.includes(origin);
  } catch {
    return false;
  }
}

async function toggleDisabledForOrigin(origin) {
  const result = await browser.storage.local.get(STORAGE_KEY_DISABLED);
  const list = result[STORAGE_KEY_DISABLED] || [];

  if (list.includes(origin)) {
    await browser.storage.local.set({
      [STORAGE_KEY_DISABLED]: list.filter((o) => o !== origin),
    });
    return false; // now enabled
  } else {
    await browser.storage.local.set({
      [STORAGE_KEY_DISABLED]: [...list, origin],
    });
    return true; // now disabled
  }
}

async function getDisabledOrigins() {
  const result = await browser.storage.local.get(STORAGE_KEY_DISABLED);
  return result[STORAGE_KEY_DISABLED] || [];
}

// ── Messaging API for popup and content scripts ──────────────────

browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.action) {
    case "get_palette":
      sendResponse(currentPalette);
      break;

    case "is_disabled":
      isDisabledForOrigin(msg.origin).then(sendResponse);
      return true; // keep channel open for async response

    case "toggle_disabled":
      toggleDisabledForOrigin(msg.origin).then(sendResponse);
      return true;

    case "get_disabled_origins":
      getDisabledOrigins().then(sendResponse);
      return true;

    case "reconnect_native":
      connect();
      sendResponse({ ok: true });
      break;
  }
});

// ── Keepalive ────────────────────────────────────────────────────
// Prevent the background script from being terminated (Firefox MV3
// event pages can go to sleep). The alarm runs every 20s.

browser.alarms.create("keepalive", { periodInMinutes: 1 / 3 });
browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "keepalive") {
    // No-op to keep the event page alive
  }
});

// ── Startup ──────────────────────────────────────────────────────

connect();

// Also check if storage.session has existing palette from a previous
// background page (only relevant if the service worker restarts)
browser.storage.session.get(STORAGE_KEY_PALETTES).then((result) => {
  const stored = result[STORAGE_KEY_PALETTES];
  if (stored) {
    // If we don't have a fresh one yet, use the stored one
    if (!currentPalette) {
      currentPalette = stored;
      applyBrowserTheme(stored);
    }
  }
});
