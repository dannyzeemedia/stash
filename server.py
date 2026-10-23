#!/usr/bin/env python3
"""Stash: a local bookmark board at http://localhost:8800.

Everything lives in hub.json next to this file. Nothing is served off the
machine — the server binds to 127.0.0.1 only.
"""

import json
import os
import shutil
import threading
import sys
import time
import uuid

from flask import Flask, jsonify, request, send_from_directory

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "tools"))
import brand_colors  # noqa: E402
import fetch_icon  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
# A test instance runs on its own port against its own file, so nothing
# automated can ever touch the real board.
DATA = os.environ.get("STASH_DATA") or os.path.join(HERE, "hub.json")
BACKUPS = os.environ.get("STASH_BACKUPS") or os.path.join(HERE, "backups")
PORT = int(os.environ.get("STASH_PORT") or 8800)
TRASH_DAYS = 30

app = Flask(__name__, static_folder=os.path.join(HERE, "static"), static_url_path="")


def load():
    with open(DATA) as fh:
        board = json.load(fh)
    board.setdefault("trash", [])
    board.setdefault("inbox", [])
    for c in board.get("categories", []):
        c.setdefault("collapsed", False)
        c.setdefault("color", "")
        c.setdefault("palette", [])
        c.setdefault("site", "")
        c.setdefault("parent", "")
    return board


def sweep_trash(board):
    """Anything deleted more than TRASH_DAYS ago goes for good."""
    cutoff = time.time() - TRASH_DAYS * 86400
    keep = [t for t in board["trash"] if t.get("deletedAt", 0) > cutoff]
    dropped = len(board["trash"]) - len(keep)
    board["trash"] = keep
    return dropped


def save(board):
    """Write through a temp file, and keep a dated copy once a day."""
    os.makedirs(BACKUPS, exist_ok=True)
    stamp = time.strftime("%Y-%m-%d")
    daily = os.path.join(BACKUPS, "hub-%s.json" % stamp)
    if os.path.exists(DATA) and not os.path.exists(daily):
        shutil.copy2(DATA, daily)

    board["updated"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    tmp = DATA + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(board, fh, indent=1, ensure_ascii=False)
    os.replace(tmp, DATA)
    return board


def ensure_icon(link_id, url):
    """Give a link the site's own icon, in the background so a capture is
    instant. Anything arriving without one — the extension, the bookmarklet —
    gets it this way."""
    def work():
        try:
            from urllib.parse import urlparse
            host = (urlparse(url).hostname or "").lower()
            if not host:
                return
            path = fetch_icon.fetch("https://" + host, "site-" + fetch_icon.slugify(host))
            if not path:
                return
            board = load()
            for holder in [board["inbox"], board["trash"]] + \
                          [c["links"] for c in board["categories"]]:
                for l in holder:
                    if l["id"] == link_id and not l.get("icon"):
                        l["icon"] = path
                        save(board)
                        return
            for slot in board["quickpad"]:
                if slot and slot.get("id") == link_id and not slot.get("icon"):
                    slot["icon"] = path
                    save(board)
                    return
        except Exception:
            pass
    threading.Thread(target=work, daemon=True).start()


def new_id(prefix):
    return prefix + "-" + uuid.uuid4().hex[:8]


def find_category(board, cat_id):
    for c in board["categories"]:
        if c["id"] == cat_id:
            return c
    return None


def find_link(board, link_id):
    for c in board["categories"]:
        for i, l in enumerate(c["links"]):
            if l["id"] == link_id:
                return c, i, l
    return None, None, None


# ---------------------------------------------------------------- pages

@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.route("/icons/<path:name>")
def icon(name):
    """Squaring an icon can change its extension (.ico in, .png out). Older
    records may still point at the old name, so fall back by basename."""
    folder = os.path.join(HERE, "icons")
    if not os.path.exists(os.path.join(folder, name)):
        stem = os.path.splitext(os.path.basename(name))[0]
        for ext in (".png", ".svg", ".jpg", ".webp", ".ico", ".gif"):
            if os.path.exists(os.path.join(folder, stem + ext)):
                name = stem + ext
                break
    # Icons are replaced in place when a logo is refetched, so the browser must
    # revalidate rather than sit on an hour-old copy. They are local and tiny.
    resp = send_from_directory(folder, name, max_age=0)
    resp.headers["Cache-Control"] = "no-cache, must-revalidate"
    return resp


# ---------------------------------------------------------------- board

def icons_version():
    """Newest mtime in icons/. The page hangs this on every icon URL, so
    replacing a logo in place busts the browser's copy of it."""
    folder = os.path.join(HERE, "icons")
    try:
        return int(max(os.path.getmtime(os.path.join(folder, f))
                       for f in os.listdir(folder)))
    except Exception:
        return 0


@app.get("/api/board")
def get_board():
    board = load()
    if sweep_trash(board):
        save(board)
    board["iconsVersion"] = icons_version()
    # The coverage grid is optional; hide its button when it isn't installed.
    board["hasGrid"] = os.path.exists(os.path.join(HERE, "grid", "index.html"))
    return jsonify(board)


@app.put("/api/board")
def put_board():
    """Whole-board write. The page sends this after a drag."""
    board = request.get_json(force=True)
    if not isinstance(board, dict) or "categories" not in board:
        return jsonify(error="not a board"), 400
    return jsonify(save(board))


# ---------------------------------------------------------------- categories

@app.post("/api/categories")
def add_category():
    body = request.get_json(force=True)
    board = load()
    cat = {
        "id": new_id("cat"),
        "name": body.get("name") or "New category",
        "icon": body.get("icon") or "",
        "color": body.get("color") or "",
        "palette": body.get("palette") or [],
        "site": body.get("site") or "",
        "parent": body.get("parent") or "",
        "collapsed": False,
        "links": [],
    }
    board["categories"].insert(0, cat)
    save(board)
    return jsonify(cat)


@app.patch("/api/categories/<cat_id>")
def edit_category(cat_id):
    body = request.get_json(force=True)
    board = load()
    cat = find_category(board, cat_id)
    if not cat:
        return jsonify(error="no such category"), 404
    for key in ("name", "icon", "color", "palette", "site", "collapsed", "parent"):
        if key in body:
            cat[key] = body[key]
    save(board)
    return jsonify(cat)


@app.delete("/api/categories/<cat_id>")
def delete_category(cat_id):
    """The whole card goes to the trash — the category, anything nested under
    it, and every link inside — restorable as one piece for TRASH_DAYS days."""
    board = load()
    cat = find_category(board, cat_id)
    if not cat:
        return jsonify(error="no such category"), 404

    children = [c for c in board["categories"] if c.get("parent") == cat_id]
    index = board["categories"].index(cat)
    going = [cat] + children
    board["categories"] = [c for c in board["categories"] if c not in going]

    entry = dict(cat)
    entry["kind"] = "category"
    entry["deletedAt"] = time.time()
    entry["index"] = index
    entry["children"] = children
    board["trash"].insert(0, entry)
    save(board)
    return jsonify(ok=True, trashed=len(ids), children=len(children))


# ---------------------------------------------------------------- links

@app.post("/api/links")
def add_link():
    body = request.get_json(force=True)
    url = (body.get("url") or "").strip()
    if not url:
        return jsonify(error="no url"), 400
    board = load()
    link = {
        "id": new_id("lnk"),
        "title": (body.get("title") or url).strip(),
        "url": url,
        "icon": body.get("icon") or "",
        "note": body.get("note") or "",
        "clicks": 0,
        "added": time.strftime("%Y-%m-%d"),
    }
    cat = find_category(board, body.get("category") or "")
    if cat:
        cat["links"].append(link)
    else:
        board["inbox"].insert(0, link)
    save(board)
    if not link["icon"]:
        ensure_icon(link["id"], url)
    return jsonify(link)


@app.patch("/api/links/<link_id>")
def edit_link(link_id):
    body = request.get_json(force=True)
    board = load()
    cat, idx, link = find_link(board, link_id)
    if not link:
        link = next((l for l in board["inbox"] if l["id"] == link_id), None)
    if not link:
        return jsonify(error="no such link"), 404
    for key in ("title", "url", "icon", "note"):
        if key in body:
            link[key] = body[key]
    save(board)
    return jsonify(link)


@app.delete("/api/links/<link_id>")
def delete_link(link_id):
    """Nothing is destroyed here — it goes to the trash for TRASH_DAYS days."""
    board = load()
    cat, idx, link = find_link(board, link_id)
    origin, origin_id, origin_at = "", "", 0
    if link:
        origin, origin_id, origin_at = cat["name"], cat["id"], idx
        cat["links"].pop(idx)
    else:
        link = next((l for l in board["inbox"] if l["id"] == link_id), None)
        if not link:
            return jsonify(error="no such link"), 404
        origin = "Inbox"
        board["inbox"] = [l for l in board["inbox"] if l["id"] != link_id]

    # A quick link is its own copy, not a pointer — deleting the filed link
    # leaves the tile alone. Unpinning is how you remove a tile.
    link = dict(link)
    link["deletedAt"] = time.time()
    link["from"] = origin
    link["fromId"] = origin_id
    link["fromAt"] = origin_at
    board["trash"].insert(0, link)
    save(board)
    return jsonify(ok=True, trashed=len(board["trash"]))


@app.post("/api/trash/<item_id>/restore")
def restore(item_id):
    """A category comes back whole, where it was. A link comes back to the
    inbox, so it gets re-filed deliberately."""
    board = load()
    item = next((t for t in board["trash"] if t["id"] == item_id), None)
    if not item:
        return jsonify(error="not in the trash"), 404
    board["trash"] = [t for t in board["trash"] if t["id"] != item_id]
    item.pop("deletedAt", None)

    if item.get("kind") == "category":
        index = min(item.pop("index", 0), len(board["categories"]))
        item.pop("kind", None)
        children = item.pop("children", [])
        board["categories"].insert(index, item)
        for offset, child in enumerate(children):
            board["categories"].insert(index + 1 + offset, child)
    else:
        # Put it back where it was. The inbox is only the fallback for a link
        # whose category has since gone.
        home = find_category(board, item.pop("fromId", "") or "")
        at = item.pop("fromAt", 0)
        item.pop("from", None)
        if home:
            home["links"].insert(min(at, len(home["links"])), item)
        else:
            board["inbox"].insert(0, item)
    save(board)
    return jsonify(ok=True, kind="category" if "links" in item else "link")


@app.delete("/api/trash/<item_id>")
def purge_one(item_id):
    board = load()
    before = len(board["trash"])
    board["trash"] = [t for t in board["trash"] if t["id"] != item_id]
    if len(board["trash"]) == before:
        return jsonify(error="not in the trash"), 404
    save(board)
    return jsonify(ok=True)


@app.delete("/api/trash")
def empty_trash():
    board = load()
    n = len(board["trash"])
    board["trash"] = []
    save(board)
    return jsonify(ok=True, removed=n)


@app.post("/api/links/<link_id>/click")
def click(link_id):
    board = load()
    cat, idx, link = find_link(board, link_id)
    if not link:
        link = next((l for l in board["inbox"] if l["id"] == link_id), None)
    if link:
        link["clicks"] = link.get("clicks", 0) + 1
        save(board)
    return jsonify(ok=True)


# ---------------------------------------------------------------- icons

@app.post("/api/icon")
def grab_icon():
    """Fetch a site's icon and store it locally. {source, name} -> {icon}."""
    body = request.get_json(force=True)
    source = (body.get("source") or "").strip()
    if not source:
        return jsonify(error="no source"), 400
    path = fetch_icon.fetch(source, body.get("name"))
    if not path:
        return jsonify(error="no icon found at that address"), 404
    return jsonify(icon=path)


@app.post("/api/icon/upload")
def upload_icon():
    """A file off the machine, for when a site publishes nothing usable."""
    f = request.files.get("file")
    if not f or not f.filename:
        return jsonify(error="no file"), 400
    name = fetch_icon.slugify(request.form.get("name") or os.path.splitext(f.filename)[0])
    ext = os.path.splitext(f.filename)[1].lower() or ".png"
    if ext not in (".png", ".jpg", ".jpeg", ".svg", ".webp", ".gif", ".ico"):
        return jsonify(error="not an image file"), 400

    os.makedirs(os.path.join(HERE, "icons"), exist_ok=True)
    path = os.path.join(HERE, "icons", "custom-" + name + ext)
    f.save(path)
    with open(path, "rb") as fh:
        head = fh.read(4096)
    if not fetch_icon.is_image(head + b"", ext):
        os.remove(path)
        return jsonify(error="that file is not a readable image"), 400
    return jsonify(icon="icons/" + os.path.basename(fetch_icon.squarify(path)))


@app.post("/api/import")
def do_import():
    """Add categories from somewhere else. Three ways in, one endpoint:
      {"categories": [...]}  - already parsed (the extension scrapes Papaly)
      {"papaly": "<url>"}    - a public Papaly board or profile
      a posted bookmarks file - any browser's export
    Nothing is ever replaced; imported cards are added to the board."""
    import importers

    cats = None
    upload = request.files.get("file")
    if upload and upload.filename:
        text = upload.read().decode("utf-8", "replace")
        cats = importers.categories_from_bookmarks(text)
    else:
        body = request.get_json(silent=True) or {}
        if body.get("categories"):
            cats = []
            for c in body["categories"]:
                cat = importers._category(c.get("name"))
                for l in c.get("links") or []:
                    if l.get("url"):
                        cat["links"].append(importers._link(l.get("title"), l["url"]))
                if cat["links"]:
                    cats.append(cat)
        elif body.get("papaly"):
            try:
                cats = importers.categories_from_papaly(body["papaly"])
            except Exception as e:
                return jsonify(error="Couldn't read that Papaly page: %s" % e), 502

    if cats is None:
        return jsonify(error="nothing to import"), 400
    if not cats:
        return jsonify(error="No bookmarks found in that. If the board is private, "
                             "open it in Papaly and use the browser button instead."), 404

    board = load()
    have = {l["url"] for c in board["categories"] for l in c["links"]}
    have |= {l["url"] for l in board["inbox"]}

    added_cats = added_links = skipped = 0
    for cat in cats:
        fresh = [l for l in cat["links"] if l["url"] not in have]
        skipped += len(cat["links"]) - len(fresh)
        if not fresh:
            continue
        have |= {l["url"] for l in fresh}
        cat["links"] = fresh
        board["categories"].append(cat)
        added_cats += 1
        added_links += len(fresh)
    save(board)

    for cat in board["categories"][-added_cats:] if added_cats else []:
        for l in cat["links"][:40]:
            ensure_icon(l["id"], l["url"])

    return jsonify(ok=True, categories=added_cats, links=added_links, skipped=skipped)


@app.post("/api/colors")
def colors():
    """The brand's 3-5 colours, from what the site declares plus its logo."""
    body = request.get_json(force=True)
    site = (body.get("site") or "").strip()
    icon = (body.get("icon") or "").strip()
    if not site and not icon:
        return jsonify(error="give it a site or a logo to read"), 400
    found = brand_colors.palette(site=site or None, icon=icon or None)
    if not found:
        return jsonify(error="no brand colours found there"), 404
    return jsonify(palette=found)


@app.route("/grid/")
@app.route("/grid/<path:name>")
def grid(name="index.html"):
    """The coverage grid, served rather than opened as a file:// URL —
    a page on http cannot open one, so the button silently did nothing."""
    return send_from_directory(os.path.join(HERE, "grid"), name)


# ---------------------------------------------------------------- capture

@app.route("/save", methods=["GET", "POST"])
def capture():
    """What the Save to Stash extension hits. Lands in the inbox."""
    src = request.form if request.method == "POST" else request.args
    url = (src.get("url") or "").strip()
    if not url:
        return "No URL given", 400

    board = load()
    if any(l["url"] == url for l in board["inbox"]) or \
       any(l["url"] == url for c in board["categories"] for l in c["links"]):
        msg, detail = "Already in Stash", "No duplicate added."
    else:
        fresh = {
            "id": new_id("lnk"),
            "title": (src.get("title") or url).strip()[:200],
            "url": url,
            "icon": "",
            "note": "",
            "clicks": 0,
            "added": time.strftime("%Y-%m-%d"),
        }
        board["inbox"].insert(0, fresh)
        save(board)
        ensure_icon(fresh["id"], url)
        msg, detail = "Saved to Stash", "It is in the inbox, ready to file."

    return """<!doctype html><meta charset="utf-8"><title>%s</title>
<style>
 html{color-scheme:dark light}
 body{margin:0;height:100vh;display:grid;place-items:center;background:#11131a;color:#e8ebf2;
      font:16px/1.5 ui-sans-serif,system-ui,sans-serif;text-align:center}
 .c{max-width:420px;padding:28px}
 h1{font-size:19px;margin:0 0 6px}
 p{margin:0;color:#8b94a5;font-size:14px}
 a{color:#79a9ff}
</style>
<div class="c"><h1>%s</h1><p>%s</p>
<p style="margin-top:14px"><a href="http://localhost:%d/">Open Stash</a></p></div>
<script>setTimeout(function(){window.close()},1400)</script>""" % (msg, msg, detail, PORT)


STARTER = {
    "quickpad": [None] * 12,
    "inbox": [],
    "trash": [],
    "categories": [
        {"id": "cat-start1", "name": "Daily", "icon": "", "color": "#064bff",
         "palette": ["#064bff"], "site": "", "parent": "", "collapsed": False, "links": []},
        {"id": "cat-start2", "name": "Work", "icon": "", "color": "", "palette": [],
         "site": "", "parent": "", "collapsed": False, "links": []},
        {"id": "cat-start3", "name": "Reading", "icon": "", "color": "", "palette": [],
         "site": "", "parent": "", "collapsed": False, "links": []},
    ],
}


def first_run():
    """A fresh machine has no board — give it an empty one rather than refusing
    to start. The board is never in the repo; everyone keeps their own."""
    os.makedirs(os.path.join(HERE, "icons"), exist_ok=True)
    board = dict(STARTER)
    board["updated"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    with open(DATA, "w") as fh:
        json.dump(board, fh, indent=1, ensure_ascii=False)
    print("Created a starter board at", DATA)


if __name__ == "__main__":
    if not os.path.exists(DATA):
        first_run()
    app.run(host="127.0.0.1", port=PORT, debug=False, threaded=True)
