"""Regenerates the static app-level OG image (frontend/public/og-image.png):
the BadgeIt logo + wordmark with a tagline underneath, styled like the
header on frontend/src/pages/LandingPage.tsx. This image never varies
per-request (unlike the per-profile OG images the backend generates
dynamically in backend/src/og_image.rs), so it's just a committed static
asset — rerun this script by hand and re-commit the PNG whenever the
design or tagline text needs to change.

Lives outside frontend/, backend/, and infra/ so it never gets swept into
anything that builds or deploys to AWS.

Requires Pillow: pip install pillow

Usage: python3 utilities/generate_og_image.py
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

REPO_ROOT = Path(__file__).resolve().parent.parent

CANVAS_WIDTH = 1200
CANVAS_HEIGHT = 630
WHITE = (255, 255, 255, 255)
BRAND_BLUE = (37, 99, 235, 255)
MUTED_GREY = (107, 114, 128, 255)

LOGO_CROP = (3, 3, 83, 83)  # same crop box og_image.rs uses to strip the baked-in margin
LOGO_SIZE = 160
WORDMARK_SCALE = 110
GAP_LOGO_WORDMARK = 20
TAGLINE_SCALE = 42
GAP_GROUP_TAGLINE = 34

TAGLINE_TEXT = "The conference badge widget that connects people"

FONT_PATH = REPO_ROOT / "backend/assets/fonts/Lato-Bold.ttf"
LOGO_PATH = REPO_ROOT / "backend/assets/badgeit-logo.png"
OUT_PATH = REPO_ROOT / "frontend/public/og-image.png"


def main() -> None:
    canvas = Image.new("RGBA", (CANVAS_WIDTH, CANVAS_HEIGHT), WHITE)
    draw = ImageDraw.Draw(canvas)

    logo = Image.open(LOGO_PATH).convert("RGBA").crop(LOGO_CROP)
    logo = logo.resize((LOGO_SIZE, LOGO_SIZE), Image.LANCZOS)

    wordmark_font = ImageFont.truetype(str(FONT_PATH), WORDMARK_SCALE)
    tagline_font = ImageFont.truetype(str(FONT_PATH), TAGLINE_SCALE)

    wordmark_bbox = draw.textbbox((0, 0), "BadgeIt", font=wordmark_font)
    wordmark_w = wordmark_bbox[2] - wordmark_bbox[0]
    wordmark_h = wordmark_bbox[3] - wordmark_bbox[1]

    tagline_bbox = draw.textbbox((0, 0), TAGLINE_TEXT, font=tagline_font)
    tagline_w = tagline_bbox[2] - tagline_bbox[0]
    tagline_h = tagline_bbox[3] - tagline_bbox[1]

    group_width = LOGO_SIZE + GAP_LOGO_WORDMARK + wordmark_w
    row_height = max(LOGO_SIZE, wordmark_h)
    total_height = row_height + GAP_GROUP_TAGLINE + tagline_h

    top = (CANVAS_HEIGHT - total_height) // 2

    logo_x = (CANVAS_WIDTH - group_width) // 2
    logo_y = top + (row_height - LOGO_SIZE) // 2
    canvas.alpha_composite(logo, (logo_x, logo_y))

    wordmark_x = logo_x + LOGO_SIZE + GAP_LOGO_WORDMARK
    wordmark_y = top - wordmark_bbox[1] + (row_height - wordmark_h) // 2
    draw.text((wordmark_x, wordmark_y), "BadgeIt", font=wordmark_font, fill=BRAND_BLUE)

    tagline_x = (CANVAS_WIDTH - tagline_w) // 2
    tagline_y = top + row_height + GAP_GROUP_TAGLINE - tagline_bbox[1]
    draw.text((tagline_x, tagline_y), TAGLINE_TEXT, font=tagline_font, fill=MUTED_GREY)

    canvas.save(OUT_PATH)
    print(f"wrote {OUT_PATH} ({CANVAS_WIDTH}x{CANVAS_HEIGHT})")


if __name__ == "__main__":
    main()
