import * as cdk from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as ses from "aws-cdk-lib/aws-ses";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";

/**
 * Builds the predictable SSM parameter namespace for a given environment.
 * Consumer stacks (ApiStack, FrontendStack) compute the same paths from
 * just the environment name, so they never need a direct CDK construct
 * reference to AuthStack — decoupling them from AuthStack's CloudFormation
 * lifecycle (no `Fn::ImportValue`, no hard cross-stack delete/replace
 * dependency).
 */
export function authStackParamPaths(environment: string) {
  const base = `/badgeit/${environment}/auth`;
  return {
    userPoolId: `${base}/user-pool-id`,
    userPoolClientId: `${base}/user-pool-client-id`,
  };
}

export interface AuthStackProps extends cdk.StackProps {
  /**
   * Domain to verify in SES and send auth emails from (e.g. "badgeit.app"
   * for prod, "dev.badgeit.app" for dev). Each environment uses its own
   * (sub)domain so sending reputation and bounce/complaint handling stay
   * isolated per environment.
   *
   * DNS for this domain must be manually managed (this project's domain is
   * hosted in Cloudflare, not Route 53). After deploying, find the required
   * DKIM CNAME records in the SES console (Identities → this domain → DKIM
   * tab) and add them to Cloudflare DNS as DNS-only (not proxied) records.
   */
  readonly sesDomainName: string;
  /**
   * Local part of the "from" address, e.g. "noreply" produces
   * "noreply@<sesDomainName>".
   *
   * @default "noreply"
   */
  readonly sesFromAddressLocalPart?: string;
}

/**
 * AuthStack — Cognito User Pool with native passwordless email OTP authentication.
 *
 * Email OTPs are delivered via SES (not Cognito's built-in email sender),
 * which is verified per-environment against its own (sub)domain. This is
 * required for production: Cognito's built-in sender is hard-capped at 50
 * emails/day per user pool and offers no custom "from" domain, deliverability
 * controls, or bounce/complaint visibility — all of which matter for an
 * OTP-only login flow where every sign-in depends on the email arriving.
 *
 * The USER_AUTH flow allows users to authenticate with just an email code.
 *
 * A Pre Sign-up Lambda trigger auto-confirms new users and marks their email
 * as verified so that email OTP is immediately available on first auth. This
 * is safe because the OTP *itself* proves email ownership — no separate
 * confirmation step is needed.
 */
export class AuthStack extends cdk.Stack {
  /** The Cognito User Pool */
  public readonly userPool: cognito.UserPool;

  /** The User Pool Client configured for USER_AUTH flow */
  public readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    const environment =
      this.node.tryGetContext("environment") ?? "dev";

    // SES domain identity — verifying this domain requires adding DKIM CNAME
    // records (find them in the SES console: Identities → this domain →
    // DKIM tab) to DNS. This project's domain (badgeit.app) is hosted in
    // Cloudflare, not Route 53, so records must be added manually rather
    // than via a CDK-managed hosted zone.
    const emailIdentity = new ses.EmailIdentity(this, "EmailIdentity", {
      identity: ses.Identity.domain(props.sesDomainName),
    });

    const fromAddress = `${props.sesFromAddressLocalPart ?? "noreply"}@${props.sesDomainName}`;

    // Rust Lambda for the Pre Sign-up trigger. Auto-confirms the user and
    // marks their email as verified so Cognito immediately offers EMAIL_OTP.
    const preSignUpFn = new lambda.Function(this, "PreSignUpFn", {
      functionName: `badgeit-pre-sign-up-${environment}`,
      runtime: lambda.Runtime.PROVIDED_AL2023,
      architecture: lambda.Architecture.ARM_64,
      handler: "bootstrap",
      code: lambda.Code.fromAsset("../backend/target/lambda/pre_sign_up"),
      timeout: cdk.Duration.seconds(5),
      memorySize: 128,
    });

    // Cognito User Pool with native passwordless email OTP.
    // Choice-based authentication (email OTP as first factor) requires the
    // Essentials feature plan or higher.
    this.userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: `badgeit-users-${environment}`,
      featurePlan: cognito.FeaturePlan.ESSENTIALS,
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
      },
      signInPolicy: {
        allowedFirstAuthFactors: {
          password: true, // Cognito requires password auth to remain enabled
          emailOtp: true,
        },
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: false,
        requireUppercase: false,
        requireDigits: false,
        requireSymbols: false,
      },
      // SES-backed email delivery — see the sesDomainName doc comment above
      // for why this replaced Cognito's built-in sender.
      email: cognito.UserPoolEmail.withSES({
        fromEmail: fromAddress,
        fromName: "BadgeIt",
        sesRegion: this.region,
        sesVerifiedDomain: props.sesDomainName,
      }),
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lambdaTriggers: {
        preSignUp: preSignUpFn,
      },
    });

    // The User Pool must not send email before the domain identity is
    // verified in SES (verification is asynchronous after this stack's
    // first deploy — check the SES console for status).
    this.userPool.node.addDependency(emailIdentity);

    // User Pool Client — USER_AUTH flow for passwordless
    this.userPoolClient = this.userPool.addClient("AppClient", {
      userPoolClientName: `badgeit-app-client-${environment}`,
      authFlows: {
        user: true, // Enables USER_AUTH (choice-based, includes email OTP)
        userSrp: false,
        userPassword: false,
        custom: false,
      },
      // Explicit token lifetimes (Cognito defaults would otherwise be relied
      // on implicitly: 60 min ID/access, 60 day refresh). ID/access tokens
      // are short-lived; the refresh token allows the frontend to silently
      // renew them for up to 30 days without forcing re-authentication.
      idTokenValidity: cdk.Duration.minutes(60),
      accessTokenValidity: cdk.Duration.minutes(60),
      refreshTokenValidity: cdk.Duration.days(30),
      preventUserExistenceErrors: true,
    });

    // Publish identifiers to SSM Parameter Store instead of CloudFormation
    // stack exports — see `authStackParamPaths`. Avoids a CloudFormation
    // `Fn::ImportValue` hard dependency on this stack from ApiStack/
    // FrontendStack.
    const paramPaths = authStackParamPaths(environment);

    new ssm.StringParameter(this, "UserPoolIdParam", {
      parameterName: paramPaths.userPoolId,
      stringValue: this.userPool.userPoolId,
    });

    new ssm.StringParameter(this, "UserPoolClientIdParam", {
      parameterName: paramPaths.userPoolClientId,
      stringValue: this.userPoolClient.userPoolClientId,
    });


    // Outputs retained for human visibility (console/CLI) only — no
    // exportName, so no other stack can create a CloudFormation import
    // dependency on them.
    new cdk.CfnOutput(this, "UserPoolId", {
      value: this.userPool.userPoolId,
    });

    new cdk.CfnOutput(this, "UserPoolClientId", {
      value: this.userPoolClient.userPoolClientId,
    });

    new cdk.CfnOutput(this, "SesFromAddress", {
      value: fromAddress,
    });
  }
}
