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
│   ├── content-script.js   # --tt-* injection + per-site CSS
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.js
│   │   └── popup.css
│   ├── sites/
│   │   ├── github.json
│   │   ├── reddit.json
│   │   ├── youtube.json
│   │   ├── chatgpt.json
│   │   └── monkeytype.json
│   └── icons/
│       ├── icon-48.svg
│       ├── icon-96.svg
│       └── icon-128.svg
├── host/                   # Native messaging host
│   ├── terrathe-browser.json  # Native messaging manifest
│   └── terrathe-browser.py    # Python bridge (poll palette.json ~2s)
├── AGENTS.md
├── LICENSE
└── .gitignore
```

## Architecture

```
palette.json (written by terratheme)
    │
    ▼ (polls every 2s)
host/terrathe-browser.py (Python native messaging host)
    │
    ▼ (stdin/stdout, 4-byte length prefix + JSON)
extension/background.js
    ├── browser.theme.update() → Firefox chrome
    └── browser.storage.session.set() → content scripts read it
                                        │
                                        ▼
                                   content-script.js
                                    ├── Injects :root { --tt-*: ... }
                                    └── Fetches sites/*.json from extension
                                        └── Applies per-site CSS var overrides
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

### Installing the native messaging host

The host is packaged as `terratheme-browser-git` in the terra-packages repo:

```bash
cd ~/dev/terra-de/terra-packages/terratheme-browser-git
makepkg -si
```

This installs:
- `/usr/share/terrathe-browser/terrathe-browser.py` — the Python bridge
- `/usr/lib/mozilla/native-messaging-hosts/terrathe-browser.json` — Firefox native messaging manifest

### Testing without the native host

Start the host manually:
```bash
python3 host/terrathe-browser.py
```

The extension will auto-connect when loaded in Firefox.

## Site Config Format

Each site config is a JSON file in `extension/sites/` with:

```json
{
  "version": 2,
  "match": ["*://github.com/*"],
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
by the content script.

## Adding a new site

1. Analyze the site's CSS variables (use DevTools to inspect computed styles on `<html>`)
2. Create a new `extension/sites/sitename.json` with appropriate match patterns and rules
3. Add the candidate entry to `SITE_CANDIDATES` in `content-script.js`
4. Add the host permission match pattern to `manifest.json`

## Release Process

Same as other terra-de components:
1. Commit and tag
2. Download tarball from GitHub
3. Add/release PKGBUILD in terra-packages

## Dependencies

- Python 3 (native messaging host)
- Firefox 109+ (extension)
- Chromium (future support — no browser.theme API)
