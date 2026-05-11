# Terra Theme Browser

A Firefox extension that automatically themes your browser chrome and supported websites using your [terratheme](https://github.com/terra-de/terratheme) palette colors. Replaces the old materialized-web + pywalfox setup.

## How it works

1. **Native messaging host** (`terratheme-browser.py`) watches `~/.config/terra/palette.json` for changes
2. When the palette updates, it pushes the new colors to the extension
3. The extension applies `--tt-*` CSS variables to every page and maps them to each site's native CSS variables

Everything updates live — no page refresh needed.

## Prerequisites

- Firefox 112+
- [terratheme](https://github.com/terra-de/terratheme) generating `~/.config/terra/palette.json`
- Python 3 (for the native messaging host)

## Install

### Option 1: Arch Linux (PKGBUILD)

```bash
cd ~/dev/terra-de/terra-packages/terratheme-browser-git
makepkg -si
```

The PKGBUILD installs the native messaging host to the system. Then install the signed `.xpi` in Firefox (see below).

### Option 2: Manual native host install

```bash
sudo cp host/terratheme-browser.py /usr/share/terratheme-browser/
sudo cp host/terratheme_browser.json /usr/lib/mozilla/native-messaging-hosts/
```

### Installing the signed extension

1. Download the `.xpi` from the [latest release](https://github.com/terra-de/terratheme-browser/releases)
2. Open Firefox → drag the `.xpi` into the window
3. Click "Add" when prompted

### Temporary install (for development)

1. Open `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on"
3. Select `extension/manifest.json`

## Usage

Once installed and the native host is running, the extension works automatically:

- **Browser chrome** — toolbar, tabs, URL bar, popups, and sidebar use your Terra DE palette
- **Websites** — supported sites are themed to match
- **Light/dark mode** — follows `palette.json` mode automatically

Click the toolbar icon to open the popup:

- See current palette status and mode (light/dark)
- View color swatches for all tokens
- Toggle site theming on/off per-site (reloads the tab)

## Supported sites

| Site | What's themed |
|------|---------------|
| GitHub | Surfaces, text, borders, buttons, controls, accent colors |
| ChatGPT | Surfaces, sidebar, text, borders, submit button, user messages, popovers |
| Reddit | Main canvas, surfaces, text, borders, inputs, interactive states |
| YouTube | Base background, text, outlines, buttons, search box, overlays |
| Monkeytype | Background, text, keys, caret, sub/error colors |

## Updating

### Extension

The `.xpi` is a one-time install. To update, download the new `.xpi` from the latest release and drag it into Firefox to replace the old one.

### Native host

```bash
cd ~/dev/terra-de/terra-packages/terratheme-browser-git
git pull
makepkg -si
```

## Development

### Project structure

```
terratheme-browser/
├── extension/               # Firefox extension (Manifest V3)
│   ├── manifest.json
│   ├── background.js        # Native messaging + browser.theme.update()
│   ├── content-script.js    # --tt-* injection + per-site CSS
│   ├── sites/
│   │   ├── sites.js         # Bundled site configs
│   │   └── *.json           # Per-site source files
│   ├── popup/
│   └── icons/
├── host/
│   ├── terratheme_browser.json  # Native messaging manifest
│   └── terratheme-browser.py    # Python bridge
└── .github/workflows/
    └── sign-release.yml     # Auto-sign + release on version bump
```

### Adding a new site

1. Inspect the site's CSS variables (DevTools → Computed on `<html>`)
2. Add rules to `extension/sites/sites.js` and `extension/sites/<site>.json`
3. Add the host match pattern to `manifest.json`
4. Submit a PR

### Version bump & release

1. Bump `version` in `extension/manifest.json`
2. Commit and push to `main`
3. CI signs via AMO and creates a GitHub Release with the `.xpi`

## License

MIT — see [LICENSE](LICENSE)
