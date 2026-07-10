# ADR-002: Rust for Backend Lambda Functions

## Status

Accepted

## Context

We need a backend language for Lambda handlers that offers fast cold starts, low memory usage, strong type safety, and high performance. These properties directly reduce cost on a serverless platform.

## Decision

All backend Lambda functions will be written in Rust, compiled with `cargo-lambda` targeting `aarch64-unknown-linux-gnu` (ARM/Graviton). We will use `aws-sdk-rust` for AWS service calls and `serde` for serialization.

## Consequences

- Sub-10ms cold starts typical for Rust Lambdas on ARM.
- Memory safety without a garbage collector.
- Steeper learning curve for contributors unfamiliar with Rust.
- `cargo-lambda` provides a smooth local dev and deployment story.
- ARM Lambdas are ~20% cheaper than x86 equivalents.
