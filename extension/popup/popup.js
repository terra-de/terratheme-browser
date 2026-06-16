/**
 * Terra Theme Browser — Popup Script
 *
 * Shows current palette status, light/dark mode, and per-site disable toggle.
 */

const BG = browser.runtime;
const STORAGE_REGISTRY_URL = "terratheme_registry_url";
const DEFAULT_REGISTRY_URL = "https://raw.githubusercontent.com/terra-de/terratheme-sites/main/registry.json";

async function init() {
  const app = document.getElementById("app");

  let origin = "";
  try {
    const tabs = await browser.tabs?.query({ active: true, currentWindow: true });
    if (tabs?.[0]?.url) {
      origin = new URL(tabs[0].url).origin;
    }
  } catch {}
  document.getElementById("site-domain").textContent = origin || "unknown";

  const [palette, isDisabled] = await Promise.all([
    BG.sendMessage({ action: "get_palette" }),
    origin ? BG.sendMessage({ action: "is_disabled", origin }) : Promise.resolve(false),
  ]);

  updateStatus(palette);
  updateModeBadge(palette);
  updateSwatches(palette);
  applyPopupPalette(palette);
  updateDisableToggle(isDisabled, origin);
  updateSiteStatus(origin);
  document.getElementById("site-issue-link").addEventListener("click", async (e) => {
    e.preventDefault();
    const url = e.currentTarget.href;
    if (url && url !== "#") {
      await browser.tabs.create({ url });
    }
  });
  checkPermissions();
  setupSiteConfigControls(origin);
  loadRegistryUrl();
}

function updateStatus(palette) {
  const dot = document.getElementById("status-indicator");
  const text = document.getElementById("status-text");

  if (!palette) {
    dot.className = "status-dot status-error";
    text.textContent = "No palette — is terratheme installed?";
    return;
  }

  dot.className = "status-dot status-loaded";
  const mode = palette.mode || "dark";
  text.textContent = `Loaded — ${mode} mode`;
}

function updateModeBadge(palette) {
  const badge = document.getElementById("mode-badge");
  if (!palette) {
    badge.textContent = "—";
    badge.className = "badge";
    return;
  }
  const mode = palette.mode || "dark";
  badge.textContent = mode;
  badge.className = `badge badge-${mode}`;
}

function updateSwatches(palette) {
  if (!palette) return;

  const colors = palette.mode === "light" ? palette.light : palette.dark;

  const bgSwatches = document.getElementById("bg-swatches");
  bgSwatches.innerHTML = ["bottom", "low", "base", "high", "top"]
    .map((key) => {
      const hex = colors[key] || "#000";
      return `<div class="swatch" style="background:${hex}" title="${key}: ${hex}">
        <span class="swatch-label">${key}</span>
      </div>`;
    })
    .join("");

  const accentSwatches = document.getElementById("accent-swatches");
  accentSwatches.innerHTML = ["c0", "c1", "c2", "c3", "c4", "error", "outline"]
    .map((key) => {
      const hex = colors[key] || "#000";
      return `<div class="swatch swatch-accent" style="background:${hex}" title="${key}: ${hex}">
        <span class="swatch-label">${key}</span>
      </div>`;
    })
    .join("");
}

function applyPopupPalette(palette) {
  if (!palette) return;
  const colors = palette.mode === "light" ? palette.light : palette.dark;
  const el = document.documentElement;
  const map = {
    "--popup-bg": colors.bottom,
    "--popup-surface": colors.low,
    "--popup-surface-h": colors.high,
    "--popup-text": colors.standard,
    "--popup-muted": colors.muted,
    "--popup-accent": colors.c4,
    "--popup-error": colors.error,
    "--popup-border": colors.outline,
  };
  for (const [key, val] of Object.entries(map)) {
    if (val) el.style.setProperty(key, val);
  }
}

function updateDisableToggle(isDisabled, origin) {
  const toggle = document.getElementById("disable-toggle");

  if (isDisabled) {
    toggle.checked = true;
  }

  toggle.addEventListener("change", async () => {
    const nowDisabled = await BG.sendMessage({
      action: "toggle_disabled",
      origin,
    });

    if (nowDisabled) {
      browser.tabs.reload();
    } else {
      browser.tabs.reload();
    }
  });
}

function updateSiteStatus(origin) {
  const icon = document.getElementById("site-status-icon");
  const text = document.getElementById("site-status-text");
  const link = document.getElementById("site-issue-link");

  BG.sendMessage({ action: "get_site_status", origin }).then((status) => {
    if (!status) {
      icon.className = "status-dot status-idle";
      text.textContent = "Checking…";
      return;
    }

    const name = status.siteName || origin;

    switch (status.status) {
      case "supported":
        icon.className = "status-dot status-loaded";
        text.textContent = `${name} — themed`;
        link.classList.add("hidden");
        break;
      case "unsupported":
        icon.className = "status-dot status-idle";
        text.textContent = "Not yet supported";
        link.textContent = "Open Issue →";
        link.href = `https://github.com/terra-de/terratheme-sites/issues/new?title=${encodeURIComponent("Support for " + origin)}&labels=site-request`;
        link.classList.remove("hidden");
        break;
      case "fetching":
        icon.className = "status-dot status-connecting";
        text.textContent = "Loading site configs…";
        link.classList.add("hidden");
        break;
      case "fetch_error":
        icon.className = "status-dot status-error";
        text.textContent = "Failed to load site config";
        link.classList.add("hidden");
        break;
      case "disabled":
        icon.className = "status-dot status-idle";
        text.textContent = "Disabled on this site";
        link.classList.add("hidden");
        break;
      case "no_palette":
        icon.className = "status-dot status-idle";
        text.textContent = "Waiting for palette…";
        link.classList.add("hidden");
        break;
      default:
        icon.className = "status-dot status-idle";
        text.textContent = "Unknown";
        link.classList.add("hidden");
    }
  });
}

function setupSiteConfigControls(origin) {
  const refreshBtn = document.getElementById("refresh-configs");
  refreshBtn.addEventListener("click", async () => {
    refreshBtn.disabled = true;
    refreshBtn.textContent = "Refreshing…";

    await browser.storage.local.remove(["terratheme_registry", "terratheme_site_configs"]);

    try {
      const tabs = await browser.tabs.query({});
      for (const tab of tabs) {
        try {
          await browser.tabs.sendMessage(tab.id, { action: "refresh_configs" });
        } catch {}
      }
    } catch {}

    browser.tabs.reload();
    refreshBtn.textContent = "Refreshed!";
  });
}

function loadRegistryUrl() {
  const input = document.getElementById("registry-url");
  const status = document.getElementById("registry-status");

  browser.storage.local.get(STORAGE_REGISTRY_URL).then((r) => {
    input.value = r[STORAGE_REGISTRY_URL] || DEFAULT_REGISTRY_URL;
  });

  document.getElementById("save-url").addEventListener("click", async () => {
    const url = input.value.trim();
    if (!url) {
      status.textContent = "Please enter a URL";
      status.className = "registry-status error";
      return;
    }
    await browser.storage.local.set({ [STORAGE_REGISTRY_URL]: url });
    await browser.storage.local.remove(["terratheme_registry", "terratheme_site_configs"]);
    status.textContent = "Saved. Refresh will use new URL.";
    status.className = "registry-status ok";
  });

  document.getElementById("reset-url").addEventListener("click", async () => {
    await browser.storage.local.remove(STORAGE_REGISTRY_URL);
    input.value = DEFAULT_REGISTRY_URL;
    await browser.storage.local.remove(["terratheme_registry", "terratheme_site_configs"]);
    status.textContent = "Reset to default. Refresh will re-fetch.";
    status.className = "registry-status ok";
  });
}

async function checkPermissions() {
  const warning = document.getElementById("perm-warning");
  if (!warning) return;

  try {
    const granted = await browser.permissions.contains({ origins: ["*://*/*"] });
    warning.classList.toggle("hidden", granted);
  } catch {
    warning.classList.add("hidden");
  }

  document.getElementById("grant-perm")?.addEventListener("click", async () => {
    try {
      const granted = await browser.permissions.request({ origins: ["*://*/*"] });
      warning.classList.toggle("hidden", granted);
    } catch {}
  });
}

document.addEventListener("DOMContentLoaded", init);
