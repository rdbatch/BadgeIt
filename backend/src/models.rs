use serde::{Deserialize, Serialize};

/// Helper for serde `#[serde(default = "default_true")]`.
fn default_true() -> bool {
    true
}

/// Maximum length for the display name field.
pub const MAX_DISPLAY_NAME_LEN: usize = 100;
/// Maximum length for the tagline field.
pub const MAX_TAGLINE_LEN: usize = 100;
/// Maximum length for the phone field.
pub const MAX_PHONE_LEN: usize = 30;
/// Maximum length for a social link URL.
pub const MAX_LINK_URL_LEN: usize = 500;
/// Maximum length for a custom link label.
pub const MAX_LINK_LABEL_LEN: usize = 50;
/// Maximum number of social links on a profile.
pub const MAX_LINKS: usize = 20;

/// Supported social platforms
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SocialPlatform {
    Linkedin,
    Github,
    Twitter,
    Instagram,
    Youtube,
    Mastodon,
    Bluesky,
    Website,
    Custom,
}

/// A single social link
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SocialLink {
    pub platform: SocialPlatform,
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

impl SocialLink {
    /// Validates URL scheme and length, and label length. Only `http://`
    /// and `https://` URLs are accepted — this rejects `javascript:`,
    /// `data:`, and other schemes that could be used for stored XSS when
    /// rendered as a link's `href` on the public card.
    fn validate(&self) -> Result<(), String> {
        if self.url.len() > MAX_LINK_URL_LEN {
            return Err(format!(
                "Link URL must be {MAX_LINK_URL_LEN} characters or less"
            ));
        }

        let lower = self.url.to_lowercase();
        if !(lower.starts_with("http://") || lower.starts_with("https://")) {
            return Err("Link URL must start with http:// or https://".to_string());
        }

        if let Some(ref label) = self.label
            && label.len() > MAX_LINK_LABEL_LEN
        {
            return Err(format!(
                "Link label must be {MAX_LINK_LABEL_LEN} characters or less"
            ));
        }

        Ok(())
    }
}

/// Available theme identifiers
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "lowercase")]
pub enum ThemeId {
    #[default]
    Light,
    Dark,
    Ocean,
    Sunset,
    Forest,
    Lavender,
    Slate,
    Rose,
    Mint,
    Amber,
}

/// Full profile as stored/returned by the API.
///
/// This is the full-fidelity representation — appropriate for the
/// authenticated "get my own profile" endpoint, where the owner needs to
/// see (and edit) both the email value and the `display_email` flag. The
/// *public* profile endpoint must never serialize this directly; it should
/// call `to_public()` first (see below), which omits `email` when the
/// owner has opted to hide it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Profile {
    pub id: String,
    /// Always populated for the authenticated self-view. Set to `None`
    /// (and therefore omitted from the response) by `to_public()` when
    /// `display_email` is `false`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tagline: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phone: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_url: Option<String>,
    pub theme: ThemeId,
    pub display_email: bool,
    pub links: Vec<SocialLink>,
    pub created_at: String,
    pub updated_at: String,
}

impl Profile {
    /// Returns a copy of this profile safe to serve from the *public*,
    /// unauthenticated profile endpoint.
    ///
    /// Omits `email` when the owner has set `display_email = false`. Phone
    /// has no equivalent visibility flag by design — a user who doesn't
    /// want their phone number public is expected to leave that field
    /// blank rather than fill it in and hide it, so `phone` always passes
    /// through unchanged (it's already `None` unless explicitly set).
    pub fn to_public(&self) -> Profile {
        let mut public = self.clone();
        if !public.display_email {
            public.email = None;
        }
        public
    }
}

/// Request body for creating/updating a profile
#[derive(Debug, Clone, Deserialize)]
pub struct ProfileUpdateRequest {
    pub email: String,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub tagline: Option<String>,
    #[serde(default)]
    pub phone: Option<String>,
    #[serde(default)]
    pub theme: ThemeId,
    #[serde(default = "default_true")]
    pub display_email: bool,
    #[serde(default)]
    pub links: Vec<SocialLink>,
}

impl ProfileUpdateRequest {
    /// Validates all free-text field lengths and link URLs. Called by the
    /// router before any write to the store.
    pub fn validate(&self) -> Result<(), String> {
        if let Some(ref name) = self.display_name
            && name.len() > MAX_DISPLAY_NAME_LEN
        {
            return Err(format!(
                "Display name must be {MAX_DISPLAY_NAME_LEN} characters or less"
            ));
        }

        if let Some(ref tagline) = self.tagline
            && tagline.len() > MAX_TAGLINE_LEN
        {
            return Err(format!(
                "Tagline must be {MAX_TAGLINE_LEN} characters or less"
            ));
        }

        if let Some(ref phone) = self.phone
            && phone.len() > MAX_PHONE_LEN
        {
            return Err(format!("Phone must be {MAX_PHONE_LEN} characters or less"));
        }

        if self.links.len() > MAX_LINKS {
            return Err(format!("A profile can have at most {MAX_LINKS} links"));
        }

        for link in &self.links {
            link.validate()?;
        }

        Ok(())
    }
}

/// Request body for deleting a profile (requires email confirmation)
#[derive(Debug, Clone, Deserialize)]
pub struct ProfileDeleteRequest {
    pub email: String,
}

/// Request body for image upload
#[derive(Debug, Clone, Deserialize)]
pub struct ImageUploadRequest {
    /// Base64-encoded image data
    pub image_data: String,
    /// Content type (e.g., "image/jpeg", "image/png")
    pub content_type: String,
}

/// Response for image upload
#[derive(Debug, Clone, Serialize)]
pub struct ImageUploadResponse {
    pub image_url: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_update_request_deserializes_minimal() {
        let json = r#"{"email": "test@example.com"}"#;
        let req: ProfileUpdateRequest = serde_json::from_str(json).expect("valid");
        assert_eq!(req.email, "test@example.com");
        assert_eq!(req.theme, ThemeId::Light); // default
        assert!(req.links.is_empty());
    }

    #[test]
    fn profile_update_request_deserializes_full() {
        let json = r#"{
            "email": "test@example.com",
            "display_name": "Test User",
            "tagline": "Staff Engineer",
            "phone": "+1 555-0100",
            "theme": "dark",
            "links": [
                {"platform": "github", "url": "https://github.com/test"},
                {"platform": "custom", "url": "https://blog.test.com", "label": "My Blog"}
            ]
        }"#;
        let req: ProfileUpdateRequest = serde_json::from_str(json).expect("valid");
        assert_eq!(req.display_name, Some("Test User".to_string()));
        assert_eq!(req.theme, ThemeId::Dark);
        assert_eq!(req.links.len(), 2);
        assert_eq!(req.links[1].label, Some("My Blog".to_string()));
    }

    #[test]
    fn profile_serializes_without_none_fields() {
        let profile = Profile {
            id: "abc123".to_string(),
            email: Some("test@example.com".to_string()),
            display_name: None,
            tagline: None,
            phone: None,
            image_url: None,
            theme: ThemeId::Light,
            display_email: true,
            links: vec![],
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
        };
        let json = serde_json::to_string(&profile).expect("valid");
        assert!(!json.contains("display_name"));
        assert!(!json.contains("tagline"));
        assert!(!json.contains("phone"));
        assert!(!json.contains("image_url"));
    }

    fn full_profile(display_email: bool) -> Profile {
        Profile {
            id: "abc123".to_string(),
            email: Some("test@example.com".to_string()),
            display_name: Some("Test User".to_string()),
            tagline: None,
            phone: Some("+1 555-0100".to_string()),
            image_url: None,
            theme: ThemeId::Light,
            display_email,
            links: vec![],
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn to_public_omits_email_when_display_email_false() {
        let profile = full_profile(false);
        let public = profile.to_public();
        assert_eq!(public.email, None);
        let json = serde_json::to_string(&public).expect("valid");
        // `"email":` (the field itself, not the "display_email" field name
        // which also contains the substring "email") must be absent.
        assert!(!json.contains("\"email\":"));
        assert!(!json.contains("test@example.com"));
        // Phone has no visibility flag — always passes through.
        assert_eq!(public.phone, Some("+1 555-0100".to_string()));
    }

    #[test]
    fn to_public_keeps_email_when_display_email_true() {
        let profile = full_profile(true);
        let public = profile.to_public();
        assert_eq!(public.email, Some("test@example.com".to_string()));
        let json = serde_json::to_string(&public).expect("valid");
        assert!(json.contains("test@example.com"));
    }

    #[test]
    fn to_public_does_not_mutate_original() {
        let profile = full_profile(false);
        let _ = profile.to_public();
        assert_eq!(profile.email, Some("test@example.com".to_string()));
    }

    #[test]
    fn tagline_validation() {
        // Tagline should be ≤ 100 chars (validation happens at the router level)
        let tagline = "a".repeat(100);
        assert_eq!(tagline.len(), 100);
    }

    fn base_request() -> ProfileUpdateRequest {
        ProfileUpdateRequest {
            email: "test@example.com".to_string(),
            display_name: None,
            tagline: None,
            phone: None,
            theme: ThemeId::Light,
            display_email: true,
            links: vec![],
        }
    }

    #[test]
    fn validate_accepts_minimal_request() {
        assert!(base_request().validate().is_ok());
    }

    #[test]
    fn validate_rejects_display_name_too_long() {
        let mut req = base_request();
        req.display_name = Some("a".repeat(MAX_DISPLAY_NAME_LEN + 1));
        assert!(req.validate().is_err());
    }

    #[test]
    fn validate_accepts_display_name_at_max_length() {
        let mut req = base_request();
        req.display_name = Some("a".repeat(MAX_DISPLAY_NAME_LEN));
        assert!(req.validate().is_ok());
    }

    #[test]
    fn validate_rejects_tagline_too_long() {
        let mut req = base_request();
        req.tagline = Some("a".repeat(MAX_TAGLINE_LEN + 1));
        assert!(req.validate().is_err());
    }

    #[test]
    fn validate_rejects_phone_too_long() {
        let mut req = base_request();
        req.phone = Some("1".repeat(MAX_PHONE_LEN + 1));
        assert!(req.validate().is_err());
    }

    #[test]
    fn validate_rejects_too_many_links() {
        let mut req = base_request();
        req.links = (0..MAX_LINKS + 1)
            .map(|i| SocialLink {
                platform: SocialPlatform::Custom,
                url: format!("https://example.com/{i}"),
                label: None,
            })
            .collect();
        assert!(req.validate().is_err());
    }

    #[test]
    fn validate_rejects_javascript_scheme_url() {
        let mut req = base_request();
        req.links = vec![SocialLink {
            platform: SocialPlatform::Custom,
            url: "javascript:alert(1)".to_string(),
            label: None,
        }];
        assert!(req.validate().is_err());
    }

    #[test]
    fn validate_rejects_data_scheme_url() {
        let mut req = base_request();
        req.links = vec![SocialLink {
            platform: SocialPlatform::Custom,
            url: "data:text/html,<script>alert(1)</script>".to_string(),
            label: None,
        }];
        assert!(req.validate().is_err());
    }

    #[test]
    fn validate_accepts_https_url() {
        let mut req = base_request();
        req.links = vec![SocialLink {
            platform: SocialPlatform::Github,
            url: "https://github.com/test".to_string(),
            label: None,
        }];
        assert!(req.validate().is_ok());
    }

    #[test]
    fn validate_accepts_http_url() {
        let mut req = base_request();
        req.links = vec![SocialLink {
            platform: SocialPlatform::Website,
            url: "http://example.com".to_string(),
            label: None,
        }];
        assert!(req.validate().is_ok());
    }

    #[test]
    fn validate_rejects_link_url_too_long() {
        let mut req = base_request();
        req.links = vec![SocialLink {
            platform: SocialPlatform::Custom,
            url: format!("https://example.com/{}", "a".repeat(MAX_LINK_URL_LEN)),
            label: None,
        }];
        assert!(req.validate().is_err());
    }

    #[test]
    fn validate_rejects_link_label_too_long() {
        let mut req = base_request();
        req.links = vec![SocialLink {
            platform: SocialPlatform::Custom,
            url: "https://example.com".to_string(),
            label: Some("a".repeat(MAX_LINK_LABEL_LEN + 1)),
        }];
        assert!(req.validate().is_err());
    }
}
