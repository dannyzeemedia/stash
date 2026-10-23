# Stash

A local bookmark board. **http://localhost:8800** — it starts with the machine and nothing leaves it.

## Using it

- **Drag anything.** A link to another category, a link up or down inside one, a category header to reorder the board, a link onto a quick-link tile to pin it. Every drop saves immediately.
- **A trash bin appears while you drag.** Drop a link on it to delete it. Drop a whole category on it and the card goes too, with everything inside — restoring brings it back whole, in the position it was in. Everything sits in the Trash for 30 days and then clears itself.
- **Collapse a category** with the chevron in its header, or all of them at once from the sidebar.
- **Quick links** is the 3×4 pad on the left. Click a tile to open it, drag tiles to rearrange them, and hover one for its name and a red **×**. Right-click a tile to edit its name, address or icon. Drag any link from the board onto a slot to pin it, or use the pin button in the Inbox — pinning from the Inbox files it, and unpinning puts it back.
- **Click the cog** on a category to rename it or change its logo. **Click the ⋮** on a link to edit or delete it.
- **Filter links…** or press `/` to narrow the board as you type.
- **Every new tab is Stash.** The extension overrides the new tab page; if the server happens to be down it says so and offers a retry instead of a browser error.
- **Save to Stash** is a browser extension — its icon sits with your other extensions, or press **Ctrl+Shift+S**. The page lands in the Inbox; the icon flashes a tick, `dup` if it is already filed, or `!` if Stash isn't running.
- **A click opens in this tab**, like any link. Ctrl-click, middle-click or shift-click opens a new one, and every right-click menu has "Open in a new tab".
- **Inbox** holds captured pages. Click **File into…** beside one and type to find a category — the picker searches as you type, arrow keys and Enter work.

## Brand

The identity lives in `static/brand/` — cobalt `#064BFF`, warm ivory `#FFFDF5`, ink `#111318`. White horizontal logo on dark, blue on light, the app icon for the favicon and the extension.

## Colour and logos

**Colour:** open a category and press **Auto-colour**. It reads the brand's own colours — the site's declared theme colour first, then the strongest colours in its logo, then any brand variables in its CSS — and offers up to five swatches. Pick one to tint the card, or × for none. The logo outranks the CSS because two shops on the same Shopify theme declare identical `--color-` variables; that is the theme's palette, not the brand's.

**Logo:** open a category, type a site into the logo box, press **Fetch**. Every logo comes out 1:1 at 256px: square sources are preferred over wide ones, an SVG is rasterised, and a wide wordmark is centred on a transparent square rather than squashed. It takes the best logo that site publishes — apple-touch icon, then the icons its web manifest declares, then the largest declared icon, then the favicon — asking the CDN for a full-size version where the URL allows it — shrinks it to 256px and keeps a local copy in `icons/`. The same box accepts a direct image address if you want a specific file.

Ask me for one and I'll fetch it from the terminal:

```
python3 tools/fetch_icon.py example.com cat-example
```

**Upload** sets an icon from a file on disk, for when a site publishes nothing usable.

`tools/icon_overrides.json` fixes sites that misreport themselves — `meet.google.com` signed out declares the plain Google "G", and `docs.google.com` declares one icon whether the link is a Sheet, a Doc or a Form. Entries are matched longest-prefix-first on `host/path`; add a line when you hit another.

Links with no icon of their own show a coloured letter tile, so nothing is ever blank.

Some brands publish a **photograph** as their own favicon — a product shot or a model. No fetcher can do better than what a site serves, so for those, paste a direct image URL into the logo box and press Fetch, or use Upload.

## Putting it on another machine

The code is in a private repo; **the board is not**. Everyone keeps their own
`hub.json`, their own logos and their own history — an update never touches them.
A machine with no board gets an empty one with three starter categories.

**Windows** — download one file and double-click it:

[**Install-Stash.bat**](https://raw.githubusercontent.com/dannyzeemedia/stash/main/windows/Install-Stash.bat)
*(right-click → Save link as)*

It installs Python if you don't have it, puts Stash in your user folder, starts it,
keeps it running from then on, and prints the three clicks to load the browser
extension. It checks for a newer version every morning and at every logon, so it
stays current on its own. `Update Stash.bat` forces a check.

**Linux** — clone it, `pip install -r requirements.txt`, then `./serve.sh`, and add
`serve.sh` to cron so it comes back after a reboot.

## Where things live

| | |
| --- | --- |
| `hub.json` | The board. Categories, links, the 12 quick-link slots, the inbox |
| `icons/` | Every logo and favicon, local copies |
| `static/` | The page: `index.html`, `app.js`, `style.css`, and Sortable for the dragging |
| `server.py` | Flask, bound to 127.0.0.1 only |
| `backups/` | A dated copy of `hub.json`, written the first time it changes each day |
| `static/brand/` | The Stash identity — logos, app icon, favicon |
| `extension/` | The browser extension: new-tab override plus the save button, loaded unpacked |

`serve.sh` runs at boot and every 5 minutes from cron, and starts the server if it isn't already up. To restart it by hand:

```
pkill -f 'python3 server.py'; ./serve.sh
```

## Notes

- Clicks are counted per link in `hub.json`, which is what seeded the quick pad.
- Deleting a category doesn't throw its links away — they go back to the inbox.
- `tools/seed.py` imports a Papaly (or any browser) bookmarks export, keeping its folders as categories.
