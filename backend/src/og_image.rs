//! Generates the composite Open Graph share image for a profile: the
//! BadgeTag logo + wordmark in the top-left corner, a QR code linking to the
//! public card (with a small caption below it showing the app's domain, or
//! the profile's full vanity URL if it has a custom slug), and the user's
//! profile photo (or a generic placeholder avatar, if none has been
//! uploaded yet) — see `store::upsert_profile` and `store::upload_image`,
//! which call `generate` and persist the result to S3 as `{image_key}-og`.
//! Used by `og::render_og_html` as the `og:image`.

use image::{ImageFormat, Rgba, RgbaImage, imageops::FilterType};
use imageproc::drawing::{draw_filled_circle_mut, draw_filled_ellipse_mut, draw_text_mut};

use crate::error::AppError;

const CANVAS_WIDTH: u32 = 1200;
const CANVAS_HEIGHT: u32 = 630;
const MARGIN: i32 = 48;
const LOGO_SIZE: u32 = 84;
// The embedded logo PNG is a 160x160 canvas with a large baked-in white
// margin — the actual glyph only occupies roughly (7,7)-(78,78). Resizing
// the full canvas made the icon look tiny and left a dead gap before the
// wordmark; crop to the glyph (plus a few px of breathing room) first so it
// fills LOGO_SIZE edge-to-edge and sits flush against the text.
const LOGO_CROP_X: u32 = 3;
const LOGO_CROP_Y: u32 = 3;
const LOGO_CROP_SIZE: u32 = 80;
const QR_SIZE: u32 = 400;
const QR_X: i32 = MARGIN;
const QR_Y: i32 = MARGIN + LOGO_SIZE as i32 + 40;
const PHOTO_DIAMETER: u32 = 380;

const BRAND_BLUE: Rgba<u8> = Rgba([37, 99, 235, 255]);
const PLACEHOLDER_GREY: Rgba<u8> = Rgba([209, 213, 219, 255]);
const QR_LABEL_GREY: Rgba<u8> = Rgba([107, 114, 128, 255]);
const WHITE: Rgba<u8> = Rgba([255, 255, 255, 255]);

static LOGO_PNG: &[u8] = include_bytes!("../assets/badgetag-logo.png");
static WORDMARK_FONT: &[u8] = include_bytes!("../assets/fonts/Lato-Bold.ttf");

/// Renders a 1200x630 PNG: logo + "BadgeTag" wordmark (top-left), a QR code
/// encoding the profile's public URL with a small caption below it (below
/// that), and the profile photo as a circular crop on the right — or a
/// placeholder avatar in that same spot when `photo_bytes` is `None` (no
/// picture uploaded yet).
pub fn generate(
    profile_id: &str,
    site_url: &str,
    slug: Option<&str>,
    photo_bytes: Option<&[u8]>,
) -> Result<Vec<u8>, AppError> {
    let mut canvas = RgbaImage::from_pixel(CANVAS_WIDTH, CANVAS_HEIGHT, WHITE);

    draw_logo_and_wordmark(&mut canvas)?;
    draw_qr_code(&mut canvas, profile_id, site_url)?;
    draw_qr_label(&mut canvas, site_url, slug)?;

    let photo_x = (CANVAS_WIDTH as i32) - MARGIN - (PHOTO_DIAMETER as i32);
    // Vertically centered on the QR code rather than the full canvas — the
    // QR sits lower than canvas-center (it's pushed down by the logo above
    // it), so canvas-centering the photo left it visibly higher than the QR.
    let qr_center_y = QR_Y + (QR_SIZE as i32) / 2;
    let photo_y = qr_center_y - (PHOTO_DIAMETER as i32) / 2;
    let photo_circle = match photo_bytes {
        Some(bytes) => circular_photo(bytes)?,
        None => placeholder_avatar(),
    };
    image::imageops::overlay(&mut canvas, &photo_circle, photo_x.into(), photo_y.into());

    let mut out = Vec::new();
    image::DynamicImage::ImageRgba8(canvas)
        .write_to(&mut std::io::Cursor::new(&mut out), ImageFormat::Png)
        .map_err(|e| AppError::Internal(format!("Failed to encode OG image: {e}")))?;
    Ok(out)
}

fn draw_logo_and_wordmark(canvas: &mut RgbaImage) -> Result<(), AppError> {
    let logo = image::load_from_memory(LOGO_PNG)
        .map_err(|e| AppError::Internal(format!("Failed to decode embedded logo: {e}")))?
        .crop_imm(LOGO_CROP_X, LOGO_CROP_Y, LOGO_CROP_SIZE, LOGO_CROP_SIZE)
        .resize_exact(LOGO_SIZE, LOGO_SIZE, FilterType::Lanczos3)
        .to_rgba8();
    image::imageops::overlay(canvas, &logo, MARGIN.into(), MARGIN.into());

    let font = ab_glyph::FontRef::try_from_slice(WORDMARK_FONT)
        .map_err(|e| AppError::Internal(format!("Failed to load wordmark font: {e}")))?;
    let scale = ab_glyph::PxScale::from(52.0);
    let text_x = MARGIN + LOGO_SIZE as i32 + 12;
    let text_y = MARGIN + (LOGO_SIZE as i32 - 52) / 2 - 6;
    draw_text_mut(canvas, BRAND_BLUE, text_x, text_y, scale, &font, "BadgeTag");

    Ok(())
}

fn draw_qr_code(canvas: &mut RgbaImage, profile_id: &str, site_url: &str) -> Result<(), AppError> {
    let url = if site_url.is_empty() {
        format!("/p/{profile_id}")
    } else {
        format!("{}/p/{profile_id}", site_url.trim_end_matches('/'))
    };

    let code = qrcode::QrCode::with_error_correction_level(url.as_bytes(), qrcode::EcLevel::H)
        .map_err(|e| AppError::Internal(format!("Failed to build QR code: {e}")))?;
    let qr_luma = code
        .render::<image::Luma<u8>>()
        // The renderer's default quiet zone (white margin around the
        // modules) is redundant here — the canvas around the QR's box is
        // already white — and was eating ~25% of QR_SIZE on each side,
        // making the code read as noticeably smaller than the photo circle
        // next to it despite similar box sizes. Disabling it lets the
        // modules fill the full box.
        .quiet_zone(false)
        .min_dimensions(QR_SIZE, QR_SIZE)
        .max_dimensions(QR_SIZE, QR_SIZE)
        .build();
    let qr_rgba = image::DynamicImage::ImageLuma8(qr_luma).to_rgba8();

    image::imageops::overlay(canvas, &qr_rgba, QR_X.into(), QR_Y.into());
    Ok(())
}

/// Draws a small caption just below the QR code's bottom-left corner —
/// never overlapping the code's modules or finder patterns, which would
/// risk breaking scannability. Shows the bare app domain (e.g.
/// `badgetag.me`), or the profile's full vanity URL (e.g.
/// `badgetag.me/@rdbatch`) if it has a custom `slug`. Draws nothing if
/// `site_url` is empty (no domain configured yet — e.g. local/test runs).
fn draw_qr_label(
    canvas: &mut RgbaImage,
    site_url: &str,
    slug: Option<&str>,
) -> Result<(), AppError> {
    if site_url.is_empty() {
        return Ok(());
    }

    let domain = site_url
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_end_matches('/');
    let label = match slug {
        Some(s) if !s.is_empty() => format!("{domain}/@{s}"),
        _ => domain.to_string(),
    };

    let font = ab_glyph::FontRef::try_from_slice(WORDMARK_FONT)
        .map_err(|e| AppError::Internal(format!("Failed to load label font: {e}")))?;
    let scale = ab_glyph::PxScale::from(32.0);
    let label_y = QR_Y + QR_SIZE as i32 + 2;
    draw_text_mut(canvas, QR_LABEL_GREY, QR_X, label_y, scale, &font, &label);

    Ok(())
}

/// Decodes, center-crops to a square, resizes, and circularly masks a
/// user-uploaded photo. Returns a `PHOTO_DIAMETER`x`PHOTO_DIAMETER` image,
/// transparent outside the circle, ready to `overlay` onto the canvas.
fn circular_photo(bytes: &[u8]) -> Result<RgbaImage, AppError> {
    let img = image::load_from_memory(bytes)
        .map_err(|e| AppError::Internal(format!("Failed to decode profile photo: {e}")))?;

    let (w, h) = (img.width(), img.height());
    let side = w.min(h);
    let square = img.crop_imm((w - side) / 2, (h - side) / 2, side, side);
    let mut resized = square
        .resize_exact(PHOTO_DIAMETER, PHOTO_DIAMETER, FilterType::Lanczos3)
        .to_rgba8();

    mask_to_circle(&mut resized);
    Ok(resized)
}

/// A generic default-avatar icon (grey circle, white head-and-shoulders
/// silhouette) shown in the photo's place for profiles that haven't
/// uploaded a picture yet.
fn placeholder_avatar() -> RgbaImage {
    let mut avatar = RgbaImage::from_pixel(PHOTO_DIAMETER, PHOTO_DIAMETER, Rgba([0, 0, 0, 0]));
    let radius = (PHOTO_DIAMETER / 2) as i32;
    let center = (radius, radius);

    draw_filled_circle_mut(&mut avatar, center, radius, PLACEHOLDER_GREY);
    draw_filled_circle_mut(
        &mut avatar,
        (center.0, center.1 - radius / 4),
        radius * 2 / 5,
        WHITE,
    );
    draw_filled_ellipse_mut(
        &mut avatar,
        (center.0, center.1 + radius),
        radius * 4 / 5,
        radius * 3 / 4,
        WHITE,
    );

    mask_to_circle(&mut avatar);
    avatar
}

/// Zeroes the alpha channel of any pixel outside the image's inscribed
/// circle, guaranteeing a clean circular edge regardless of what was drawn
/// inside — a safety clamp for shapes (like the placeholder's shoulders)
/// that may otherwise extend past the circle's boundary.
fn mask_to_circle(img: &mut RgbaImage) {
    let (w, h) = img.dimensions();
    let radius = (w.min(h) / 2) as f32;
    let center = (w as f32 / 2.0, h as f32 / 2.0);

    for (x, y, pixel) in img.enumerate_pixels_mut() {
        let dx = x as f32 + 0.5 - center.0;
        let dy = y as f32 + 0.5 - center.1;
        if (dx * dx + dy * dy).sqrt() > radius {
            pixel.0[3] = 0;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_a_valid_png_without_a_photo() {
        let png_bytes =
            generate("abc123", "https://badgetag.me", None, None).expect("should generate");
        let img = image::load_from_memory(&png_bytes).expect("should decode as an image");
        assert_eq!(img.width(), CANVAS_WIDTH);
        assert_eq!(img.height(), CANVAS_HEIGHT);
    }

    #[test]
    fn generates_a_valid_png_with_a_slug() {
        // The label should switch to the full vanity URL form without
        // affecting the rest of the composite's layout.
        let png_bytes = generate("abc123", "https://badgetag.me", Some("rdbatch"), None)
            .expect("should generate");
        let img = image::load_from_memory(&png_bytes).expect("should decode as an image");
        assert_eq!(img.width(), CANVAS_WIDTH);
        assert_eq!(img.height(), CANVAS_HEIGHT);
    }

    #[test]
    fn generates_a_valid_png_with_a_photo() {
        // A tiny in-memory PNG (solid color) stands in for a real upload —
        // decoding/cropping/resizing shouldn't care about content.
        let mut sample = RgbaImage::from_pixel(200, 300, Rgba([255, 0, 0, 255]));
        for (_, _, p) in sample.enumerate_pixels_mut() {
            *p = Rgba([12, 34, 56, 255]);
        }
        let mut sample_bytes = Vec::new();
        image::DynamicImage::ImageRgba8(sample)
            .write_to(
                &mut std::io::Cursor::new(&mut sample_bytes),
                ImageFormat::Png,
            )
            .unwrap();

        let png_bytes = generate("abc123", "https://badgetag.me", None, Some(&sample_bytes))
            .expect("should generate");
        let img = image::load_from_memory(&png_bytes).expect("should decode as an image");
        assert_eq!(img.width(), CANVAS_WIDTH);
        assert_eq!(img.height(), CANVAS_HEIGHT);
    }

    #[test]
    fn works_without_a_site_url() {
        // Generation shouldn't depend on a domain being configured yet —
        // the QR code just encodes a relative path in that case.
        let png_bytes = generate("abc123", "", None, None).expect("should generate");
        assert!(!png_bytes.is_empty());
    }

    #[test]
    fn mask_to_circle_clears_corners_but_keeps_center() {
        let mut img = RgbaImage::from_pixel(100, 100, Rgba([1, 2, 3, 255]));
        mask_to_circle(&mut img);
        assert_eq!(img.get_pixel(0, 0).0[3], 0, "corner should be transparent");
        assert_eq!(img.get_pixel(50, 50).0[3], 255, "center should stay opaque");
    }
}
