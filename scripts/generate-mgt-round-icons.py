#!/usr/bin/env python3
"""Derive circular MGT launcher/web art from the already approved source."""
import argparse
import base64
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "icon.png"


def icon(maskable=False):
    original = Image.open(SOURCE).convert("RGBA")
    if original.size != (1024, 1024):
        raise ValueError("Expected the approved 1024x1024 MGT source icon")
    # Crop only the outer rectangular frame; keep the actual MGT letters and
    # rising chart unchanged. This creates a genuine round emblem.
    symbol = original.crop((135, 142, 890, 885))
    disc = 760 if maskable else 850
    mark = 590 if maskable else 690
    canvas = Image.new("RGBA", (1024, 1024), "#101820" if maskable else (0, 0, 0, 0))
    circle = Image.new("RGBA", (disc, disc), "#0e1721")
    if not maskable:
        alpha = Image.new("L", (disc, disc), 0)
        ImageDraw.Draw(alpha).ellipse((1, 1, disc - 2, disc - 2), fill=255)
        circle.putalpha(alpha.filter(ImageFilter.GaussianBlur(1.4)))
    canvas.alpha_composite(circle, ((1024 - disc) // 2, (1024 - disc) // 2))
    symbol = symbol.resize((mark, mark), Image.Resampling.LANCZOS)
    red, green, blue, _ = symbol.split()
    brightest = ImageChops.lighter(red, ImageChops.lighter(green, blue))
    # The source artwork's dark square background vanishes; brightly colored
    # strokes, anti-aliasing and letterforms remain, without a boxed edge.
    symbol.putalpha(brightest.point(lambda value: int(max(0, min(255, (value - 32) * 6)))))
    canvas.alpha_composite(symbol, ((1024 - mark) // 2, (1024 - mark) // 2))
    if not maskable:
        boundary = Image.new("L", (1024, 1024), 0)
        ImageDraw.Draw(boundary).ellipse((87, 87, 937, 937), fill=255)
        boundary = boundary.filter(ImageFilter.GaussianBlur(1.3))
        canvas.putalpha(ImageChops.multiply(canvas.getchannel("A"), boundary))
    return canvas


def resized(im, width):
    return im.resize((width, width), Image.Resampling.LANCZOS)


def save_png(im, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, format="PNG", optimize=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--web", action="store_true")
    parser.add_argument("--android", action="store_true")
    args = parser.parse_args()
    if not (args.web ^ args.android):
        parser.error("Pass exactly one of --web or --android")

    if args.android:
        # Only modifies the temporary runner's checkout. Never overwrites the
        # repository's approved original image on the public web workflow.
        save_png(icon(True), SOURCE)
        return

    round_icon = icon(False)
    safe_icon = icon(True)
    save_png(resized(round_icon, 192), ROOT / "public/icons/mgt-icon-192.png")
    save_png(resized(round_icon, 512), ROOT / "public/icons/mgt-icon-512.png")
    save_png(resized(safe_icon, 512), ROOT / "public/icons/mgt-icon-maskable-512.png")
    save_png(resized(round_icon, 180).convert("RGB"), ROOT / "public/icons/mgt-apple-touch-icon.png")
    save_png(resized(round_icon, 512), ROOT / "app/icon.png")
    ico_path = ROOT / "app/favicon.ico"
    resized(round_icon, 256).save(ico_path, format="ICO", sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])
    # Old legacy SVG callers (business metadata, worker cache and share actions)
    # must show exactly the same round icon, not stale square artwork.
    png_data = BytesIO()
    resized(round_icon, 256).save(png_data, format="PNG", optimize=True)
    uri = base64.b64encode(png_data.getvalue()).decode("ascii")
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" role="img" aria-label="MGT"><image href="data:image/png;base64,{uri}" width="256" height="256"/></svg>\n'
    for path in ("app/icon.svg", "public/icon.svg", "assets/logo.svg"):
        (ROOT / path).write_text(svg, encoding="utf-8")
    # Validate corners and Android masking before publishing.
    assert round_icon.getpixel((0,0))[3] == 0
    assert round_icon.getpixel((512,512))[3] == 255
    assert safe_icon.getpixel((0,0))[3] == 255


if __name__ == "__main__":
    main()
