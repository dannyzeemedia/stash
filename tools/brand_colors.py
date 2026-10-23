#!/usr/bin/env python3
"""Pull a brand's 3-5 colours.

    python3 tools/brand_colors.py example.com
    python3 tools/brand_colors.py --icon icons/cat-example.png

Three sources, best first:
  1. The theme-color the site declares for itself.
  2. The logo, quantised down to its strongest colours.
  3. CSS custom properties named like brand colours.

The logo outranks the CSS because two shops on the same Shopify theme declare
the same --color- variables; that is the theme's palette, not the brand's.

Near-white and near-black are dropped: every site has those and they say
nothing about the brand.
"""

import io
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from collections import Counter

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/150.0.0.0 Safari/537.36")

HEX = re.compile(r"#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b")
BRANDY = re.compile(
    r"--[\w-]*(brand|primary|accent|theme|main|logo)[\w-]*\s*:\s*(#[0-9a-fA-F]{3,8}"
    r"|rgba?\([^)]+\))", re.I)


def get(url, timeout=15, limit=600000):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read(limit)


def norm(value):
    """A hex string, or None if it is not a usable colour."""
    value = value.strip()
    m = re.match(r"rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)", value)
    if m:
        rgb = tuple(int(g) for g in m.groups())
    else:
        m = HEX.match(value)
        if not m:
            return None
        h = m.group(1)
        if len(h) == 3:
            h = "".join(c * 2 for c in h)
        rgb = tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
    return rgb


def interesting(rgb):
    """Skip the greys and near-blacks every site uses; they carry no brand."""
    light = sum(rgb) / 3
    spread = max(rgb) - min(rgb)
    return 24 < light < 242 and spread >= 22


def to_hex(rgb):
    return "#%02x%02x%02x" % rgb


def far_enough(rgb, chosen, gap=58):
    return all(sum(abs(a - b) for a, b in zip(rgb, c)) > gap for c in chosen)


def from_site(site):
    """Returns (theme_color_or_None, css_variable_colours)."""
    if not site.startswith(("http://", "https://")):
        site = "https://" + site
    theme, out = None, []
    try:
        html = get(site).decode("utf-8", "replace")
    except Exception:
        return theme, out

    m = re.search(r'<meta[^>]+name=["\']theme-color["\'][^>]+content=["\']([^"\']+)', html, re.I)
    if m:
        rgb = norm(m.group(1))
        if rgb and interesting(rgb):
            theme = rgb

    for _, value in BRANDY.findall(html):
        rgb = norm(value)
        if rgb and interesting(rgb) and far_enough(rgb, out):
            out.append(rgb)

    # The first stylesheet often holds the theme's custom properties.
    css = re.search(r'<link[^>]+rel=["\']stylesheet["\'][^>]+href=["\']([^"\']+)', html, re.I)
    if css and len(out) < 5:
        try:
            sheet = get(urllib.parse.urljoin(site, css.group(1))).decode("utf-8", "replace")
            for _, value in BRANDY.findall(sheet):
                rgb = norm(value)
                if rgb and interesting(rgb) and far_enough(rgb, out):
                    out.append(rgb)
                if len(out) >= 5:
                    break
        except Exception:
            pass
    return theme, out


def from_icon(path, strict=True):
    """The strongest colours in the logo itself."""
    try:
        from PIL import Image
    except ImportError:
        return []
    full = path if os.path.isabs(path) else os.path.join(HERE, path)
    if not os.path.exists(full) or full.endswith(".svg"):
        return svg_colors(full) if full.endswith(".svg") else []
    try:
        with Image.open(full) as im:
            im = im.convert("RGBA")
            im.thumbnail((128, 128))
            counts = Counter()
            sums = {}
            for r, g, b, a in im.getdata():
                if a < 140:
                    continue
                key = (r // 24, g // 24, b // 24)
                counts[key] += 1
                acc = sums.setdefault(key, [0, 0, 0])
                acc[0] += r
                acc[1] += g
                acc[2] += b
    except Exception:
        return []

    out = []
    # Buckets are only for grouping; report each bucket's true average colour,
    # so an exact brand hex comes back exact instead of snapped to a grid.
    for key, n in counts.most_common(60):
        rgb = tuple(round(v / n) for v in sums[key])
        if (interesting(rgb) or (not strict and 10 < sum(rgb) / 3 < 250)) \
                and far_enough(rgb, out):
            out.append(rgb)
        if len(out) >= 5:
            break
    return out


def svg_colors(path):
    try:
        text = open(path, encoding="utf-8", errors="replace").read(300000)
    except Exception:
        return []
    out = []
    for h in HEX.findall(text):
        rgb = norm("#" + h)
        if rgb and interesting(rgb) and far_enough(rgb, out):
            out.append(rgb)
        if len(out) >= 5:
            break
    return out


def brandiness(rgb):
    """How much a colour reads as a brand colour rather than a tint of paper:
    saturated, and neither washed out nor nearly black."""
    light = sum(rgb) / 3
    spread = max(rgb) - min(rgb)
    penalty = abs(light - 125) / 125.0
    return spread * (1.25 - 0.75 * penalty)


def palette(site=None, icon=None, limit=5):
    theme, css = (None, [])
    if site:
        theme, css = from_site(site)

    chosen = []
    for rgb in ([theme] if theme else []) + (from_icon(icon) if icon else []) + css:
        if far_enough(rgb, chosen):
            chosen.append(rgb)
        if len(chosen) >= limit:
            break

    # The theme-color is the site's own word for its brand, so it stays first.
    head = chosen[:1] if theme else []
    tail = sorted(chosen[len(head):], key=brandiness, reverse=True)
    return [to_hex(c) for c in (head + tail)[:limit]]


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)
    if args[0] == "--icon":
        print(json.dumps(palette(icon=args[1])))
    else:
        print(json.dumps(palette(site=args[0], icon=args[1] if len(args) > 1 else None)))
