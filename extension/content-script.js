/**
 * Terra Theme Browser — Content Script
 *
 * Reads palette data from storage.session, injects --tt-* CSS variables
 * into every page, fetches site configs from the terratheme-sites remote
 * registry, and applies per-site CSS variable overrides.
 * Reports site status to the background script for popup display.
 */

const STYLE_VARS = "tt-vars";
const STYLE_SITE = "tt-site-rules";
const STORAGE_PALETTES = "terratheme_palettes";
const STORAGE_DISABLED = "terratheme_disabled_origins";

let palette = null;
let siteConfig = null;
let disabled = [];
let appliedSiteProps = [];
let styleChangeTimer = null;

// ── Retry helper ────────────────────────────────────────────────────
// Background may not have currentPalette yet (native host still starting).
// This keeps asking until the background has one.

const RETRY_INTERVAL = 500;  // ms between retries
const MAX_RETRIES = 10;      // up to 5 seconds total

async function getPaletteFromBackground() {
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const p = await browser.runtime.sendMessage({ action: "get_palette" });
      if (p) return p;
    } catch {
      // Background might not be ready yet
    }
    await new Promise(r => setTimeout(r, RETRY_INTERVAL));
  }
  return null;
}

// ── Bootstrap ───────────────────────────────────────────────────────

async function init() {
  // 1. Register listener FIRST — catches any updates that arrive before/during/after init
  browser.storage.onChanged.addListener(onStorageChanged);

  // 2. Load disabled list from local storage
  disabled = await loadDisabled();

  // 3. Try to get palette (from storage.local, then retry via sendMessage)
  palette = await loadPalette();

  // 4. If still null, retry until background has it (native host may still be starting)
  if (!palette) {
    palette = await getPaletteFromBackground();
  }

  // 5. Apply whatever we got
  if (palette) {
    applyBaseStyles(palette);
    await maybeApplySiteStyles(palette);
  }

  // 6. Watch for dynamic style changes (e.g., DDG overriding with JS)
  startStyleObserver();

  // 7. Delayed re-apply to catch post-load theme JS (e.g., DDG, YouTube)
  setTimeout(() => {
    if (palette && siteConfig) {
      applySiteStyles(siteConfig);
    }
  }, 1000);

  // 8. SPA navigation watcher
  let last = location.href;
  setInterval(() => {
    if (location.href !== last) {
      last = location.href;
      siteConfig = null;
      if (palette) maybeApplySiteStyles(palette);
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
  // Try storage.local first (persistent, accessible from content scripts)
  try {
    const r = await browser.storage.local.get(STORAGE_PALETTES);
    if (r[STORAGE_PALETTES]) return r[STORAGE_PALETTES];
  } catch {}
  // Fall back to storage.session (only available from background)
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
  if (msg.action === "refresh_configs") {
    refreshSiteConfigs();
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

// ── Fetch proxy (via background, bypasses page CSP) ─────────────────

async function fetchViaBackground(url) {
  const resp = await browser.runtime.sendMessage({ action: "fetch_url", url });
  if (!resp.ok) throw new Error(resp.error || "Unknown fetch error");
  return resp.data;
}

// ── Site config fetching ────────────────────────────────────────────

const DEFAULT_REGISTRY_URL = "https://raw.githubusercontent.com/terra-de/terratheme-sites/main/registry.json";
const STORAGE_REGISTRY = "terratheme_registry";
const STORAGE_SITE_CONFIGS = "terratheme_site_configs";
const STORAGE_REGISTRY_URL = "terratheme_registry_url";
const REGISTRY_TTL = 24 * 60 * 60 * 1000;

let cachedRegistry = null;

async function getRegistryUrl() {
  try {
    const r = await browser.storage.local.get(STORAGE_REGISTRY_URL);
    return r[STORAGE_REGISTRY_URL] || DEFAULT_REGISTRY_URL;
  } catch {
    return DEFAULT_REGISTRY_URL;
  }
}

async function getBaseUrl() {
  const url = await getRegistryUrl();
  return url.replace(/\/registry\.json$/, "");
}

async function fetchRegistry() {
  const url = await getRegistryUrl();
  const text = await fetchViaBackground(url);
  return JSON.parse(text);
}

async function getRegistry() {
  if (cachedRegistry) return cachedRegistry;
  try {
    const r = await browser.storage.local.get(STORAGE_REGISTRY);
    const stored = r[STORAGE_REGISTRY];
    if (stored) {
      const age = Date.now() - (stored.fetched_at || 0);
      if (age < REGISTRY_TTL) {
        cachedRegistry = stored.data;
        return cachedRegistry;
      }
    }
  } catch {}
  const registry = await fetchRegistry();
  cachedRegistry = registry;
  browser.storage.local.set({
    [STORAGE_REGISTRY]: { data: registry, fetched_at: Date.now() }
  }).catch(() => {});
  return registry;
}

async function fetchSiteConfig(path) {
  const base = await getBaseUrl();
  const url = `${base}/${path}`;
  const text = await fetchViaBackground(url);
  return JSON.parse(text);
}

async function getSiteConfig(id, path) {
  try {
    const r = await browser.storage.local.get(STORAGE_SITE_CONFIGS);
    const configs = r[STORAGE_SITE_CONFIGS] || {};
    if (configs[id]) return configs[id];
  } catch {}
  const config = await fetchSiteConfig(path);
  try {
    const r = await browser.storage.local.get(STORAGE_SITE_CONFIGS);
    const configs = r[STORAGE_SITE_CONFIGS] || {};
    configs[id] = config;
    await browser.storage.local.set({ [STORAGE_SITE_CONFIGS]: configs });
  } catch {}
  return config;
}

async function refreshSiteConfigs() {
  cachedRegistry = null;
  await browser.storage.local.remove([STORAGE_REGISTRY, STORAGE_SITE_CONFIGS]);
  if (palette) {
    await maybeApplySiteStyles(palette);
  }
}

// ── Site status reporting ──────────────────────────────────────────

function reportStatus(status, extra) {
  const data = {
    action: "site_status_update",
    origin: location.origin,
    status,
    siteName: extra?.siteName || "",
    siteId: extra?.siteId || "",
    error: extra?.error || "",
    timestamp: Date.now(),
  };
  browser.runtime.sendMessage(data).catch(() => {});
}

// ── Site-specific style injection ───────────────────────────────────

async function maybeApplySiteStyles(p) {
  if (isDisabled()) { removeSiteStyles(); reportStatus("disabled"); return; }

  reportStatus("fetching");
  try {
    const result = await resolveSiteConfig();
    if (!result) {
      removeSiteStyles();
      reportStatus("unsupported");
      return;
    }
    siteConfig = result.config;
    applySiteStyles(result.config);
    reportStatus("supported", { siteName: result.siteName, siteId: result.siteId });
  } catch (e) {
    removeSiteStyles();
    reportStatus("fetch_error", { error: e.message || String(e) });
  }
}

function applySiteStyles(cfg) {
  const seen = [];
  for (const rule of cfg.rules) {
    const props = rule.set || {};
    const imp = !!rule.important;
    for (const [prop, val] of Object.entries(props)) {
      if (val != null) {
        const priority = imp ? "important" : undefined;
        document.documentElement.style.setProperty(prop, val, priority);
        seen.push(prop);
      }
    }
  }
  appliedSiteProps = seen;
}

function removeSiteStyles() {
  for (const prop of appliedSiteProps) {
    if (document.documentElement) {
      document.documentElement.style.removeProperty(prop);
    }
  }
  appliedSiteProps = [];
}

function onRootStyleChanged() {
  if (styleChangeTimer) clearTimeout(styleChangeTimer);
  styleChangeTimer = setTimeout(() => {
    styleChangeTimer = null;
    if (palette && siteConfig) {
      applySiteStyles(siteConfig);
    }
  }, 100);
}

function startStyleObserver() {
  const observer = new MutationObserver(() => onRootStyleChanged());
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
}

// ── Site config resolution ──────────────────────────────────────────

function urlMatches(url, pattern) {
  const re = new RegExp("^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$");
  return re.test(url);
}

async function resolveSiteConfig() {
  const registry = await getRegistry();
  const entry = registry.sites.find(s =>
    s.matches.some(p => urlMatches(location.href, p))
  );
  if (!entry) return null;
  const config = await getSiteConfig(entry.id, entry.path);
  return { config, siteName: entry.name, siteId: entry.id };
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
