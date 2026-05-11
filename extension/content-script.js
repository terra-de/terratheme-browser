/**
 * Terra Theme Browser — Content Script
 *
 * Reads palette data from storage.session, injects --tt-* CSS variables
 * into every page, and applies site-specific CSS variable mappings
 * by fetching bundled site config JSON files.
 */

const STYLE_VARS = "tt-vars";
const STYLE_SITE = "tt-site-rules";
const STORAGE_PALETTES = "terratheme_palettes";
const STORAGE_DISABLED = "terratheme_disabled_origins";

let palette = null;
let siteConfig = null;
let disabled = [];

// ── Bootstrap ───────────────────────────────────────────────────────

async function init() {
  // 1. Register listener FIRST — catches any updates that arrive before/during/after init
  browser.storage.onChanged.addListener(onStorageChanged);

  // 2. Load disabled list from local storage
  disabled = await loadDisabled();

  // 3. Try to get palette from storage.session first (cached from previous page)
  palette = await loadPalette();

  // 4. If still null, ask background.js directly (most reliable — skips storage race)
  if (!palette) {
    try {
      palette = await browser.runtime.sendMessage({ action: "get_palette" });
    } catch {
      // Background might not be ready yet
    }
  }

  // 5. Apply whatever we got
  if (palette) {
    applyBaseStyles(palette);
    maybeApplySiteStyles(palette);
  }

  // 6. SPA navigation watcher
  let last = location.href;
  setInterval(() => {
    if (location.href !== last) {
      last = location.href;
      siteConfig = null; // force re-resolve
      (palette) && maybeApplySiteStyles(palette);
    }
  }, 300);
}

function onStorageChanged(changes, area) {
  if (area === "session" && changes[STORAGE_PALETTES]) {
    palette = changes[STORAGE_PALETTES].newValue;
    if (palette) {
      applyBaseStyles(palette);
      maybeApplySiteStyles(palette);
    }
  }
  if (area === "local" && changes[STORAGE_DISABLED]) {
    disabled = changes[STORAGE_DISABLED].newValue || [];
    (palette) && maybeApplySiteStyles(palette);
  }
}

// ── Storage ─────────────────────────────────────────────────────────

async function loadPalette() {
  try {
    const r = await browser.storage.session.get(STORAGE_PALETTES);
    return r[STORAGE_PALETTES] || null;
  } catch { return null; }
}

async function loadDisabled() {
  try {
    const r = await browser.storage.local.get(STORAGE_DISABLED);
    return r[STORAGE_DISABLED] || [];
  } catch { return []; }
}

function isDisabled() {
  return disabled.includes(location.origin);
}

// ── Live palette update listener ────────────────────────────────────

browser.runtime.onMessage.addListener((msg) => {
  if (msg.action === "palette_updated") {
    palette = msg.palette;
    applyBaseStyles(palette);
    maybeApplySiteStyles(palette);
  }
});

// ── Base style injection ────────────────────────────────────────────

function applyBaseStyles(p) {
  const c = p.mode === "light" ? p.light : p.dark;
  const inv = p.mode === "light" ? p.dark : p.light;

  const vars = {
    "--tt-bottom":          c.bottom,
    "--tt-low":             c.low,
    "--tt-base":            c.base,
    "--tt-high":            c.high,
    "--tt-top":             c.top,
    "--tt-standard":        c.standard,
    "--tt-muted":           c.muted,
    "--tt-c0":              c.c0,
    "--tt-on-c0":           c.on_c0,
    "--tt-c1":              c.c1,
    "--tt-on-c1":           c.on_c1,
    "--tt-c2":              c.c2,
    "--tt-on-c2":           c.on_c2,
    "--tt-c3":              c.c3,
    "--tt-on-c3":           c.on_c3,
    "--tt-c4":              c.c4,
    "--tt-on-c4":           c.on_c4,
    "--tt-error":           c.error,
    "--tt-on-error":        c.on_error,
    "--tt-outline":         c.outline,
    // Derived tokens (not in palette.json)
    "--tt-outline-variant": colorMixAlpha(c.outline, 0.55),
    "--tt-scrim":           colorMixAlpha(c.bottom, 0.65),
    "--tt-inverse-base":    inv.base,
    "--tt-inverse-standard": inv.standard,
  };

  const css = ":root {\n" +
    Object.entries(vars)
      .filter(([, v]) => v)
      .map(([k, v]) => `  ${k}: ${v};`)
      .join("\n") +
    "\n}\n";

  upsertStyle(STYLE_VARS, css);
}

function colorMixAlpha(hex, alpha) {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ── Site-specific style injection ───────────────────────────────────

function maybeApplySiteStyles(p) {
  if (isDisabled()) { removeSiteStyles(); return; }

  const cfg = resolveSiteConfig();
  if (!cfg) { removeSiteStyles(); return; }

  siteConfig = cfg;
  applySiteStyles(cfg);
}

function applySiteStyles(cfg) {
  const blocks = [];
  for (const rule of cfg.rules) {
    const sel = rule.selector;
    const props = rule.set || {};
    const imp = !!rule.important;
    const lines = [`${sel} {`];
    for (const [prop, val] of Object.entries(props)) {
      if (val != null) lines.push(`  ${prop}: ${val}${imp ? " !important" : ""};`);
    }
    lines.push("}");
    blocks.push(lines.join("\n"));
  }
  upsertStyle(STYLE_SITE, blocks.join("\n\n"));
}

function removeSiteStyles() {
  const el = document.getElementById(STYLE_SITE);
  if (el) el.remove();
}

// ── Site config resolution ──────────────────────────────────────────

function urlMatches(url, pattern) {
  const re = new RegExp("^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$");
  return re.test(url);
}

function resolveSiteConfig() {
  for (const cfg of TERRA_SITE_CONFIGS) {
    if (cfg.match.some((p) => urlMatches(location.href, p))) return cfg;
  }
  return null;
}

// ── DOM helpers ─────────────────────────────────────────────────────

function upsertStyle(id, css) {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement("style");
    el.id = id;
    const target = document.head || document.documentElement;
    if (target) { target.appendChild(el); }
    else {
      const obs = new MutationObserver(() => {
        const t = document.head || document.documentElement;
        if (t) { t.appendChild(el); obs.disconnect(); }
      });
      obs.observe(document, { childList: true, subtree: true });
      return;
    }
  }
  el.textContent = css;
}

// ── Start ───────────────────────────────────────────────────────────

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
