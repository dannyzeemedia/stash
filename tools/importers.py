#!/usr/bin/env python3
"""Turn other people's bookmark tools into Stash categories.

Two ways in, both returning the same shape:

    categories_from_papaly("https://papaly.com/someone/ab12C/Work")
    categories_from_bookmarks(html_text)      # any browser's export

Stdlib only — this has to run on a fresh Windows box with nothing installed
beyond Flask and Pillow.
"""

import html as htmllib
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/150.0.0.0 Safari/537.36")

# Page titles repeat the site's name. These read better without it.
TIDY = [
    (r"\s*[·|–—-]\s*(Google Drive|Google Sheets|Google Docs|Google Forms|Google Drawings)\s*$", ""),
    (r"\s*·\s*Home\s*·\s*Shopify( Plus)?\s*$", ""),
    (r"\s*[–—-]\s*YouTube\s*$", ""),
    (r"\s*[–—-]\s*Whiteboard\s*$", ""),
    (r"\.docx\s*$", ""),
]


def _tidy(title):
    title = htmllib.unescape(re.sub("<[^>]+>", "", title or "")).strip()
    # Papaly stores some titles with UTF-8 read as Windows-1252.
    if re.search(r"[ÂâÃ]", title):
        try:
            title = title.encode("cp1252", "strict").decode("utf-8", "strict")
        except Exception:
            pass
    for pattern, repl in TIDY:
        title = re.sub(pattern, repl, title).strip()
    return title or "Untitled"


def _new(prefix):
    return prefix + "-" + uuid.uuid4().hex[:8]


def _category(name):
    return {
        "id": _new("cat"), "name": name or "Imported", "icon": "", "color": "",
        "palette": [], "site": "", "parent": "", "collapsed": False, "links": [],
    }


def _link(title, url):
    return {
        "id": _new("lnk"), "title": _tidy(title), "url": htmllib.unescape(url or "").strip(),
        "icon": "", "note": "", "clicks": 0, "added": time.strftime("%Y-%m-%d"),
    }


def fetch(url, timeout=60, hops=5, tries=4):
    """Papaly is slow and 503s intermittently, so be patient and try again."""
    last = None
    for attempt in range(tries):
        hop_url = url
        for _ in range(hops):
            req = urllib.request.Request(hop_url, headers={"User-Agent": UA})
            try:
                with urllib.request.urlopen(req, timeout=timeout) as r:
                    return r.read().decode("utf-8", "replace")
            except urllib.error.HTTPError as e:
                if e.code in (301, 302, 303, 307, 308) and e.headers.get("Location"):
                    hop_url = urllib.parse.urljoin(hop_url, e.headers["Location"])
                    continue
                last = e
                break
            except Exception as e:
                last = e
                break
        if attempt < tries - 1:
            time.sleep(2 + attempt * 3)
    raise last or urllib.error.URLError("could not fetch " + url)


# ------------------------------------------------------------------ Papaly

CARD = re.compile(r'<div class="card [^"]*"[^>]*category-name="([^"]*)"', re.I)
ITEM = re.compile(
    r'<li class="theme-item-border-color item-bookmark.*?url="([^"]*)".*?'
    r'class="item-name"[^>]*>(.*?)</span>', re.I | re.S)
BOARD_LINK = re.compile(r'href="(/[^"/]+/[A-Za-z0-9]{4,}/[^"]*)"')


def papaly_board_urls(url):
    """A board link imports that board. A profile link imports every board on it."""
    url = url.strip()
    if not url.startswith("http"):
        url = "https://" + url.lstrip("/")
    parts = urllib.parse.urlparse(url)
    if len([p for p in parts.path.split("/") if p]) >= 3:
        return [url]                       # already a board
    page = fetch(url)
    found = []
    for path in BOARD_LINK.findall(page):
        full = urllib.parse.urljoin(url, path)
        if full not in found:
            found.append(full)
    return found or [url]


def categories_from_papaly(url):
    """Read a public Papaly board. Private boards can't be read without a login."""
    out = []
    for board_url in papaly_board_urls(url):
        page = fetch(board_url)
        # Split the page on each card so links land under the right heading.
        pieces = re.split(r'(<div class="card [^"]*"[^>]*category-name="[^"]*")', page)
        for i in range(1, len(pieces), 2):
            name = CARD.search(pieces[i] + '>')
            cat = _category(_tidy(name.group(1)) if name else "Imported")
            for href, label in ITEM.findall(pieces[i + 1]):
                if href:
                    cat["links"].append(_link(label, href))
            if cat["links"]:
                out.append(cat)
    return out


# ------------------------------------------------- browser bookmarks export

FOLDER = re.compile(r"<H3[^>]*>(.*?)</H3>", re.I | re.S)
ANCHOR = re.compile(r'<A\s+[^>]*HREF="([^"]+)"[^>]*>(.*?)</A>', re.I | re.S)
EITHER = re.compile(r'<H3[^>]*>(.*?)</H3>|<A\s+[^>]*HREF="([^"]+)"[^>]*>(.*?)</A>', re.I | re.S)


def categories_from_bookmarks(text):
    """Any Netscape-format bookmarks file: Chrome, Firefox, Safari, Papaly."""
    out, current = [], None
    for m in EITHER.finditer(text):
        folder, href, label = m.group(1), m.group(2), m.group(3)
        if folder is not None:
            current = _category(_tidy(folder))
            out.append(current)
            continue
        if current is None:
            current = _category("Imported")
            out.append(current)
        if href and not href.lower().startswith(("javascript:", "place:")):
            current["links"].append(_link(label, href))
    return [c for c in out if c["links"]]


if __name__ == "__main__":
    import json
    import sys
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    arg = sys.argv[1]
    cats = (categories_from_papaly(arg) if arg.startswith(("http", "papaly."))
            else categories_from_bookmarks(open(arg, encoding="utf-8", errors="replace").read()))
    print(json.dumps([{"name": c["name"], "links": len(c["links"])} for c in cats], indent=1))
    print("%d categories, %d links" % (len(cats), sum(len(c["links"]) for c in cats)))
