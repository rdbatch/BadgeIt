use aws_sdk_dynamodb::Client as DynamoClient;
use aws_sdk_dynamodb::types::AttributeValue;
use aws_sdk_s3::Client as S3Client;

use crate::error::AppError;
use crate::models::{Profile, ProfileUpdateRequest, SocialLink, SocialPlatform, ThemeId};
use crate::profile_id::generate_profile_id;

const PROFILE_SK: &str = "PROFILE";
const LINK_PREFIX: &str = "LINK#";
const EMAIL_POINTER_SK: &str = "POINTER";

/// Data access layer for profile operations.
pub struct ProfileStore {
    dynamo: DynamoClient,
    s3: S3Client,
    table_name: String,
    bucket_name: String,
    image_base_url: String,
}

impl ProfileStore {
    pub fn new(
        dynamo: DynamoClient,
        s3: S3Client,
        table_name: String,
        bucket_name: String,
        image_base_url: String,
    ) -> Self {
        Self {
            dynamo,
            s3,
            table_name,
            bucket_name,
            image_base_url,
        }
    }

    /// Normalizes an email for use as a lookup key (matches the
    /// normalization already applied to the `email` attribute stored on
    /// the profile item itself via `authorize_profile_access`'s
    /// case-insensitive comparison).
    fn email_pk(email: &str) -> String {
        format!("EMAIL#{}", email.trim().to_lowercase())
    }

    /// Looks up the profile ID assigned to an email address, if any.
    async fn get_profile_id_for_email(&self, email: &str) -> Result<Option<String>, AppError> {
        let pk = Self::email_pk(email);

        let result = self
            .dynamo
            .get_item()
            .table_name(&self.table_name)
            .key("pk", AttributeValue::S(pk))
            .key("sk", AttributeValue::S(EMAIL_POINTER_SK.to_string()))
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("DynamoDB get failed: {e}")))?;

        Ok(result
            .item
            .as_ref()
            .and_then(|item| get_string(item, "profile_id")))
    }

    /// Looks up the profile ID for an email, assigning a new random one
    /// (and persisting the `EMAIL#` pointer) if none exists yet.
    ///
    /// Uses a conditional put (`attribute_not_exists(pk)`) so two
    /// concurrent first-writes for the same email can't race into two
    /// different profile IDs — the loser of the race re-reads and uses the
    /// winner's ID instead of failing the request.
    async fn get_or_create_profile_id_for_email(&self, email: &str) -> Result<String, AppError> {
        if let Some(existing) = self.get_profile_id_for_email(email).await? {
            return Ok(existing);
        }

        let pk = Self::email_pk(email);
        let new_id = generate_profile_id();

        let mut item = std::collections::HashMap::new();
        item.insert("pk".to_string(), AttributeValue::S(pk));
        item.insert(
            "sk".to_string(),
            AttributeValue::S(EMAIL_POINTER_SK.to_string()),
        );
        item.insert("profile_id".to_string(), AttributeValue::S(new_id.clone()));

        let put_result = self
            .dynamo
            .put_item()
            .table_name(&self.table_name)
            .set_item(Some(item))
            .condition_expression("attribute_not_exists(pk)")
            .send()
            .await;

        match put_result {
            Ok(_) => Ok(new_id),
            Err(e) => {
                // ConditionalCheckFailedException means another request won
                // the race and created the pointer first — use its ID.
                if e.as_service_error()
                    .is_some_and(|se| se.is_conditional_check_failed_exception())
                {
                    self.get_profile_id_for_email(email).await?.ok_or_else(|| {
                        AppError::Internal(
                            "Email pointer vanished after conditional check failure".to_string(),
                        )
                    })
                } else {
                    Err(AppError::Internal(format!(
                        "DynamoDB pointer put failed: {e}"
                    )))
                }
            }
        }
    }

    /// Get the *public* view of a profile by its ID — omits `email` when
    /// the owner has set `display_email = false`. Safe to call from the
    /// unauthenticated public profile endpoint.
    pub async fn get_profile(&self, profile_id: &str) -> Result<Profile, AppError> {
        let profile = self.get_profile_full(profile_id).await?;
        Ok(profile.to_public())
    }

    /// Get the full profile (including `email` regardless of
    /// `display_email`) for the authenticated user identified by `email`.
    pub async fn get_profile_by_email(&self, email: &str) -> Result<Profile, AppError> {
        let profile_id = self
            .get_profile_id_for_email(email)
            .await?
            .ok_or(AppError::NotFound)?;
        self.get_profile_full(&profile_id).await
    }

    /// Get the full profile (including `email` regardless of
    /// `display_email`) by its ID. Internal — callers outside this module
    /// must go through `get_profile` (public/filtered) or
    /// `get_profile_by_email` (authenticated self-view).
    async fn get_profile_full(&self, profile_id: &str) -> Result<Profile, AppError> {
        let pk = format!("PROFILE#{profile_id}");

        let result = self
            .dynamo
            .query()
            .table_name(&self.table_name)
            .key_condition_expression("pk = :pk")
            .expression_attribute_values(":pk", AttributeValue::S(pk.clone()))
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("DynamoDB query failed: {e}")))?;

        let items = result.items();
        if items.is_empty() {
            return Err(AppError::NotFound);
        }

        // Parse profile item and link items
        let mut profile_item = None;
        let mut links: Vec<(usize, SocialLink)> = Vec::new();

        for item in items {
            let sk = item
                .get("sk")
                .and_then(|v| v.as_s().ok())
                .cloned()
                .unwrap_or_default();

            if sk == PROFILE_SK {
                profile_item = Some(item);
            } else if let Some(order_str) = sk.strip_prefix(LINK_PREFIX) {
                let order: usize = order_str.parse().unwrap_or(0);
                if let Some(link) = parse_link_item(item) {
                    links.push((order, link));
                }
            }
        }

        let item = profile_item.ok_or(AppError::NotFound)?;
        links.sort_by_key(|(order, _)| *order);
        let sorted_links: Vec<SocialLink> = links.into_iter().map(|(_, link)| link).collect();

        let email = get_string(item, "email")
            .ok_or_else(|| AppError::Internal("Profile missing email".to_string()))?;

        let image_key = get_string(item, "image_key");
        let image_url = image_key.map(|key| format!("{}/{}", self.image_base_url, key));

        let theme_str = get_string(item, "theme").unwrap_or_else(|| "light".to_string());
        let theme: ThemeId = serde_json::from_str(&format!("\"{theme_str}\"")).unwrap_or_default();

        Ok(Profile {
            id: profile_id.to_string(),
            email: Some(email),
            display_name: get_string(item, "display_name"),
            tagline: get_string(item, "tagline"),
            phone: get_string(item, "phone"),
            image_url,
            theme,
            display_email: item
                .get("display_email")
                .and_then(|v| v.as_bool().ok())
                .copied()
                .unwrap_or(true),
            links: sorted_links,
            created_at: get_string(item, "created_at").unwrap_or_else(|| "unknown".to_string()),
            updated_at: get_string(item, "updated_at").unwrap_or_else(|| "unknown".to_string()),
        })
    }

    /// Create or update a profile. Resolves (or assigns, on first write)
    /// the caller's profile ID via the `EMAIL#` pointer rather than
    /// deriving it from the email — see `get_or_create_profile_id_for_email`.
    pub async fn upsert_profile(&self, req: &ProfileUpdateRequest) -> Result<Profile, AppError> {
        let profile_id = self.get_or_create_profile_id_for_email(&req.email).await?;
        let pk = format!("PROFILE#{profile_id}");
        let now = chrono_now();

        // Check if profile exists to preserve created_at
        let existing = self.get_profile_full(&profile_id).await.ok();
        let created_at = existing
            .as_ref()
            .map(|p| p.created_at.clone())
            .unwrap_or_else(|| now.clone());

        // Build profile item
        let mut item = std::collections::HashMap::new();
        item.insert("pk".to_string(), AttributeValue::S(pk.clone()));
        item.insert("sk".to_string(), AttributeValue::S(PROFILE_SK.to_string()));
        item.insert("email".to_string(), AttributeValue::S(req.email.clone()));
        item.insert(
            "theme".to_string(),
            AttributeValue::S(
                serde_json::to_string(&req.theme)
                    .unwrap_or_else(|_| "\"light\"".to_string())
                    .trim_matches('"')
                    .to_string(),
            ),
        );
        item.insert(
            "created_at".to_string(),
            AttributeValue::S(created_at.clone()),
        );
        item.insert("updated_at".to_string(), AttributeValue::S(now.clone()));

        item.insert(
            "display_email".to_string(),
            AttributeValue::Bool(req.display_email),
        );

        if let Some(ref name) = req.display_name {
            item.insert("display_name".to_string(), AttributeValue::S(name.clone()));
        }
        if let Some(ref tagline) = req.tagline {
            item.insert("tagline".to_string(), AttributeValue::S(tagline.clone()));
        }
        if let Some(ref phone) = req.phone {
            item.insert("phone".to_string(), AttributeValue::S(phone.clone()));
        }

        // Preserve image_key if it exists
        if let Some(ref existing_profile) = existing
            && existing_profile.image_url.is_some()
        {
            let image_key = format!("images/{profile_id}");
            item.insert("image_key".to_string(), AttributeValue::S(image_key));
        }

        // Write profile item
        self.dynamo
            .put_item()
            .table_name(&self.table_name)
            .set_item(Some(item))
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("DynamoDB put failed: {e}")))?;

        // Delete existing link items
        self.delete_links(&pk).await?;

        // Write new link items
        for (i, link) in req.links.iter().enumerate() {
            let sk = format!("{LINK_PREFIX}{i:04}");
            let mut link_item = std::collections::HashMap::new();
            link_item.insert("pk".to_string(), AttributeValue::S(pk.clone()));
            link_item.insert("sk".to_string(), AttributeValue::S(sk));
            link_item.insert(
                "platform".to_string(),
                AttributeValue::S(
                    serde_json::to_string(&link.platform)
                        .unwrap_or_else(|_| "\"custom\"".to_string())
                        .trim_matches('"')
                        .to_string(),
                ),
            );
            link_item.insert("url".to_string(), AttributeValue::S(link.url.clone()));
            if let Some(ref label) = link.label {
                link_item.insert("label".to_string(), AttributeValue::S(label.clone()));
            }

            self.dynamo
                .put_item()
                .table_name(&self.table_name)
                .set_item(Some(link_item))
                .send()
                .await
                .map_err(|e| AppError::Internal(format!("DynamoDB put link failed: {e}")))?;
        }

        // Return the full profile (self-view — the caller is the owner,
        // authorization was already checked by the router before calling
        // this method).
        self.get_profile_full(&profile_id).await
    }

    /// Delete a profile, all its link items, and its `EMAIL#` pointer.
    pub async fn delete_profile(&self, email: &str) -> Result<(), AppError> {
        let profile_id = self
            .get_profile_id_for_email(email)
            .await?
            .ok_or(AppError::NotFound)?;
        let pk = format!("PROFILE#{profile_id}");

        // Query all items for this profile
        let result = self
            .dynamo
            .query()
            .table_name(&self.table_name)
            .key_condition_expression("pk = :pk")
            .expression_attribute_values(":pk", AttributeValue::S(pk.clone()))
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("DynamoDB query failed: {e}")))?;

        let items = result.items();
        if items.is_empty() {
            return Err(AppError::NotFound);
        }

        // Delete all items
        for item in items {
            let sk = item
                .get("sk")
                .cloned()
                .unwrap_or_else(|| AttributeValue::S(String::new()));

            self.dynamo
                .delete_item()
                .table_name(&self.table_name)
                .key("pk", AttributeValue::S(pk.clone()))
                .key("sk", sk)
                .send()
                .await
                .map_err(|e| AppError::Internal(format!("DynamoDB delete failed: {e}")))?;
        }

        // Delete the EMAIL# pointer so a future signup gets a fresh
        // randomly-assigned ID rather than reusing the deleted one.
        self.dynamo
            .delete_item()
            .table_name(&self.table_name)
            .key("pk", AttributeValue::S(Self::email_pk(email)))
            .key("sk", AttributeValue::S(EMAIL_POINTER_SK.to_string()))
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("DynamoDB pointer delete failed: {e}")))?;

        // Delete profile image from S3 if it exists
        let image_key = format!("images/{profile_id}");
        let _ = self
            .s3
            .delete_object()
            .bucket(&self.bucket_name)
            .key(&image_key)
            .send()
            .await;

        Ok(())
    }

    /// Upload a profile image to S3.
    ///
    /// The declared `content_type` from the client is never trusted for
    /// storage — we sniff the actual image bytes (magic numbers) and only
    /// accept a fixed allow-list of raster formats. This prevents uploading
    /// SVG/HTML/script content mislabeled as an image, which could lead to
    /// stored XSS if the bucket or serving path is ever misconfigured.
    pub async fn upload_image(
        &self,
        email: &str,
        image_data: &[u8],
        content_type: &str,
    ) -> Result<String, AppError> {
        let profile_id = self.get_or_create_profile_id_for_email(email).await?;
        let image_key = format!("images/{profile_id}");

        // Validate size (4MB max)
        const MAX_IMAGE_SIZE: usize = 4 * 1024 * 1024;
        if image_data.len() > MAX_IMAGE_SIZE {
            return Err(AppError::PayloadTooLarge(format!(
                "Image size {} bytes exceeds maximum of {} bytes",
                image_data.len(),
                MAX_IMAGE_SIZE
            )));
        }

        // Sniff the real content type from the file's magic bytes. Reject
        // anything outside our raster-image allow-list (SVG, HTML, etc. are
        // never allowed, regardless of what content_type the client sent).
        let sniffed_content_type = sniff_image_content_type(image_data).ok_or_else(|| {
            AppError::BadRequest(
                "Unsupported image format. Only JPEG, PNG, and WebP are allowed.".to_string(),
            )
        })?;

        // The client-declared content_type must agree with the sniffed type,
        // otherwise reject — this catches mismatched extensions/labels.
        if !content_type_matches(content_type, sniffed_content_type) {
            return Err(AppError::BadRequest(
                "Declared content type does not match image data".to_string(),
            ));
        }

        // Upload to S3 using the sniffed (trusted) content type, never the
        // client-supplied string.
        self.s3
            .put_object()
            .bucket(&self.bucket_name)
            .key(&image_key)
            .body(image_data.to_vec().into())
            .content_type(sniffed_content_type)
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("S3 upload failed: {e}")))?;

        // Update the profile item with the image key
        let pk = format!("PROFILE#{profile_id}");
        self.dynamo
            .update_item()
            .table_name(&self.table_name)
            .key("pk", AttributeValue::S(pk))
            .key("sk", AttributeValue::S(PROFILE_SK.to_string()))
            .update_expression("SET image_key = :ik, updated_at = :ua")
            .expression_attribute_values(":ik", AttributeValue::S(image_key.clone()))
            .expression_attribute_values(":ua", AttributeValue::S(chrono_now()))
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("DynamoDB update failed: {e}")))?;

        let image_url = format!("{}/{}", self.image_base_url, image_key);
        Ok(image_url)
    }

    /// Delete all link items for a given PK.
    async fn delete_links(&self, pk: &str) -> Result<(), AppError> {
        let result = self
            .dynamo
            .query()
            .table_name(&self.table_name)
            .key_condition_expression("pk = :pk AND begins_with(sk, :prefix)")
            .expression_attribute_values(":pk", AttributeValue::S(pk.to_string()))
            .expression_attribute_values(":prefix", AttributeValue::S(LINK_PREFIX.to_string()))
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("DynamoDB query failed: {e}")))?;

        for item in result.items() {
            let sk = item
                .get("sk")
                .cloned()
                .unwrap_or_else(|| AttributeValue::S(String::new()));

            self.dynamo
                .delete_item()
                .table_name(&self.table_name)
                .key("pk", AttributeValue::S(pk.to_string()))
                .key("sk", sk)
                .send()
                .await
                .map_err(|e| AppError::Internal(format!("DynamoDB delete link failed: {e}")))?;
        }

        Ok(())
    }
}

fn parse_link_item(item: &std::collections::HashMap<String, AttributeValue>) -> Option<SocialLink> {
    let platform_str = get_string(item, "platform")?;
    let url = get_string(item, "url")?;
    let label = get_string(item, "label");

    let platform: SocialPlatform =
        serde_json::from_str(&format!("\"{platform_str}\"")).unwrap_or(SocialPlatform::Custom);

    Some(SocialLink {
        platform,
        url,
        label,
    })
}

fn get_string(
    item: &std::collections::HashMap<String, AttributeValue>,
    key: &str,
) -> Option<String> {
    item.get(key).and_then(|v| v.as_s().ok()).cloned()
}

/// Inspects the leading bytes of image data and returns the sniffed MIME
/// type if it matches one of our allowed raster formats. Returns `None` for
/// anything else (including SVG, HTML, or any other file type) — this is a
/// strict allow-list, not a blocklist.
fn sniff_image_content_type(data: &[u8]) -> Option<&'static str> {
    const JPEG_MAGIC: &[u8] = &[0xFF, 0xD8, 0xFF];
    const PNG_MAGIC: &[u8] = &[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    const WEBP_RIFF: &[u8] = b"RIFF";
    const WEBP_MAGIC: &[u8] = b"WEBP";

    if data.starts_with(JPEG_MAGIC) {
        return Some("image/jpeg");
    }

    if data.starts_with(PNG_MAGIC) {
        return Some("image/png");
    }

    // WebP: "RIFF" + 4-byte size + "WEBP"
    if data.len() >= 12 && data.starts_with(WEBP_RIFF) && &data[8..12] == WEBP_MAGIC {
        return Some("image/webp");
    }

    None
}

/// Checks whether a client-declared content type is consistent with the
/// sniffed (trusted) content type. Allows minor variations like
/// "image/jpg" vs "image/jpeg".
fn content_type_matches(declared: &str, sniffed: &str) -> bool {
    let declared = declared.trim().to_lowercase();
    match sniffed {
        "image/jpeg" => declared == "image/jpeg" || declared == "image/jpg",
        other => declared == other,
    }
}

/// Returns current UTC timestamp in ISO 8601 format.
/// Using a simple approach without chrono dependency.
fn chrono_now() -> String {
    // We'll use std::time for a UTC timestamp
    use std::time::{SystemTime, UNIX_EPOCH};
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = duration.as_secs();

    // Simple ISO 8601 UTC format
    let days = secs / 86400;
    let remaining = secs % 86400;
    let hours = remaining / 3600;
    let minutes = (remaining % 3600) / 60;
    let seconds = remaining % 60;

    // Calculate year, month, day from days since epoch
    let (year, month, day) = days_to_date(days);

    format!("{year:04}-{month:02}-{day:02}T{hours:02}:{minutes:02}:{seconds:02}Z")
}

/// Convert days since Unix epoch to (year, month, day).
fn days_to_date(days: u64) -> (u64, u64, u64) {
    // Algorithm from http://howardhinnant.github.io/date_algorithms.html
    let z = days + 719468;
    let era = z / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };
    (year, m, d)
}

#[cfg(test)]
mod email_pk_tests {
    use super::ProfileStore;

    #[test]
    fn lowercases_and_trims() {
        assert_eq!(
            ProfileStore::email_pk("  Test@Example.COM  "),
            "EMAIL#test@example.com"
        );
    }

    #[test]
    fn is_deterministic() {
        assert_eq!(
            ProfileStore::email_pk("test@example.com"),
            ProfileStore::email_pk("Test@Example.com")
        );
    }
}

#[cfg(test)]
mod image_validation_tests {
    use super::*;

    #[test]
    fn sniffs_jpeg_magic_bytes() {
        let data = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10];
        assert_eq!(sniff_image_content_type(&data), Some("image/jpeg"));
    }

    #[test]
    fn sniffs_png_magic_bytes() {
        let data = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00];
        assert_eq!(sniff_image_content_type(&data), Some("image/png"));
    }

    #[test]
    fn sniffs_webp_magic_bytes() {
        let mut data = b"RIFF".to_vec();
        data.extend_from_slice(&[0, 0, 0, 0]); // size (unused by sniffer)
        data.extend_from_slice(b"WEBP");
        assert_eq!(sniff_image_content_type(&data), Some("image/webp"));
    }

    #[test]
    fn rejects_svg_disguised_as_image() {
        let data = b"<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>";
        assert_eq!(sniff_image_content_type(data), None);
    }

    #[test]
    fn rejects_html_content() {
        let data = b"<html><body><script>alert(1)</script></body></html>";
        assert_eq!(sniff_image_content_type(data), None);
    }

    #[test]
    fn rejects_empty_data() {
        assert_eq!(sniff_image_content_type(&[]), None);
    }

    #[test]
    fn rejects_truncated_webp_header() {
        // Starts with RIFF but too short to contain the WEBP marker.
        let data = b"RIFF\x00\x00";
        assert_eq!(sniff_image_content_type(data), None);
    }

    #[test]
    fn content_type_matches_exact() {
        assert!(content_type_matches("image/png", "image/png"));
        assert!(content_type_matches("image/webp", "image/webp"));
    }

    #[test]
    fn content_type_matches_jpeg_jpg_alias() {
        assert!(content_type_matches("image/jpg", "image/jpeg"));
        assert!(content_type_matches("IMAGE/JPEG", "image/jpeg"));
    }

    #[test]
    fn content_type_rejects_mismatch() {
        assert!(!content_type_matches("image/png", "image/jpeg"));
        assert!(!content_type_matches("image/svg+xml", "image/png"));
    }
}
