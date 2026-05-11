/**
 * Terra Theme Browser — Popup Script
 *
 * Shows current palette status, light/dark mode, and per-site disable toggle.
 */

const BG = browser.runtime;

async function init() {
  const app = document.getElementById("app");

  // Get current tab origin
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  const origin = new URL(tab.url).origin;
  document.getElementById("site-domain").textContent = origin;

  // Get palette and disable state from background
  const [palette, isDisabled] = await Promise.all([
    BG.sendMessage({ action: "get_palette" }),
    BG.sendMessage({ action: "is_disabled", origin }),
  ]);

  // Update status
  updateStatus(palette);
  updateModeBadge(palette);
  updateSwatches(palette);
  updateDisableToggle(isDisabled, origin);
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
      // Theme is now disabled for this site — reload to remove styles
      browser.tabs.reload();
    } else {
      // Theme is now enabled — reload to apply
      browser.tabs.reload();
    }
  });
}

document.addEventListener("DOMContentLoaded", init);
