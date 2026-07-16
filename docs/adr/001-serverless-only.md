# ADR-001: Fully Serverless Architecture

## Status

Accepted

## Context

BadgeTag is a lightweight web application that does not require always-on compute. We want to minimize operational overhead, scale to zero when idle, and pay only for actual usage.

## Decision

All backend compute will use AWS Lambda. All data storage will use managed serverless services (DynamoDB, S3). The frontend will be served via S3 + CloudFront. No EC2, ECS, EKS, RDS, or other always-on services are permitted without a new ADR.

## Consequences

- Lower operational cost at low-to-moderate traffic.
- No servers to patch or manage.
- Cold starts are a consideration — mitigated by using Rust (fast cold starts) on ARM/Graviton.
- Maximum single-request duration limited to 15 minutes (Lambda limit).
- Must design around Lambda's stateless execution model.
