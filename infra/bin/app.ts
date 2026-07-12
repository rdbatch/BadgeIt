#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { ApiStack } from "../lib/api-stack";
import { AuthStack } from "../lib/auth-stack";
import { DataStack } from "../lib/data-stack";
import { FrontendStack } from "../lib/frontend-stack";

const app = new cdk.App();

const environment = app.node.tryGetContext("environment") ?? "dev";
const region = app.node.tryGetContext("region");

if (!region) {
  throw new Error(
    'CDK context "region" is required. Pass it via: --context region=<aws-region>\n' +
      "Example: npx cdk deploy --context region=us-west-2 --context environment=dev",
  );
}

const commonTags = {
  project: "badgeit",
  environment,
};

const stackEnv: cdk.Environment = {
  region,
  // Account is resolved from the default AWS CLI/SDK credentials if not
  // explicitly provided via context. This ensures region-aware tokens
  // (like Aws.ACCOUNT_ID in bucket names) resolve correctly at synth.
  account: (app.node.tryGetContext("account") as string | undefined) ??
    process.env.CDK_DEFAULT_ACCOUNT,
};

const dataStack = new DataStack(app, `BadgeIt-Data-${environment}`, {
  tags: commonTags,
  env: stackEnv,
});

const authStack = new AuthStack(app, `BadgeIt-Auth-${environment}`, {
  tags: commonTags,
  env: stackEnv,
  // Each environment sends from its own (sub)domain so SES sending
  // reputation and bounce/complaint handling stay isolated per environment
  // (a dev deliverability issue should never affect prod). Override via
  // --context sesDomainName=<domain> if needed (e.g. a PR/preview env).
  sesDomainName:
    (app.node.tryGetContext("sesDomainName") as string | undefined) ??
    (environment === "prod" ? "badgeit.app" : `${environment}.badgeit.app`),
});

// Computed once and shared: FrontendStack's custom domain (once configured)
// is also the app's public origin, which ApiStack needs to build absolute
// og:url/og:image values for its crawler-facing /__og/profile/{id} route.
const domainNames = (app.node.tryGetContext("domainName") as string | undefined)
  ?.split(",")
  .map((domain) => domain.trim())
  .filter(Boolean);
const siteUrl = domainNames?.[0] ? `https://${domainNames[0]}` : undefined;

const apiStack = new ApiStack(app, `BadgeIt-Api-${environment}`, {
  tags: commonTags,
  env: stackEnv,
  environment,
  // Set via `--context allowedOrigins=https://foo.com,https://bar.com` for
  // local dev against a deployed API. Empty by default — the production
  // frontend calls /api/* same-origin through CloudFront.
  allowedOrigins: (app.node.tryGetContext("allowedOrigins") as string | undefined)
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  siteUrl,
});
// DataStack's table/imageBucket and AuthStack's Cognito identifiers are
// resolved via SSM Parameter Store (see dataStackParamPaths in
// data-stack.ts and authStackParamPaths in auth-stack.ts) rather than
// direct construct references, so no CloudFormation Fn::ImportValue
// dependency is created on either stack. We still declare the dependency
// explicitly here to ensure their SSM parameters are deployed/updated
// before ApiStack tries to read them.
apiStack.addDependency(dataStack);
apiStack.addDependency(authStack);

const frontendStack = new FrontendStack(app, `BadgeIt-Frontend-${environment}`, {
  tags: commonTags,
  env: stackEnv,
  environment,
  // Custom domain — unset until a domain is registered and an ACM
  // certificate (in us-east-1) is provisioned for it. Once ready:
  //   cdk deploy BadgeIt-Frontend-<env> \
  //     --context domainName=badgeit.com \
  //     --context certificateArn=arn:aws:acm:us-east-1:<account>:certificate/<id>
  // domainName may be a comma-separated list (e.g. "badgeit.com,www.badgeit.com").
  domainNames,
  certificateArn: app.node.tryGetContext("certificateArn") as string | undefined,
});
// ApiStack's API URL and DataStack's image bucket are resolved via SSM
// (see apiStackParamPaths / dataStackParamPaths) — no Fn::ImportValue.
// Dependencies kept for SSM parameter deploy ordering only.
frontendStack.addDependency(apiStack);
frontendStack.addDependency(dataStack);

app.synth();
