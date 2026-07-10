<div align="center">
  <img src="docs/assets/logo.svg" width="120" height="120" alt="BadgeIt logo" />

  # BadgeIt

  A lightweight digital business card. Sign in, build a themeable profile with your social links, and share it instantly via a link or QR code.
</div>

## What it does

BadgeIt gives you a personal profile page (`/p/:id`) with your name, bio, social
links, and a pick of color themes. Sign in with a passwordless, email-code flow,
edit your card, and share it with a scannable QR code (perfect for networking at conferences)!

## Tech stack

| Layer          | Technology                                              |
| -------------- | -------------------------------------------------------- |
| Frontend       | React + TypeScript (Vite, Tailwind CSS)                  |
| Backend        | Rust, compiled to AWS Lambda via `cargo-lambda`           |
| Infrastructure | AWS CDK (TypeScript)                                      |
| Runtime        | Fully serverless — Lambda, API Gateway, DynamoDB, S3, CloudFront, Cognito |


## Getting started

### Frontend

```bash
cd frontend
npm install
npm run dev
```

### Backend

Requires the `aarch64-unknown-linux-gnu` target and [`cargo-lambda`](https://www.cargo-lambda.info/):

```bash
cd backend
cargo test
cargo lambda build --release --arm64 --bin api --bin pre_sign_up
```

### Infrastructure

```bash
cd infra
npm install
npx cdk synth --context environment=dev --context region=<aws-region>
```

## Testing

| Layer    | Command                    |
| -------- | --------------------------- |
| Frontend | `npm run test` (Vitest)     |
| Backend  | `cargo test`                |
| Infra    | `npm run test` (CDK/Jest)   |

CI runs all three on every push and pull request (see `.github/workflows/build.yml`).
