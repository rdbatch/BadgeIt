import * as cdk from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
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
  /**
   * The fully-qualified domain that WebAuthn/passkey providers must treat
   * as the relying party (RP) for this pool (e.g. "badgeit.app" for prod,
   * "dev.badgeit.app" for dev). Must be a registrable-domain match of the
   * actual origin the browser is on when navigator.credentials.create()/
   * get() run — a passkey registered under one RP ID cannot be used to
   * sign in from a different origin. This is the same custom domain
   * already used as this environment's public site origin (see the
   * `domainName` CDK context flag in infra/bin/app.ts), which is why it's
   * threaded in from there rather than hardcoded per-environment here like
   * sesDomainName is. Required (not optional): passkey support ships to
   * every environment in the same change, so there's no valid "auth stack
   * without a relying party ID" state.
   */
  readonly passkeyRelyingPartyId: string;
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
 * The USER_AUTH flow allows users to authenticate with either an emailed
 * one-time code or a registered passkey (WebAuthn) — Cognito's
 * SELECT_CHALLENGE mechanism reports, per-account, which of these are
 * available before any credential is submitted (see
 * frontend/src/auth/service.ts), so a user with no registered passkey
 * never sees a passkey prompt. Passkeys are an additional first factor,
 * never a replacement for email OTP, and still involve no standard
 * passwords.
 *
 * New users are confirmed the standard Cognito way: `autoVerify: { email:
 * true }` makes SignUp send a real confirmation code to the address given,
 * and the account only becomes CONFIRMED/verified once that code is
 * submitted via ConfirmSignUp (see frontend/src/auth/service.ts). There is
 * deliberately no Pre Sign-up trigger that force-confirms/verifies users —
 * that would let anyone mark an arbitrary, unowned email address as
 * "verified" just by calling SignUp, without ever proving they can receive
 * mail there.
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
          passkey: true,
        },
      },
      // Passkey (WebAuthn) as an additional first-factor option, alongside
      // email OTP. The relying party ID must match the site's real origin
      // (see AuthStackProps.passkeyRelyingPartyId doc comment) — this is
      // why AuthStack now needs the deploy's domain name, unlike before.
      // No Lambda triggers, IAM, or new AWS resources are introduced —
      // Cognito manages passkey credential storage internally, same as it
      // already manages email OTP delivery state.
      passkeyRelyingPartyId: props.passkeyRelyingPartyId,
      // PREFERRED (not REQUIRED): user verification (biometric/PIN) is
      // requested from the authenticator but not hard-required, matching
      // how most consumer passkey flows behave (Face ID/Touch ID/Windows
      // Hello all satisfy PREFERRED; REQUIRED would reject authenticators
      // that can't enforce it, unnecessarily strict for this app's threat
      // model).
      passkeyUserVerification: cognito.PasskeyUserVerification.PREFERRED,
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
    });

    // The User Pool must not send email before the domain identity is
    // verified in SES (verification is asynchronous after this stack's
    // first deploy — check the SES console for status).
    this.userPool.node.addDependency(emailIdentity);

    // User Pool Client — USER_AUTH flow for passwordless
    // No new scopes needed for passkey APIs: aws.cognito.signin.user.admin
    // is granted by default and already covers StartWebAuthnRegistration/
    // CompleteWebAuthnRegistration/ListWebAuthnCredentials/
    // DeleteWebAuthnCredential.
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
