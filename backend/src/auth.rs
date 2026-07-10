use std::sync::Arc;
use std::time::{Duration, Instant};

use aws_lambda_events::apigw::ApiGatewayV2httpRequest;
use jsonwebtoken::jwk::JwkSet;
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode, decode_header};
use serde::Deserialize;
use tokio::sync::RwLock;

use crate::error::AppError;

/// Claims extracted from a Cognito JWT token.
#[derive(Debug, Deserialize)]
pub struct CognitoClaims {
    /// User's email address (present on the ID token).
    pub email: Option<String>,
    /// Token use ("id" or "access").
    pub token_use: Option<String>,
    /// Subject (user ID).
    pub sub: String,
    /// Issuer (should match Cognito User Pool URL).
    pub iss: Option<String>,
    /// Audience — for ID tokens this is the app client ID.
    pub aud: Option<String>,
    /// Client ID — present on access tokens instead of `aud`.
    pub client_id: Option<String>,
}

/// How long a fetched JWKS is considered fresh before we refetch.
const JWKS_CACHE_TTL: Duration = Duration::from_secs(3600);

/// Caches the Cognito JWKS in memory across warm Lambda invocations.
#[derive(Default)]
struct JwksCache {
    inner: RwLock<Option<(Instant, Arc<JwkSet>)>>,
}

impl JwksCache {
    async fn get(&self, jwks_url: &str) -> Result<Arc<JwkSet>, AppError> {
        {
            let guard = self.inner.read().await;
            if let Some((fetched_at, jwks)) = guard.as_ref()
                && fetched_at.elapsed() < JWKS_CACHE_TTL
            {
                return Ok(jwks.clone());
            }
        }

        let jwks = fetch_jwks(jwks_url).await?;
        let jwks = Arc::new(jwks);

        let mut guard = self.inner.write().await;
        *guard = Some((Instant::now(), jwks.clone()));
        Ok(jwks)
    }
}

async fn fetch_jwks(jwks_url: &str) -> Result<JwkSet, AppError> {
    let response = reqwest::get(jwks_url).await.map_err(|e| {
        tracing::error!("Failed to fetch JWKS: {e}");
        AppError::Internal("Failed to fetch signing keys".to_string())
    })?;

    let jwks: JwkSet = response.json().await.map_err(|e| {
        tracing::error!("Failed to parse JWKS response: {e}");
        AppError::Internal("Failed to parse signing keys".to_string())
    })?;

    Ok(jwks)
}

/// Configuration for JWT validation.
#[derive(Clone)]
pub struct AuthConfig {
    /// Cognito User Pool ID (e.g., us-east-1_XXXXXXXX).
    pub user_pool_id: String,
    /// AWS region.
    pub region: String,
    /// App client ID that tokens must be issued for.
    pub client_id: String,
    /// In-memory JWKS cache, shared across invocations on a warm Lambda.
    jwks_cache: Arc<JwksCache>,
}

impl AuthConfig {
    pub fn new(user_pool_id: String, region: String, client_id: String) -> Self {
        Self {
            user_pool_id,
            region,
            client_id,
            jwks_cache: Arc::new(JwksCache::default()),
        }
    }

    pub fn issuer_url(&self) -> String {
        format!(
            "https://cognito-idp.{}.amazonaws.com/{}",
            self.region, self.user_pool_id
        )
    }

    pub fn jwks_url(&self) -> String {
        format!("{}/.well-known/jwks.json", self.issuer_url())
    }
}

/// Extracts and validates the email from the Authorization header JWT.
///
/// Performs full RS256 signature verification against Cognito's published
/// JWKS (fetched and cached in memory), plus issuer, audience, expiry, and
/// token_use checks.
pub async fn validate_token(
    event: &ApiGatewayV2httpRequest,
    config: &AuthConfig,
) -> Result<String, AppError> {
    let auth_header = event
        .headers
        .get("authorization")
        .or_else(|| event.headers.get("Authorization"))
        .and_then(|v| v.to_str().ok())
        .ok_or(AppError::Unauthorized)?;

    let token = auth_header
        .strip_prefix("Bearer ")
        .ok_or(AppError::Unauthorized)?;

    if token.is_empty() {
        return Err(AppError::Unauthorized);
    }

    // Decode header to verify algorithm and locate the signing key by `kid`.
    let header = decode_header(token).map_err(|e| {
        tracing::warn!("Invalid JWT header: {e}");
        AppError::Unauthorized
    })?;

    if header.alg != Algorithm::RS256 {
        tracing::warn!("Unexpected JWT algorithm: {:?}", header.alg);
        return Err(AppError::Unauthorized);
    }

    let kid = header.kid.ok_or_else(|| {
        tracing::warn!("JWT missing kid header");
        AppError::Unauthorized
    })?;

    let jwks = config.jwks_cache.get(&config.jwks_url()).await?;
    let jwk = jwks.find(&kid).ok_or_else(|| {
        tracing::warn!(kid, "No matching JWK found for kid");
        AppError::Unauthorized
    })?;

    let decoding_key = DecodingKey::from_jwk(jwk).map_err(|e| {
        tracing::error!("Failed to build decoding key from JWK: {e}");
        AppError::Unauthorized
    })?;

    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_issuer(&[config.issuer_url()]);
    validation.validate_exp = true;
    // Cognito ID tokens carry `aud`; access tokens carry `client_id` instead.
    // We validate whichever is present against our configured client ID below,
    // so we don't restrict validation's built-in `aud` check here.
    validation.validate_aud = false;

    let token_data = decode::<CognitoClaims>(token, &decoding_key, &validation).map_err(|e| {
        tracing::warn!("JWT validation failed: {e}");
        AppError::Unauthorized
    })?;

    let claims = token_data.claims;

    // Verify the token was issued for our app client.
    let audience_ok = claims.aud.as_deref() == Some(config.client_id.as_str())
        || claims.client_id.as_deref() == Some(config.client_id.as_str());
    if !audience_ok {
        tracing::warn!("JWT audience/client_id does not match configured app client");
        return Err(AppError::Unauthorized);
    }

    // Only accept ID tokens or access tokens (reject unexpected token_use).
    match claims.token_use.as_deref() {
        Some("id") | Some("access") => {}
        other => {
            tracing::warn!(?other, "Unexpected token_use claim");
            return Err(AppError::Unauthorized);
        }
    }

    let email = claims.email.ok_or_else(|| {
        tracing::warn!("JWT missing email claim");
        AppError::Unauthorized
    })?;

    if email.is_empty() {
        return Err(AppError::Unauthorized);
    }

    Ok(email)
}

/// Validates that the authenticated user (from token) has permission to modify
/// the resource identified by the given email.
pub fn authorize_profile_access(token_email: &str, resource_email: &str) -> Result<(), AppError> {
    if token_email.to_lowercase() != resource_email.to_lowercase() {
        tracing::warn!(
            token_email,
            resource_email,
            "User attempted to access another user's profile"
        );
        return Err(AppError::Forbidden);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_config() -> AuthConfig {
        AuthConfig::new(
            "us-east-1_ABC123".to_string(),
            "us-east-1".to_string(),
            "test-client-id".to_string(),
        )
    }

    #[test]
    fn auth_config_generates_correct_issuer_url() {
        let config = test_config();
        assert_eq!(
            config.issuer_url(),
            "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_ABC123"
        );
    }

    #[test]
    fn auth_config_generates_correct_jwks_url() {
        let config = test_config();
        assert_eq!(
            config.jwks_url(),
            "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_ABC123/.well-known/jwks.json"
        );
    }

    #[test]
    fn authorize_allows_same_email() {
        let result = authorize_profile_access("user@example.com", "user@example.com");
        assert!(result.is_ok());
    }

    #[test]
    fn authorize_allows_case_insensitive() {
        let result = authorize_profile_access("User@Example.COM", "user@example.com");
        assert!(result.is_ok());
    }

    #[test]
    fn authorize_rejects_different_email() {
        let result = authorize_profile_access("alice@example.com", "bob@example.com");
        assert!(result.is_err());
        if let Err(AppError::Forbidden) = result {
            // expected
        } else {
            panic!("Expected Forbidden error");
        }
    }

    #[tokio::test]
    async fn validate_token_rejects_missing_header() {
        let event = ApiGatewayV2httpRequest::default();
        let config = test_config();
        let result = validate_token(&event, &config).await;
        assert!(matches!(result, Err(AppError::Unauthorized)));
    }

    #[tokio::test]
    async fn validate_token_rejects_non_bearer() {
        let mut event = ApiGatewayV2httpRequest::default();
        event
            .headers
            .insert("authorization", "Basic abc123".parse().expect("valid"));
        let config = test_config();
        let result = validate_token(&event, &config).await;
        assert!(matches!(result, Err(AppError::Unauthorized)));
    }

    #[tokio::test]
    async fn validate_token_rejects_empty_token() {
        let mut event = ApiGatewayV2httpRequest::default();
        event
            .headers
            .insert("authorization", "Bearer ".parse().expect("valid"));
        let config = test_config();
        let result = validate_token(&event, &config).await;
        assert!(matches!(result, Err(AppError::Unauthorized)));
    }

    #[tokio::test]
    async fn validate_token_rejects_malformed_jwt() {
        let mut event = ApiGatewayV2httpRequest::default();
        event.headers.insert(
            "authorization",
            "Bearer not-a-valid-jwt".parse().expect("valid"),
        );
        let config = test_config();
        let result = validate_token(&event, &config).await;
        assert!(matches!(result, Err(AppError::Unauthorized)));
    }

    #[tokio::test]
    async fn validate_token_rejects_unsigned_forged_token() {
        // A token forged with `alg: none` (or any non-RS256 alg) must be rejected
        // before we ever attempt to fetch/validate against the JWKS.
        use base64::Engine;
        let header = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(r#"{"alg":"none","typ":"JWT"}"#);
        let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(
            r#"{"email":"attacker@example.com","sub":"x","token_use":"id","iss":"https://cognito-idp.us-east-1.amazonaws.com/us-east-1_ABC123","aud":"test-client-id"}"#,
        );
        let forged = format!("{header}.{payload}.");

        let mut event = ApiGatewayV2httpRequest::default();
        event.headers.insert(
            "authorization",
            format!("Bearer {forged}").parse().expect("valid"),
        );
        let config = test_config();
        let result = validate_token(&event, &config).await;
        assert!(matches!(result, Err(AppError::Unauthorized)));
    }
}
