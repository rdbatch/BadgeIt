# ADR-003: AWS CDK in TypeScript for Infrastructure

## Status

Accepted

## Context

We need an infrastructure-as-code solution that integrates well with AWS, supports strong typing, and allows us to define reusable constructs. The frontend team already uses TypeScript, making it a natural choice for CDK as well.

## Decision

All infrastructure will be defined using AWS CDK in TypeScript. The CDK app lives in `infra/` with separate stacks per concern. Tests use `aws-cdk-lib/assertions` via Jest.

## Consequences

- Type-safe infrastructure definitions.
- Shared language knowledge with the frontend.
- Rich L2 construct library reduces boilerplate.
- CDK synth/diff provides a review-friendly change preview.
- Must keep CDK version pinned and updated intentionally.
