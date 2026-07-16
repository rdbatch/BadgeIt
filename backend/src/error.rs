use aws_lambda_events::apigw::ApiGatewayV2httpResponse;
use aws_lambda_events::encodings::Body;
use aws_lambda_events::http::HeaderMap;

/// Application-level errors for the BadgeTag API.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Profile not found")]
    NotFound,

    #[error("Bad request: {0}")]
    BadRequest(String),

    #[error("Unauthorized")]
    Unauthorized,

    #[error("Forbidden")]
    Forbidden,

    #[error("Payload too large: {0}")]
    PayloadTooLarge(String),

    #[error("Conflict: {0}")]
    Conflict(String),

    #[error("Internal error: {0}")]
    Internal(String),
}

impl AppError {
    pub fn status_code(&self) -> i64 {
        match self {
            Self::NotFound => 404,
            Self::BadRequest(_) => 400,
            Self::Unauthorized => 401,
            Self::Forbidden => 403,
            Self::PayloadTooLarge(_) => 413,
            Self::Conflict(_) => 409,
            Self::Internal(_) => 500,
        }
    }

    pub fn to_response(&self) -> ApiGatewayV2httpResponse {
        let mut headers = HeaderMap::new();
        headers.insert(
            "content-type",
            "application/json".parse().expect("valid header"),
        );

        let body = serde_json::json!({
            "error": self.to_string(),
        });

        ApiGatewayV2httpResponse {
            status_code: self.status_code(),
            body: Some(Body::Text(body.to_string())),
            headers,
            ..Default::default()
        }
    }
}

impl From<aws_sdk_dynamodb::Error> for AppError {
    fn from(err: aws_sdk_dynamodb::Error) -> Self {
        tracing::error!(?err, "DynamoDB error");
        Self::Internal("Database error".to_string())
    }
}

impl From<aws_sdk_s3::Error> for AppError {
    fn from(err: aws_sdk_s3::Error) -> Self {
        tracing::error!(?err, "S3 error");
        Self::Internal("Storage error".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn not_found_returns_404() {
        let err = AppError::NotFound;
        assert_eq!(err.status_code(), 404);
    }

    #[test]
    fn bad_request_returns_400() {
        let err = AppError::BadRequest("missing field".to_string());
        assert_eq!(err.status_code(), 400);
    }

    #[test]
    fn unauthorized_returns_401() {
        let err = AppError::Unauthorized;
        assert_eq!(err.status_code(), 401);
    }

    #[test]
    fn payload_too_large_returns_413() {
        let err = AppError::PayloadTooLarge("exceeds 4MB".to_string());
        assert_eq!(err.status_code(), 413);
    }

    #[test]
    fn conflict_returns_409() {
        let err = AppError::Conflict("slug already taken".to_string());
        assert_eq!(err.status_code(), 409);
    }

    #[test]
    fn error_response_is_valid_json() {
        let err = AppError::NotFound;
        let resp = err.to_response();
        assert_eq!(resp.status_code, 404);
        if let Some(Body::Text(body)) = &resp.body {
            let parsed: serde_json::Value = serde_json::from_str(body).expect("valid json");
            assert_eq!(parsed["error"], "Profile not found");
        } else {
            panic!("Expected text body");
        }
    }
}
