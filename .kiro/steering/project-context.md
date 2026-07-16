# BadgeTag — Project Context

## Overview

BadgeTag is a lightweight, fully serverless web application deployed on AWS.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + TypeScript |
| Backend | Rust (compiled to AWS Lambda via `cargo-lambda`) |
| Infrastructure | AWS CDK (TypeScript) |
| Runtime | 100% serverless — Lambda, API Gateway, DynamoDB, S3, CloudFront |

## Repository Structure

```
/
├── frontend/          # React + TypeScript app (Vite)
├── backend/           # Rust workspace for Lambda handlers
├── infra/             # AWS CDK app (TypeScript)
├── docs/
│   └── adr/           # Architecture Decision Records
└── .github/           # CI/CD workflows
```

## Conventions

### General

- All code must compile/build cleanly with zero warnings before commit.
- Every public function, endpoint, and component must have tests.
- Tests must never be skipped, ignored (`#[ignore]`), or allowed to fail. A red test blocks the pipeline.
- Prefer small, focused modules over large files.
- Use conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`).

### Frontend (React + TypeScript)

- Use Vite as the build tool.
- Strict TypeScript — `strict: true` in tsconfig, no `any` unless absolutely justified with a comment.
- Functional components only, with hooks.
- Use React Testing Library + Vitest for unit/integration tests.
- CSS: CSS Modules or Tailwind CSS (decide in ADR).
- All user-facing text must be accessible (semantic HTML, ARIA where needed).

### Backend (Rust)

- Target `aarch64-unknown-linux-gnu` (Graviton/ARM Lambda) for cost and performance.
- Use `cargo-lambda` for build and local invocation.
- Use `aws-sdk-rust` for AWS service interactions.
- Use `serde` for serialization, `thiserror` for error types.
- Run `cargo clippy -- -D warnings` and `cargo fmt --check` before every commit.
- Unit tests live in the same file (`#[cfg(test)]` modules). Integration tests in `tests/`.
- No `unwrap()` in production code — use `?` and proper error handling.

### Infrastructure (CDK — TypeScript)

- One CDK app with separate stacks per concern (e.g., `ApiStack`, `FrontendStack`, `DataStack`).
- Use L2 constructs where available; drop to L1 only when necessary.
- Tag all resources with `project=badgetag` and `environment={dev|staging|prod}`.
- CDK tests use the built-in assertions library (`aws-cdk-lib/assertions`).
- No hardcoded account IDs or secrets — use CDK context, SSM, or Secrets Manager.

## Testing Strategy

| Layer | Framework | Expectation |
|-------|-----------|-------------|
| Frontend | Vitest + React Testing Library | Unit + integration tests for all components and hooks |
| Backend | `cargo test` | Unit tests per module, integration tests per handler |
| Infra | CDK assertions (Jest) | Snapshot + fine-grained assertion tests per stack |
| E2E | Playwright (future) | Critical user flows |

**Zero-tolerance policy:** CI must run all tests on every PR. A failing test blocks merge. Tests must not be marked as `skip`, `ignore`, `xit`, or `test.todo` without a linked tracking issue and an expiration date.

## AWS Services (Serverless Only)

Permitted services (extend via ADR):

- AWS Lambda (Rust on ARM/Graviton)
- Amazon API Gateway (HTTP API)
- Amazon DynamoDB
- Amazon S3
- Amazon CloudFront
- Amazon Cognito (if auth is needed)
- AWS SQS / EventBridge (if async processing is needed)
- AWS Secrets Manager / SSM Parameter Store

**Not permitted** without an ADR: EC2, ECS, EKS, RDS, ElastiCache, or any always-on compute.

## Decision Records

Architectural decisions are tracked in `docs/adr/`. Use the template in `docs/adr/000-template.md`.
