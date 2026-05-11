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
let siteConfigCache = new Map(); // url → config promise

// ── Bootstrap ───────────────────────────────────────────────────────

async function init() {
  [disabled, palette] = await Promise.all([
    loadDisabled(),
    loadPalette(),
  ]);

  if (palette) {
    applyBaseStyles(palette);
    maybeApplySiteStyles(palette);
  }

  // Listen for palette updates from background
  browser.storage.onChanged.addListener((changes, area) => {
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
  });

  // SPA navigation watcher
  let last = location.href;
  setInterval(() => {
    if (location.href !== last) {
      last = location.href;
      siteConfig = null; // force re-resolve
      (palette) && maybeApplySiteStyles(palette);
    }
  }, 300);
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

async function maybeApplySiteStyles(p) {
  if (isDisabled()) { removeSiteStyles(); return; }

  const cfg = await resolveSiteConfig();
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

const SITE_CANDIDATES = [
  { path: "sites/github.json",     match: ["*://github.com/*"] },
  { path: "sites/reddit.json",     match: ["*://www.reddit.com/*"] },
  { path: "sites/youtube.json",    match: ["*://www.youtube.com/*", "*://youtube.com/*"] },
  { path: "sites/chatgpt.json",    match: ["*://chatgpt.com/*"] },
  { path: "sites/monkeytype.json", match: ["*://monkeytype.com/*"] },
];

function pickCandidate(url) {
  for (const c of SITE_CANDIDATES) {
    if (c.match.some((p) => urlMatches(url, p))) return c;
  }
  return null;
}

function urlMatches(url, pattern) {
  const re = new RegExp("^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$");
  return re.test(url);
}

async function resolveSiteConfig() {
  const candidate = pickCandidate(location.href);
  if (!candidate) return null;

  // Return cached if already fetched for this URL
  // (candidate.path is enough since it's the identity)

  if (!siteConfigCache.has(candidate.path)) {
    siteConfigCache.set(
      candidate.path,
      fetchSiteConfig(candidate.path)
    );
  }

  try {
    return await siteConfigCache.get(candidate.path);
  } catch {
    siteConfigCache.delete(candidate.path);
    return null;
  }
}

async function fetchSiteConfig(path) {
  const url = browser.runtime.getURL(path);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${path}: ${res.status}`);
  return res.json();
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
