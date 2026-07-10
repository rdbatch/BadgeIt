use aws_lambda_events::apigw::{ApiGatewayV2httpRequest, ApiGatewayV2httpResponse};
use aws_lambda_events::encodings::Body;
use aws_lambda_events::http::HeaderMap;
use base64::Engine;

use crate::auth::{AuthConfig, authorize_profile_access, validate_token};
use crate::error::AppError;
use crate::models::{
    ImageUploadRequest, ImageUploadResponse, ProfileDeleteRequest, ProfileUpdateRequest,
};
use crate::store::ProfileStore;

/// Route an incoming API Gateway request to the appropriate handler.
pub async fn route(
    event: &ApiGatewayV2httpRequest,
    store: &ProfileStore,
    auth_config: &AuthConfig,
) -> ApiGatewayV2httpResponse {
    let method = event.request_context.http.method.as_str();

    let path = event
        .raw_path
        .as_deref()
        .or(event.request_context.http.path.as_deref())
        .unwrap_or("/");

    tracing::info!(method, path, "Routing request");

    let result = match (method, path) {
        ("GET", "/api/profile/me") => handle_get_own_profile(event, store, auth_config).await,
        ("GET", p) if p.starts_with("/api/profile/") => {
            let id = p.strip_prefix("/api/profile/").unwrap_or_default();
            handle_get_profile(id, store).await
        }
        ("PUT", "/api/profile") => handle_upsert_profile(event, store, auth_config).await,
        ("DELETE", "/api/profile") => handle_delete_profile(event, store, auth_config).await,
        ("POST", "/api/profile/image") => handle_upload_image(event, store, auth_config).await,
        _ => Err(AppError::NotFound),
    };

    match result {
        Ok(response) => response,
        Err(err) => err.to_response(),
    }
}

/// GET /api/profile/{id} — public, no auth required
async fn handle_get_profile(
    id: &str,
    store: &ProfileStore,
) -> Result<ApiGatewayV2httpResponse, AppError> {
    if id.is_empty() {
        return Err(AppError::BadRequest("Profile ID is required".to_string()));
    }

    let profile = store.get_profile(id).await?;
    json_response(200, &profile)
}

/// GET /api/profile/me — authenticated, returns the caller's own profile
/// in full (including `email`, `phone`, and the `display_email` flag
/// itself, regardless of its value) so the edit page has everything it
/// needs to render and let the owner change their visibility settings.
/// 404 if the authenticated user has no profile yet (frontend already
/// treats a non-ok response as "new user, leave the form blank").
async fn handle_get_own_profile(
    event: &ApiGatewayV2httpRequest,
    store: &ProfileStore,
    auth_config: &AuthConfig,
) -> Result<ApiGatewayV2httpResponse, AppError> {
    let token_email = validate_token(event, auth_config).await?;
    let profile = store.get_profile_by_email(&token_email).await?;
    json_response(200, &profile)
}

/// PUT /api/profile — authenticated, user can only modify their own profile
async fn handle_upsert_profile(
    event: &ApiGatewayV2httpRequest,
    store: &ProfileStore,
    auth_config: &AuthConfig,
) -> Result<ApiGatewayV2httpResponse, AppError> {
    let token_email = validate_token(event, auth_config).await?;

    let body = get_request_body(event)?;
    let req: ProfileUpdateRequest = serde_json::from_str(&body)
        .map_err(|e| AppError::BadRequest(format!("Invalid request body: {e}")))?;

    if req.email.is_empty() {
        return Err(AppError::BadRequest("Email is required".to_string()));
    }

    req.validate().map_err(AppError::BadRequest)?;

    // Ensure user can only modify their own profile
    authorize_profile_access(&token_email, &req.email)?;

    let profile = store.upsert_profile(&req).await?;
    json_response(200, &profile)
}

/// DELETE /api/profile — authenticated, user can only delete their own profile
async fn handle_delete_profile(
    event: &ApiGatewayV2httpRequest,
    store: &ProfileStore,
    auth_config: &AuthConfig,
) -> Result<ApiGatewayV2httpResponse, AppError> {
    let token_email = validate_token(event, auth_config).await?;

    let body = get_request_body(event)?;
    let req: ProfileDeleteRequest = serde_json::from_str(&body)
        .map_err(|e| AppError::BadRequest(format!("Invalid request body: {e}")))?;

    if req.email.is_empty() {
        return Err(AppError::BadRequest("Email is required".to_string()));
    }

    // Ensure user can only delete their own profile
    authorize_profile_access(&token_email, &req.email)?;

    store.delete_profile(&req.email).await?;

    let mut headers = HeaderMap::new();
    headers.insert(
        "content-type",
        "application/json".parse().expect("valid header"),
    );

    Ok(ApiGatewayV2httpResponse {
        status_code: 204,
        body: None,
        headers,
        ..Default::default()
    })
}

/// POST /api/profile/image — authenticated, user can only upload to their own profile
async fn handle_upload_image(
    event: &ApiGatewayV2httpRequest,
    store: &ProfileStore,
    auth_config: &AuthConfig,
) -> Result<ApiGatewayV2httpResponse, AppError> {
    let token_email = validate_token(event, auth_config).await?;

    let body = get_request_body(event)?;
    let req: ImageUploadRequest = serde_json::from_str(&body)
        .map_err(|e| AppError::BadRequest(format!("Invalid request body: {e}")))?;

    // Decode base64 image data
    let image_bytes = base64::engine::general_purpose::STANDARD
        .decode(&req.image_data)
        .map_err(|e| AppError::BadRequest(format!("Invalid base64 image data: {e}")))?;

    let image_url = store
        .upload_image(&token_email, &image_bytes, &req.content_type)
        .await?;

    json_response(200, &ImageUploadResponse { image_url })
}

/// Extract the request body as a string, handling base64-encoded bodies.
fn get_request_body(event: &ApiGatewayV2httpRequest) -> Result<String, AppError> {
    match &event.body {
        Some(body) => {
            if event.is_base64_encoded {
                let decoded = base64::engine::general_purpose::STANDARD
                    .decode(body.as_bytes())
                    .map_err(|e| {
                        AppError::BadRequest(format!("Failed to decode base64 body: {e}"))
                    })?;
                String::from_utf8(decoded)
                    .map_err(|e| AppError::BadRequest(format!("Body is not valid UTF-8: {e}")))
            } else {
                Ok(body.clone())
            }
        }
        None => Err(AppError::BadRequest("Request body is required".to_string())),
    }
}

/// Create a JSON response with the given status code and body.
fn json_response<T: serde::Serialize>(
    status: i64,
    data: &T,
) -> Result<ApiGatewayV2httpResponse, AppError> {
    let body = serde_json::to_string(data)
        .map_err(|e| AppError::Internal(format!("Failed to serialize response: {e}")))?;

    let mut headers = HeaderMap::new();
    headers.insert(
        "content-type",
        "application/json".parse().expect("valid header"),
    );

    Ok(ApiGatewayV2httpResponse {
        status_code: status,
        body: Some(Body::Text(body)),
        headers,
        ..Default::default()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::AuthConfig;
    use crate::store::ProfileStore;

    /// Builds a `ProfileStore` backed by dummy (non-network) AWS SDK
    /// clients — sufficient for tests that only need to exercise routing
    /// and auth short-circuiting *before* any AWS call would happen.
    fn test_store() -> ProfileStore {
        let dynamo_config = aws_sdk_dynamodb::Config::builder()
            .behavior_version(aws_sdk_dynamodb::config::BehaviorVersion::latest())
            .region(aws_sdk_dynamodb::config::Region::new("us-east-1"))
            .credentials_provider(aws_sdk_dynamodb::config::Credentials::for_tests())
            .build();
        let s3_config = aws_sdk_s3::Config::builder()
            .behavior_version(aws_sdk_s3::config::BehaviorVersion::latest())
            .region(aws_sdk_s3::config::Region::new("us-east-1"))
            .credentials_provider(aws_sdk_s3::config::Credentials::for_tests())
            .build();

        ProfileStore::new(
            aws_sdk_dynamodb::Client::from_conf(dynamo_config),
            aws_sdk_s3::Client::from_conf(s3_config),
            "test-table".to_string(),
            "test-bucket".to_string(),
            "".to_string(),
        )
    }

    fn test_auth_config() -> AuthConfig {
        AuthConfig::new(
            "us-east-1_ABC123".to_string(),
            "us-east-1".to_string(),
            "test-client-id".to_string(),
        )
    }

    #[test]
    fn route_path_extraction() {
        let path = "/api/profile/abc123def456";
        let id = path.strip_prefix("/api/profile/").unwrap_or_default();
        assert_eq!(id, "abc123def456");
    }

    #[test]
    fn route_path_empty_id() {
        let path = "/api/profile/";
        let id = path.strip_prefix("/api/profile/").unwrap_or_default();
        assert_eq!(id, "");
    }

    #[tokio::test]
    async fn me_route_requires_auth() {
        let event = ApiGatewayV2httpRequest {
            raw_path: Some("/api/profile/me".to_string()),
            request_context: aws_lambda_events::apigw::ApiGatewayV2httpRequestContext {
                http: aws_lambda_events::apigw::ApiGatewayV2httpRequestContextHttpDescription {
                    method: aws_lambda_events::http::Method::GET,
                    ..Default::default()
                },
                ..Default::default()
            },
            ..Default::default()
        };
        let store = test_store();
        let auth_config = test_auth_config();
        let response = route(&event, &store, &auth_config).await;
        // No Authorization header — must be rejected before ever reaching
        // the store, and must not fall through to the public /{id} handler.
        assert_eq!(response.status_code, 401);
    }

    #[test]
    fn json_response_produces_valid_output() {
        let data = serde_json::json!({"message": "ok"});
        let resp = json_response(200, &data).expect("should succeed");
        assert_eq!(resp.status_code, 200);
        if let Some(Body::Text(body)) = &resp.body {
            assert!(body.contains("message"));
            assert!(body.contains("ok"));
        } else {
            panic!("Expected text body");
        }
    }

    #[test]
    fn get_request_body_returns_error_when_none() {
        let event = ApiGatewayV2httpRequest {
            body: None,
            ..Default::default()
        };
        let result = get_request_body(&event);
        assert!(result.is_err());
    }

    #[test]
    fn get_request_body_returns_plain_text() {
        let event = ApiGatewayV2httpRequest {
            body: Some(r#"{"email":"test@example.com"}"#.to_string()),
            is_base64_encoded: false,
            ..Default::default()
        };
        let result = get_request_body(&event).expect("should succeed");
        assert_eq!(result, r#"{"email":"test@example.com"}"#);
    }

    #[test]
    fn get_request_body_decodes_base64() {
        let original = r#"{"email":"test@example.com"}"#;
        let encoded = base64::engine::general_purpose::STANDARD.encode(original);
        let event = ApiGatewayV2httpRequest {
            body: Some(encoded),
            is_base64_encoded: true,
            ..Default::default()
        };
        let result = get_request_body(&event).expect("should succeed");
        assert_eq!(result, original);
    }
}
