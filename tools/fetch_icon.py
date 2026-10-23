#!/usr/bin/env python3
"""Fetch the best icon a site has and save it into ~/zm-hub/icons.

    python3 tools/fetch_icon.py example.com example
    python3 tools/fetch_icon.py https://example.com/logo.png mylogo

Looks for, best first: apple-touch-icon, the icons a web manifest declares,
the largest declared <link rel=icon>, then the usual paths at the site root.
A direct image URL is taken as-is. Prints the path to store in hub.json,
relative to the hub root.

It deliberately ignores og:image. That is the social-share picture — nearly
always a product photo or a model, not the brand's mark.
"""

import io
import json
import os
import re
import subprocess
import sys
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICONS = os.path.join(HERE, "icons")
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/150.0.0.0 Safari/537.36")
IMAGE_TYPES = {
    "image/png": ".png", "image/jpeg": ".jpg", "image/svg+xml": ".svg",
    "image/webp": ".webp", "image/x-icon": ".ico", "image/vnd.microsoft.icon": ".ico",
    "image/gif": ".gif",
}


def get(url, timeout=15, hops=5):
    """Fetch a URL, following redirects by hand. urllib neither dispatches 308
    nor allows it in redirect_request, so igloo.inc (308 -> www.igloo.inc) threw
    and an HTML error page got saved as cat-igloo.png."""
    for _ in range(hops):
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return (r.read(),
                        r.headers.get("Content-Type", "").split(";")[0].strip().lower())
        except urllib.error.HTTPError as e:
            if e.code in (301, 302, 303, 307, 308) and e.headers.get("Location"):
                url = urllib.parse.urljoin(url, e.headers["Location"])
                continue
            raise
    raise urllib.error.URLError("too many redirects")


def upscale(url, px=512):
    """Shopify and friends size their favicons in the URL. Ask for a big one
    first, and keep the original as the fallback."""
    bigger = []
    if re.search(r"_\d+x\d+\.(png|jpe?g|webp)", url, re.I):
        bigger.append(re.sub(r"_\d+x\d+\.", "_%dx%d." % (px, px), url))
    if re.search(r"[?&](width|height)=\d+", url, re.I):
        bigger.append(re.sub(r"([?&])(width|height)=\d+",
                             lambda m: "%s%s=%d" % (m.group(1), m.group(2), px), url))
    return bigger + [url]


def override_for(url):
    """Some sites misreport themselves. Longest prefix of host/path wins."""
    try:
        parts = urllib.parse.urlparse(url if "://" in url else "https://" + url)
        key = (parts.hostname or "").lower() + (parts.path or "")
        table = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                            "icon_overrides.json")))
    except Exception:
        return None
    best = None
    for pattern, icon in table.items():
        if pattern.startswith("_"):
            continue
        if key == pattern or key.startswith(pattern.rstrip("/") + "/"):
            if best is None or len(pattern) > len(best[0]):
                best = (pattern, icon)
    return best[1] if best else None


def candidates(page_url):
    """Icon URLs a page declares, best first."""
    try:
        body, ctype = get(page_url)
    except Exception:
        return []
    if ctype in IMAGE_TYPES:
        return [page_url]

    html = body.decode("utf-8", "replace")[:400000]
    found = []
    manifest = None

    for m in re.finditer(r"<link\b[^>]*>", html, re.I):
        tag = m.group(0)
        rel = (re.search(r'rel=["\']([^"\']+)', tag, re.I) or [None, ""])[1].lower()
        href = re.search(r'href=["\']([^"\']+)', tag, re.I)
        if not href:
            continue
        url = urllib.parse.urljoin(page_url, href.group(1))
        if "manifest" in rel:
            manifest = url
            continue
        if "icon" not in rel:
            continue
        sizes = re.search(r'sizes=["\'](\d+)', tag, re.I)
        px = int(sizes.group(1)) if sizes else (180 if "apple" in rel else 32)
        if url.lower().endswith(".svg"):
            px = max(px, 512)          # scalable beats any raster
        found.append((px, url))

    # A web manifest usually declares the big square app icon — the best source.
    if manifest:
        try:
            raw, _ = get(manifest)
            for icon in json.loads(raw.decode("utf-8", "replace")).get("icons", []):
                src = icon.get("src")
                if not src:
                    continue
                px = max([int(p.split("x")[0]) for p in str(icon.get("sizes", "0")).split()
                          if p.split("x")[0].isdigit()] or [0])
                found.append((px, urllib.parse.urljoin(manifest, src)))
        except Exception:
            pass

    found.sort(key=lambda t: -t[0])
    urls = []
    for _, u in found:
        urls.extend(upscale(u))
    for guess in ("/apple-touch-icon.png", "/apple-touch-icon-precomposed.png", "/favicon.ico"):
        urls.append(urllib.parse.urljoin(page_url, guess))

    seen, out = set(), []
    for u in urls:
        if u not in seen:
            seen.add(u)
            out.append(u)
    return out


def rasterise(path, box=256):
    """SVG in, PNG out. Inkscape is already on this machine."""
    out = os.path.splitext(path)[0] + ".png"
    try:
        subprocess.run(
            ["inkscape", path, "--export-type=png", "--export-filename=" + out,
             "--export-width=%d" % box, "--export-height=%d" % box,
             "--export-background-opacity=0"],
            check=True, capture_output=True, timeout=60)
    except Exception:
        return None
    return out if os.path.exists(out) else None


def squarify(path, box=256):
    """Every icon comes out 1:1 — a wide wordmark is centred on a transparent
    square rather than squashed or cropped."""
    if path.endswith(".svg"):
        png = rasterise(path, box)
        if not png:
            return path          # keep the SVG; the page scales it anyway
        os.remove(path)
        path = png
    try:
        from PIL import Image
    except ImportError:
        return path
    try:
        with Image.open(path) as im:
            im = im.convert("RGBA")
            bbox = im.getbbox()          # drop any transparent border it came with
            if bbox:
                im = im.crop(bbox)
            im.thumbnail((box, box), Image.LANCZOS)
            # Square on the image's own longest side — padding a 16px favicon out
            # to 256 would render it as a dot.
            side = max(im.width, im.height)
            canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
            canvas.paste(im, ((side - im.width) // 2, (side - im.height) // 2), im)
            out = os.path.splitext(path)[0] + ".png"
            canvas.save(out, "PNG", optimize=True)
        if out != path:
            os.remove(path)
        return out
    except Exception:
        return path


def slugify(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-") or "icon"


def is_image(data, ext):
    """A site can answer a .png URL with an HTML error page. Trusting the URL
    extension once saved a whole web page as cat-igloo.png."""
    if data[:5].lstrip()[:1] == b"<" and b"<svg" not in data[:400].lower():
        return False
    if ext == ".svg":
        return b"<svg" in data[:4000].lower()
    try:
        from PIL import Image
        with Image.open(io.BytesIO(data)) as im:
            im.verify()
        return True
    except Exception:
        return False


def photoish(data, ext):
    """True for a photograph rather than a mark. Shopify stores serve the shop's
    hero image at /apple-touch-icon.png, which is square and large and utterly
    wrong — a logo has few colours and usually some transparency."""
    if ext == ".svg":
        return False
    try:
        from PIL import Image
        with Image.open(io.BytesIO(data)) as im:
            im = im.convert("RGBA")
            if min(im.size) < 48:
                return False
            has_alpha = any(a < 250 for _, _, _, a in im.resize((32, 32)).getdata())
            im.thumbnail((96, 96))
            shades = len({(r // 16, g // 16, b // 16)
                          for r, g, b, a in im.getdata() if a > 128})
        return shades > 110 and not has_alpha
    except Exception:
        return False


def shape_of(data, ext):
    """(is_square, pixels) for ranking. SVGs are treated as square and large,
    since they scale and almost always carry an aspect ratio we can honour."""
    if ext == ".svg":
        m = re.search(rb'viewBox=["\']\s*[\d.]+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)', data[:4000])
        if m:
            w, h = float(m.group(1)), float(m.group(2))
            return (abs(w - h) / max(w, h) < 0.08, 1024)
        return (True, 1024)
    try:
        from PIL import Image
        with Image.open(io.BytesIO(data)) as im:
            w, h = im.size
        return (abs(w - h) / max(w, h, 1) < 0.08, w * h)
    except Exception:
        return (False, 0)


def fetch(target, name=None):
    if not target.startswith(("http://", "https://")):
        target = "https://" + target
    name = slugify(name or urllib.parse.urlparse(target).hostname or "icon")
    os.makedirs(ICONS, exist_ok=True)

    forced = override_for(target)
    if forced:
        try:
            data, ctype = get(forced)
            ext = IMAGE_TYPES.get(ctype) or os.path.splitext(
                urllib.parse.urlparse(forced).path)[1].lower()
            if is_image(data, ext):
                path = os.path.join(ICONS, name + (ext or ".png"))
                with open(path, "wb") as fh:
                    fh.write(data)
                return "icons/" + os.path.basename(squarify(path))
        except Exception:
            pass

    # What the page declares comes first; squareness only breaks ties between
    # the top few. Ranking purely on size lets a big hero photo win.
    best = None   # (score, data, ext)
    photos = []
    for i, url in enumerate(candidates(target)[:8]):
        try:
            data, ctype = get(url)
        except Exception:
            continue
        if len(data) < 60:
            continue
        ext = IMAGE_TYPES.get(ctype)
        if not ext:
            ext = os.path.splitext(urllib.parse.urlparse(url).path)[1].lower()
            if ext not in {".png", ".jpg", ".jpeg", ".svg", ".ico", ".webp", ".gif"}:
                continue
        if not is_image(data, ext):
            continue
        if photoish(data, ext):
            photos.append((data, ext))
            continue
        square, pixels = shape_of(data, ext)
        score = (-min(i, 2), square, pixels)
        if best is None or score > best[0]:
            best = (score, data, ext)
        if i >= 2 and best:
            break

    if not best and photos:
        best = ((0, False, 0),) + photos[0]   # nothing else on offer
    if not best:
        return None
    path = os.path.join(ICONS, name + best[2])
    with open(path, "wb") as fh:
        fh.write(best[1])
    return "icons/" + os.path.basename(squarify(path))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    got = fetch(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
    print(got or "no icon found")
    sys.exit(0 if got else 1)
