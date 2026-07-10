//! Cognito Pre Sign-up trigger Lambda.
//!
//! Auto-confirms new users and marks their email as verified so that
//! email OTP is immediately available on their first authentication
//! attempt. This is safe because the OTP delivery itself proves email
//! ownership — no separate confirmation step is needed.

use lambda_runtime::{Error, LambdaEvent, service_fn};
use serde_json::Value;
use tracing_subscriber::EnvFilter;

async fn handler(event: LambdaEvent<Value>) -> Result<Value, Error> {
    let (mut event, _context) = event.into_parts();

    // Set auto-confirm and auto-verify on the response object.
    // Cognito expects the entire event back with `response` fields set.
    let response = event
        .get_mut("response")
        .and_then(|r| r.as_object_mut())
        .expect("Cognito event must contain a response object");

    response.insert("autoConfirmUser".to_string(), Value::Bool(true));
    response.insert("autoVerifyEmail".to_string(), Value::Bool(true));

    Ok(event)
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .json()
        .init();

    lambda_runtime::run(service_fn(handler)).await
}
