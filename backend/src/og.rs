//! Renders crawler-facing HTML with OpenGraph/Twitter meta tags for a
//! profile. The real `/p/:id` page is a client-rendered SPA, so a link
//! shared to iMessage/Slack/LinkedIn would otherwise unfurl with no name,
//! photo, or preview — social-media crawlers don't execute JavaScript.
//!
//! This is served only to known crawler User-Agents (see the CloudFront
//! Function that rewrites their requests to `/__og/profile/{id}`); real
//! visitors always get the actual SPA. It has no interactivity, so it
//! doesn't need to match the SPA's styling or behavior — just correct tags.

use crate::models::Profile;

/// Escapes `&`, `<`, `>`, `"`, and `'` for safe embedding in HTML text
/// content or double-quoted attribute values.
fn escape_html(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for c in input.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(c),
        }
    }
    out
}

/// Renders a minimal HTML document with OpenGraph/Twitter meta tags for the
/// given profile (or a generic "not found" document when `profile` is
/// `None`, e.g. a deleted card).
///
/// `site_url` is the app's public origin (e.g. `https://badgeit.app`), used
/// to build absolute `og:url`/`og:image` values — required by the OpenGraph
/// spec. It's optional (empty string) until a custom domain is configured;
/// in that case `og:url` and `og:image` are omitted rather than emitting
/// invalid relative URLs that crawlers would reject.
///
/// `id_or_slug` is the raw path segment the crawler actually requested —
/// either a bare profile ID (rendered as `/p/{id}`) or an `@`-prefixed
/// custom slug (rendered as `/@{slug}`) — so a shared vanity link unfurls
/// with that same vanity URL rather than the underlying ID.
pub fn render_og_html(profile: Option<&Profile>, id_or_slug: &str, site_url: &str) -> String {
    let page_path = match id_or_slug.strip_prefix('@') {
        Some(slug) => format!("/@{slug}"),
        None => format!("/p/{id_or_slug}"),
    };

    let page_url = if site_url.is_empty() {
        None
    } else {
        Some(format!("{}{}", site_url.trim_end_matches('/'), page_path))
    };

    let (title, description, image_url) = match profile {
        Some(p) => {
            let name = p.display_name.as_deref().unwrap_or("Someone");
            let title = format!("{name} - BadgeIt");
            let description = p
                .tagline
                .clone()
                .unwrap_or_else(|| "Check out my BadgeIt digital business card.".to_string());
            let image_url = p
                .image_url
                .as_ref()
                .map(|url| {
                    if url.starts_with("http://") || url.starts_with("https://") {
                        url.clone()
                    } else if !site_url.is_empty() {
                        format!("{}{}", site_url.trim_end_matches('/'), url)
                    } else {
                        // No site_url to make a relative image_url absolute —
                        // omit og:image rather than emit an invalid URL.
                        String::new()
                    }
                })
                .filter(|url| !url.is_empty());
            (title, description, image_url)
        }
        None => (
            "Card Not Found - BadgeIt".to_string(),
            "This card doesn't exist or has been deleted.".to_string(),
            None,
        ),
    };

    let title = escape_html(&title);
    let description = escape_html(&description);

    let mut tags: Vec<String> = vec![
        r#"<meta property="og:type" content="profile">"#.to_string(),
        format!(r#"<meta property="og:title" content="{title}">"#),
        format!(r#"<meta property="og:description" content="{description}">"#),
        format!(r#"<meta name="twitter:title" content="{title}">"#),
        format!(r#"<meta name="twitter:description" content="{description}">"#),
    ];

    if let Some(url) = &page_url {
        tags.push(format!(
            r#"<meta property="og:url" content="{}">"#,
            escape_html(url)
        ));
    }

    if let Some(img) = &image_url {
        tags.push(format!(
            r#"<meta property="og:image" content="{}">"#,
            escape_html(img)
        ));
        tags.push(r#"<meta name="twitter:card" content="summary_large_image">"#.to_string());
    } else {
        tags.push(r#"<meta name="twitter:card" content="summary">"#.to_string());
    }

    let link_href = escape_html(&page_url.unwrap_or(page_path));

    format!(
        "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<title>{title}</title>\n{meta}\n</head>\n<body>\n<p>{description}</p>\n<p><a href=\"{link_href}\">View this BadgeIt card</a></p>\n</body>\n</html>\n",
        title = title,
        meta = tags.join("\n"),
        description = description,
        link_href = link_href,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::ThemeId;

    fn test_profile() -> Profile {
        Profile {
            id: "abc123".to_string(),
            slug: None,
            email: Some("test@example.com".to_string()),
            display_name: Some("Ada Lovelace".to_string()),
            tagline: Some("Countess of Computing".to_string()),
            phone: None,
            location: None,
            pronouns: None,
            image_url: Some("/images/abc123".to_string()),
            theme: ThemeId::Light,
            custom_theme: None,
            view_count: None,
            display_email: true,
            links: vec![],
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn escape_html_escapes_all_special_characters() {
        assert_eq!(
            escape_html(r#"<script>alert("x & 'y'")</script>"#),
            "&lt;script&gt;alert(&quot;x &amp; &#39;y&#39;&quot;)&lt;/script&gt;"
        );
    }

    #[test]
    fn renders_title_and_description_from_profile() {
        let html = render_og_html(Some(&test_profile()), "abc123", "https://badgeit.app");
        assert!(html.contains(r#"<meta property="og:title" content="Ada Lovelace - BadgeIt">"#));
        assert!(
            html.contains(r#"<meta property="og:description" content="Countess of Computing">"#)
        );
        assert!(html.contains("<title>Ada Lovelace - BadgeIt</title>"));
    }

    #[test]
    fn builds_absolute_url_and_image_from_site_url() {
        let html = render_og_html(Some(&test_profile()), "abc123", "https://badgeit.app");
        assert!(
            html.contains(r#"<meta property="og:url" content="https://badgeit.app/p/abc123">"#)
        );
        assert!(
            html.contains(
                r#"<meta property="og:image" content="https://badgeit.app/images/abc123">"#
            )
        );
        assert!(html.contains(r#"<meta name="twitter:card" content="summary_large_image">"#));
    }

    #[test]
    fn omits_url_and_image_when_site_url_is_empty() {
        let html = render_og_html(Some(&test_profile()), "abc123", "");
        assert!(!html.contains("og:url"));
        assert!(!html.contains("og:image"));
        assert!(html.contains(r#"<meta name="twitter:card" content="summary">"#));
        // Falls back to a site-relative link in the visible body.
        assert!(html.contains(r#"href="/p/abc123""#));
    }

    #[test]
    fn builds_slug_url_when_id_is_at_prefixed() {
        let html = render_og_html(
            Some(&test_profile()),
            "@ada-lovelace",
            "https://badgeit.app",
        );
        assert!(
            html.contains(
                r#"<meta property="og:url" content="https://badgeit.app/@ada-lovelace">"#
            )
        );
        assert!(!html.contains("/p/@ada-lovelace"));
    }

    #[test]
    fn falls_back_to_slug_relative_link_when_site_url_is_empty() {
        let html = render_og_html(Some(&test_profile()), "@ada-lovelace", "");
        assert!(html.contains(r#"href="/@ada-lovelace""#));
    }

    #[test]
    fn keeps_an_already_absolute_image_url_unchanged() {
        let mut profile = test_profile();
        profile.image_url = Some("https://cdn.example.com/photo.jpg".to_string());
        let html = render_og_html(Some(&profile), "abc123", "https://badgeit.app");
        assert!(
            html.contains(
                r#"<meta property="og:image" content="https://cdn.example.com/photo.jpg">"#
            )
        );
    }

    #[test]
    fn falls_back_to_defaults_when_name_and_tagline_are_absent() {
        let mut profile = test_profile();
        profile.display_name = None;
        profile.tagline = None;
        let html = render_og_html(Some(&profile), "abc123", "https://badgeit.app");
        assert!(html.contains(r#"content="Someone - BadgeIt""#));
        assert!(html.contains("Check out my BadgeIt digital business card."));
    }

    #[test]
    fn renders_not_found_document_when_profile_is_none() {
        let html = render_og_html(None, "missing", "https://badgeit.app");
        assert!(html.contains("Card Not Found - BadgeIt"));
        assert!(html.contains("This card doesn&#39;t exist or has been deleted."));
        assert!(!html.contains("og:image"));
    }

    #[test]
    fn escapes_user_controlled_fields_in_title_and_description() {
        let mut profile = test_profile();
        profile.display_name = Some(r#"<img src=x onerror=alert(1)>"#.to_string());
        profile.tagline = Some("Say \"hi\" & <wave>".to_string());
        let html = render_og_html(Some(&profile), "abc123", "https://badgeit.app");
        assert!(!html.contains("<img src=x"));
        assert!(html.contains("&lt;img src=x onerror=alert(1)&gt;"));
        assert!(html.contains("Say &quot;hi&quot; &amp; &lt;wave&gt;"));
    }

    #[test]
    fn full_realistic_profile_renders_sane_html_and_omits_owner_only_fields() {
        use crate::models::{SocialLink, SocialPlatform};
        let profile = Profile {
            id: "mockprofile01".to_string(),
            slug: None,
            email: Some("ada@example.com".to_string()),
            display_name: Some("Ada Lovelace".to_string()),
            tagline: Some("Analytical Engine Programmer".to_string()),
            phone: Some("+1 (555) 010-1842".to_string()),
            location: Some("London, UK".to_string()),
            pronouns: Some("she/her".to_string()),
            image_url: Some("/images/mockprofile01".to_string()),
            theme: ThemeId::Ocean,
            custom_theme: None,
            view_count: Some(42),
            display_email: true,
            links: vec![SocialLink {
                platform: SocialPlatform::Github,
                url: "https://github.com/adalovelace".to_string(),
                label: None,
            }],
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
        };

        let html = render_og_html(Some(&profile), "mockprofile01", "https://badgeit.app");
        assert!(html.starts_with("<!DOCTYPE html>"));
        assert!(html.contains("Ada Lovelace - BadgeIt"));
        assert!(html.contains("https://badgeit.app/p/mockprofile01"));
        assert!(html.contains("https://badgeit.app/images/mockprofile01"));
        // view_count/phone/location/pronouns are edit-page-only data, not
        // meant for the crawler-facing OG document.
        assert!(!html.contains("42"));
        assert!(!html.contains("555"));
    }
}
