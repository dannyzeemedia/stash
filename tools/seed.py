#!/usr/bin/env python3
"""Build a first board from a Papaly export.

Papaly's own export is an HTML bookmarks file. Save it, then:

    python3 tools/seed.py papaly.html

Each Papaly category becomes a Stash category, keeping its name and order.
Refuses to run if a board already exists, so it can never overwrite one.
"""

import html
import json
import os
import re
import sys
import time
import uuid

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.environ.get("STASH_DATA") or os.path.join(HERE, "hub.json")

# Page titles carry the site's name twice. These read better without it.
TIDY = [
    (r"\s*[·|–-]\s*(Google Drive|Google Sheets|Google Docs|Google Forms|Google Drawings)$", ""),
    (r"\s*·\s*(Home|Alia)\s*·\s*Shopify( Plus)?$", ""),
    (r"\s*[–-]\s*Klaviyo\s*-?\s*Help Center$", ""),
    (r"\s*\|\s*Klaviyo( Community| Help Center)?$", ""),
    (r"\s*-\s*YouTube$", ""),
    (r"\s*[–-]\s*Whiteboard$", ""),
    (r"\.docx$", ""),
]


def tidy(title):
    for pattern, repl in TIDY:
        title = re.sub(pattern, repl, title).strip()
    return title or "Untitled"


def new_id(prefix):
    return prefix + "-" + uuid.uuid4().hex[:8]


def parse(path):
    """Walk a Netscape bookmarks file: <H3> is a folder, <A> is a link."""
    text = open(path, encoding="utf-8", errors="replace").read()
    categories, current = [], None

    for m in re.finditer(r"<H3[^>]*>(.*?)</H3>|<A\s+[^>]*HREF=\"([^\"]+)\"[^>]*>(.*?)</A>",
                         text, re.I | re.S):
        folder, href, label = m.group(1), m.group(2), m.group(3)
        if folder is not None:
            current = {
                "id": new_id("cat"),
                "name": html.unescape(re.sub("<[^>]+>", "", folder)).strip() or "Untitled",
                "icon": "", "color": "", "palette": "", "site": "",
                "parent": "", "collapsed": False, "links": [],
            }
            current["palette"] = []
            categories.append(current)
            continue
        if current is None:
            current = {"id": new_id("cat"), "name": "Imported", "icon": "", "color": "",
                       "palette": [], "site": "", "parent": "", "collapsed": False, "links": []}
            categories.append(current)
        current["links"].append({
            "id": new_id("lnk"),
            "title": tidy(html.unescape(re.sub("<[^>]+>", "", label or ""))),
            "url": html.unescape(href),
            "icon": "", "note": "", "clicks": 0,
            "added": time.strftime("%Y-%m-%d"),
        })

    return [c for c in categories if c["links"]]


def main():
    if os.path.exists(DATA):
        sys.exit("A board already exists at %s — move it aside first." % DATA)
    if len(sys.argv) < 2:
        sys.exit(__doc__)

    categories = parse(sys.argv[1])
    board = {
        "updated": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "quickpad": [None] * 12,
        "categories": categories,
        "inbox": [],
        "trash": [],
    }
    with open(DATA, "w") as fh:
        json.dump(board, fh, indent=1, ensure_ascii=False)

    links = sum(len(c["links"]) for c in categories)
    print("%s: %d categories, %d links." % (DATA, len(categories), links))
    print("Start Stash, then use Auto-colour and Fetch on each category to give it a logo.")


if __name__ == "__main__":
    main()
