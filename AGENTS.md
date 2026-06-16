# AGENTS.md - terratheme-browser

## What is this?

A browser extension (Firefox first, Chromium eventually) that replaces
the old materialized-web + pywalfox setup. It reads `~/.config/terra/palette.json`
via a native messaging host and:

1. Themes the browser chrome (toolbar, tabs, URL bar, popups)
2. Injects `--tt-*` CSS custom properties on web pages
3. Applies per-site CSS mappings (GitHub, Reddit, YouTube, ChatGPT, Monkeytype)
4. Provides a popup with per-site disable toggle
5. Follows light/dark mode from palette.json

## Repo Structure

```
terratheme-browser/
├── extension/              # Firefox extension (Manifest V3)
│   ├── manifest.json       # Extension manifest
│   ├── background.js       # Native messaging + browser.theme.update()
│   │                      #   + siteStatuses in-memory map (popup reads via messaging)
│   ├── content-script.js   # --tt-* injection + per-site CSS + status reporting
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.js
│   │   └── popup.css
│   └── icons/
│       ├── icon-48.svg
│       ├── icon-96.svg
│       └── icon-128.svg
├── host/                   # Native messaging host
│   ├── terratheme_browser.json  # Native messaging manifest
│   └── terratheme-browser.py    # Python bridge (poll palette.json ~2s)
├── AGENTS.md
├── LICENSE
└── .gitignore
```

## Architecture

```
palette.json (written by terratheme)
    │
    ▼ (polls every 2s)
host/terratheme-browser.py (Python native messaging host)
    │
    ▼ (stdin/stdout, 4-byte length prefix + JSON)
extension/background.js
    ├── siteStatuses map  ◄──── content scripts report status via sendMessage
    ├── browser.theme.update() → Firefox chrome
    └── browser.storage.session.set() → content scripts read it
                                        │
                                        ▼
                                   content-script.js
                                    ├── Injects :root { --tt-*: ... }
                                    ├── Fetches registry from github.com/terra-de/terratheme-sites
                                    ├── Applies per-site CSS var overrides
                                    └── Reports site status → background → popup
                                        │
                                        ▼
                                   background.js siteStatuses
                                        │
                                        ▼
                                   popup.js reads via sendMessage
                                    ├── Shows site status (supported/unsupported/fetching/error)
                                    └── "Open Issue" link for unsupported sites
```

## Terra DE Token → CSS Variable Mapping

| Token | CSS Variable | Purpose |
|-------|-------------|---------|
| bottom | --tt-bottom | Deepest background layer |
| low | --tt-low | Low-elevation background |
| base | --tt-base | Main surface background |
| high | --tt-high | Elevated surface (menus, tooltips) |
| top | --tt-top | Foremost surface (modals, OSD) |
| standard | --tt-standard | Primary text/icon |
| muted | --tt-muted | Secondary text/icon |
| c0-c4 | --tt-c0..--tt-c4 | Accent colors |
| on_c0-on_c4 | --tt-on-c0..--tt-on-c4 | Text on accent colors |
| error | --tt-error | Error color |
| on_error | --tt-on-error | Text on error |
| outline | --tt-outline | Borders/outlines |

**Derived tokens** (computed by content script):
- `--tt-outline-variant` — outline at 55% opacity
- `--tt-scrim` — bottom blended with alpha for overlays
- `--tt-inverse-base` — opposite mode's base (for inverse surfaces)
- `--tt-inverse-standard` — opposite mode's standard

## Developing

### Loading the extension in Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on"
3. Select `extension/manifest.json`

The native messaging host must be installed for the extension to function.
See PKGBUILD below.

The host is packaged as `terratheme-browser-git` in the terra-packages repo:

```bash
cd ~/dev/terra-de/terra-packages/terratheme-browser-git
makepkg -si
```

This installs:
- `/usr/share/terratheme-browser/terratheme-browser.py` — the Python bridge
- `/usr/lib/mozilla/native-messaging-hosts/terratheme_browser.json` — Firefox native messaging manifest

### Testing without the native host

Start the host manually:
```bash
python3 host/terratheme-browser.py
```

The extension will auto-connect when loaded in Firefox.

## Site Config Format

Site configs are stored in the `terra-de/terratheme-sites` GitHub repo.
Each site has a JSON config with:

```json
{
  "version": 2,
  "rules": [
    {
      "selector": ":root",
      "important": true,
      "set": {
        "--site-css-var": "var(--tt-token-name)",
        "--another-var": "color-mix(in srgb, var(--tt-c4) 50%, transparent)"
      }
    }
  ]
}
```

Rules reference `--tt-*` CSS variables which are already defined on `:root`
by the content script. The registry (`registry.json`) maps hostname patterns
to config paths:

```json
{
  "version": 1,
  "updated": "2026-06-09T00:00:00Z",
  "sites": [
    { "id": "github", "name": "GitHub", "matches": ["*://github.com/*"], "path": "sites/github.json" }
  ]
}
```

## Site Status Reporting

After resolving site configs, the content script reports status to the
background's `siteStatuses` in-memory map via `runtime.sendMessage`.
The popup reads this map to display per-site status.

### Status States

| Status | Meaning | Popup Display |
|--------|---------|---------------|
| `supported` | Registry entry found, config fetched and applied | `"GitHub — themed"` (green) |
| `unsupported` | Site not in registry | `"Not yet supported"` (gray) + "Open Issue →" link |
| `fetching` | Registry or config currently downloading | `"Loading site configs…"` (yellow) |
| `fetch_error` | Fetch or parse failed (network, 404, bad JSON) | `"Failed to load site config"` (red) |
| `disabled` | User toggled "Disable on this site" | `"Disabled on this site"` (gray) |
| `no_palette` | No palette loaded yet, site configs not attempted | `"Waiting for palette…"` (gray) |

### "Open Issue" Flow

For unsupported sites, the popup shows a link that opens:

```
https://github.com/terra-de/terratheme-sites/issues/new
  ?title=Support+for+<origin>
  &labels=site-request
```

This opens in a new tab via `browser.tabs.create()`.

### Adding a new site

1. Analyze the site's CSS variables (use DevTools to inspect computed styles on `<html>`)
2. Add a config JSON to `github.com/terra-de/terratheme-sites` (the `sites/` dir)
3. Add a registry entry in `registry.json`
4. That's it — no extension changes needed (configs are fetched remotely)

## Release Process

Same as other terra-de components:
1. Commit and tag
2. Download tarball from GitHub
3. Add/release PKGBUILD in terra-packages

## Dependencies

- Python 3 (native messaging host)
- Firefox 109+ (extension)
- Chromium (future support — no browser.theme API)
