import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";
import * as path from "path";
import { dataStackParamPaths } from "./data-stack";
import { apiStackParamPaths } from "./api-stack";

/**
 * Builds the predictable SSM parameter namespace for a given environment.
 * MonitoringStack computes the same path to resolve the CloudFront
 * distribution ID for its dashboard, without a direct CDK construct
 * reference to FrontendStack — see the rationale on `apiStackParamPaths`.
 */
export function frontendStackParamPaths(environment: string) {
  const base = `/badgeit/${environment}/frontend`;
  return {
    distributionId: `${base}/distribution-id`,
  };
}

export interface FrontendStackProps extends cdk.StackProps {
  /**
   * Deployment environment (e.g. "dev", "staging", "prod"). Used to look up
   * DataStack's published image bucket ARN and ApiStack's published API URL
   * in SSM Parameter Store (see `dataStackParamPaths` / `apiStackParamPaths`),
   * avoiding direct CDK construct references (and the CloudFormation
   * `Fn::ImportValue` hard dependency that comes with them) on those stacks.
   */
  readonly environment: string;
  /**
   * Custom domain name(s) to serve the site on (e.g. "badgeit.com" or
   * ["badgeit.com", "www.badgeit.com"]). Leave unset to use the default
   * CloudFront domain (*.cloudfront.net) — useful for testing before a
   * domain is registered.
   *
   * @default - no custom domain, serves on the default CloudFront domain
   */
  readonly domainNames?: string[];
  /**
   * ARN of an ACM certificate covering `domainNames`. CloudFront requires
   * this certificate to exist in us-east-1, regardless of the stack's
   * deployment region. Required if `domainNames` is set.
   *
   * The certificate itself is not created here — DNS validation requires
   * a real, owned domain, so provision it manually (or in a separate,
   * one-time stack) once the domain is registered, then pass its ARN here.
   *
   * @default - no custom domain, serves on the default CloudFront domain
   */
  readonly certificateArn?: string;
  /**
   * ARN of the CLOUDFRONT-scope WAF Web ACL (from WafStack) to associate
   * with this distribution. Required if this distribution will be
   * subscribed to a CloudFront flat-rate pricing plan — every tier,
   * including Free, mandates a Web ACL association. Passed as a direct
   * construct reference (not via SSM) because WafStack lives in us-east-1
   * while this stack can deploy to any region; see `crossRegionReferences`
   * in app.ts.
   *
   * @default - no Web ACL associated
   */
  readonly webAclArn?: string;
}

/**
 * A minimal S3 origin that renders `originAccessControlId` without also
 * granting the distribution bucket access via `bind()`.
 *
 * `origins.S3BucketOrigin.withOriginAccessControl()` (the usual helper) does
 * both in one call — it renders the OAC id *and* calls
 * `bucket.addToResourcePolicy()` on the bucket's own stack, scoped to this
 * exact distribution's ID. That's fine when the bucket and distribution are
 * in the same stack, but when the bucket lives in another stack (as it
 * does here — DataStack), a policy scoped to this distribution's ID is a
 * real cross-stack cycle: the bucket's policy needs this distribution's ID
 * and this distribution's origin needs the bucket's domain name.
 *
 * Splitting the two concerns — origin config here, a (wildcard-scoped)
 * bucket policy grant below — avoids ever needing this distribution's ID
 * inside the bucket's own stack, so no cycle forms.
 */
class OacS3Origin extends cloudfront.OriginBase {
  constructor(domainName: string, props?: cloudfront.OriginProps) {
    super(domainName, props);
  }

  protected renderS3OriginConfig(): cloudfront.CfnDistribution.S3OriginConfigProperty {
    return { originAccessIdentity: "" };
  }
}

/**
 * FrontendStack — Deploys the React frontend to S3 and serves via CloudFront.
 *
 * Deployment flow:
 *   1. Build the frontend (`npm run build` in frontend/) with VITE_* env vars set
 *   2. `cdk deploy` picks up the built `frontend/dist/` and uploads to S3
 *   3. CloudFront cache is automatically invalidated on deploy
 *
 * The /api/* path is routed to the API Gateway origin (no caching).
 * The /images/* path is routed to the profile-image S3 bucket (from
 * DataStack), so images are served same-origin — this avoids needing any
 * CORS configuration for the image bucket (browsers only enforce CORS
 * across origins), including for canvas-based operations like the QR code
 * PNG download that composites a profile photo onto the QR code.
 * All other paths serve from S3 with SPA routing (403/404 → index.html).
 *
 * Custom domain: by default this serves on the CloudFront-assigned domain
 * (e.g. https://d123abc.cloudfront.net), which is fine for testing. To add
 * a custom domain later:
 *   1. Register the domain and provision an ACM certificate for it in
 *      us-east-1 (DNS validation required — see AWS docs).
 *   2. Redeploy with:
 *      cdk deploy BadgeIt-Frontend-<env> \
 *        --context domainName=badgeit.com \
 *        --context certificateArn=arn:aws:acm:us-east-1:<account>:certificate/<id>
 *   3. Point the domain's DNS (e.g. a Route53 alias record, or a CNAME at
 *      your registrar) at the distribution's domain name.
 */
export class FrontendStack extends cdk.Stack {
  /** The CloudFront distribution domain name */
  public readonly distributionDomainName: string;

  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props);

    if ((props.domainNames?.length ?? 0) > 0 && !props.certificateArn) {
      throw new Error(
        "FrontendStack: certificateArn is required when domainNames is set (CloudFront needs an ACM certificate in us-east-1 covering the domain).",
      );
    }

    const certificate = props.certificateArn
      ? acm.Certificate.fromCertificateArn(this, "Certificate", props.certificateArn)
      : undefined;

    // Resolve DataStack's image bucket via SSM (deploy-time CFN token) and
    // reconstruct a full IBucket handle from its ARN — avoids a
    // CloudFormation stack-export dependency on DataStack while still
    // supporting addToResourcePolicy and bucketRegionalDomainName below.
    const paramPaths = dataStackParamPaths(props.environment);
    const imageBucketArn = ssm.StringParameter.valueForStringParameter(
      this,
      paramPaths.imageBucketArn,
    );
    const imageBucket = s3.Bucket.fromBucketArn(
      this,
      "ImageBucket",
      imageBucketArn,
    );

    // Resolve ApiStack's API URL via SSM — same rationale as the image
    // bucket lookup above.
    const apiUrl = ssm.StringParameter.valueForStringParameter(
      this,
      apiStackParamPaths(props.environment).apiUrl,
    );

    // S3 bucket for frontend static assets (private, no public access)
    const siteBucket = new s3.Bucket(this, "SiteBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Extract the API Gateway domain from the full URL
    const apiDomain = cdk.Fn.select(2, cdk.Fn.split("/", apiUrl));
    const apiOrigin = new origins.HttpOrigin(apiDomain, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
    });

    // Rewrites /p/{id} requests from known social-media crawler User-Agents
    // to /__og/profile/{id} (see the additionalBehaviors entry below) —
    // real visitors are untouched and keep hitting the SPA from S3. This is
    // what makes shared /p/{id} links unfurl with a name/photo/tagline in
    // iMessage/Slack/LinkedIn/etc., since those crawlers never execute the
    // client-rendered SPA's JS.
    const ogCrawlerRewriteFn = new cloudfront.Function(this, "OgCrawlerRewriteFunction", {
      code: cloudfront.FunctionCode.fromFile({
        filePath: path.join(__dirname, "cloudfront-functions/og-crawler-rewrite.js"),
      }),
      comment: "Rewrite /p/{id} to /__og/profile/{id} for known crawler User-Agents",
    });

    // Origin Access Control for the (cross-stack) profile-image bucket.
    // See the OacS3Origin doc comment above for why this can't use
    // S3BucketOrigin.withOriginAccessControl() directly.
    const imageOriginAccessControl = new cloudfront.CfnOriginAccessControl(
      this,
      "ImageOriginAccessControl",
      {
        originAccessControlConfig: {
          name: `badgeit-image-oac-${this.node.tryGetContext("environment") ?? "dev"}`,
          originAccessControlOriginType: "s3",
          signingBehavior: "always",
          signingProtocol: "sigv4",
        },
      },
    );
    const imageBucketOrigin = new OacS3Origin(imageBucket.bucketRegionalDomainName, {
      originAccessControlId: imageOriginAccessControl.attrId,
    });

    // CloudFront distribution
    const distribution = new cloudfront.Distribution(this, "Distribution", {
      // Unset (default) until a domain + certificate are provided — the
      // distribution then serves only on its default *.cloudfront.net domain.
      domainNames: props.domainNames,
      certificate,
      webAclId: props.webAclArn,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        // Default: long-lived caching for hashed static assets (JS/CSS/images).
        // Vite content-hashes these filenames, so it's always safe to cache
        // aggressively — a new deploy produces new filenames.
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        functionAssociations: [
          {
            function: ogCrawlerRewriteFn,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          },
        ],
      },
      additionalBehaviors: {
        "/api/*": {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
        // Crawler-facing OpenGraph HTML — reached only via the viewer-request
        // rewrite above, never called by the SPA itself.
        "/__og/*": {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
        // Profile images live in a private S3 bucket (DataStack) and are
        // served same-origin here via Origin Access Control — read-only,
        // cached aggressively since each upload gets a unique key
        // (ProfileStore::upload_image) rather than overwriting a fixed one,
        // so a cached object is genuinely immutable — no invalidation is
        // ever needed for a re-upload to show up immediately.
        "/images/*": {
          origin: imageBucketOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        },
        // index.html is unhashed and must always be revalidated so deploys
        // are picked up immediately, without relying on invalidation timing.
        "/index.html": {
          origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        },
        // config.json deliberately has no dedicated behavior here (stays
        // under the CloudFront flat-rate Free tier's 5-behavior cap, which
        // counts the default behavior) — it falls through to the default
        // S3 behavior instead. Still effectively no-cache: the S3 object
        // carries a Cache-Control: no-cache, must-revalidate header (set in
        // the no-cache BucketDeployment below), and every deploy fires an
        // explicit CloudFront invalidation for this exact path (see
        // `distributionPaths` below).
      },
      defaultRootObject: "index.html",
      // SPA routing: redirect 403/404 to /index.html
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: cdk.Duration.seconds(0),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: cdk.Duration.seconds(0),
        },
      ],
    });

    this.distributionDomainName = distribution.distributionDomainName;

    // Unlocks CloudFront's "additional metrics" (CacheHitRate, OriginLatency,
    // and per-status-code error rates) at 1-minute resolution in CloudWatch.
    // Without this subscription, only the basic Requests/BytesDownloaded/
    // BytesUploaded/error-rate metrics are published. Small added cost per
    // distribution — see https://aws.amazon.com/cloudfront/pricing/.
    new cloudfront.CfnMonitoringSubscription(this, "MonitoringSubscription", {
      distributionId: distribution.distributionId,
      monitoringSubscription: {
        realtimeMetricsSubscriptionConfig: {
          realtimeMetricsSubscriptionStatus: "Enabled",
        },
      },
    });

    // Note: the bucket policy granting CloudFront (via OAC) read access to
    // the image bucket lives in DataStack, not here — see the comment on
    // that grant in data-stack.ts for why (imageBucket here is only an
    // *imported* handle via fromBucketArn, and addToResourcePolicy() on an
    // imported bucket is a silent no-op).

    // Deploy frontend assets to S3.
    // Hashed assets (JS/CSS/images) get long-lived, immutable caching since
    // their filenames change on every build. index.html and config.json are
    // excluded here and deployed separately below with no-cache headers.
    new s3deploy.BucketDeployment(this, "DeployFrontend", {
      sources: [s3deploy.Source.asset(path.join(__dirname, "../../frontend/dist"))],
      destinationBucket: siteBucket,
      exclude: ["index.html", "config.json"],
      cacheControl: [
        s3deploy.CacheControl.setPublic(),
        s3deploy.CacheControl.maxAge(cdk.Duration.days(365)),
        s3deploy.CacheControl.fromString("immutable"),
      ],
    });

    // Deploy index.html and config.json separately with no-cache, and
    // invalidate them on every deploy so updates are visible immediately.
    new s3deploy.BucketDeployment(this, "DeployNoCacheFiles", {
      sources: [
        s3deploy.Source.asset(path.join(__dirname, "../../frontend/dist"), {
          exclude: ["*", "!index.html", "!config.json"],
        }),
      ],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ["/index.html", "/config.json"],
      cacheControl: [
        s3deploy.CacheControl.noCache(),
        s3deploy.CacheControl.mustRevalidate(),
      ],
      prune: false,
    });

    // Publish the distribution ID to SSM instead of a CloudFormation stack
    // export — see `frontendStackParamPaths`. MonitoringStack resolves this
    // to build its CloudFront dashboard widgets without a direct CDK
    // construct reference (and the `Fn::ImportValue` hard dependency that
    // comes with one) on this stack.
    new ssm.StringParameter(this, "DistributionIdParam", {
      parameterName: frontendStackParamPaths(props.environment).distributionId,
      stringValue: distribution.distributionId,
    });

    // Outputs retained for human visibility (console/CLI) only — no
    // exportName, so no other stack can create a CloudFormation import
    // dependency on them.
    new cdk.CfnOutput(this, "DistributionDomainName", {
      value: distribution.distributionDomainName,
    });

    new cdk.CfnOutput(this, "DistributionUrl", {
      value: `https://${props.domainNames?.[0] ?? distribution.distributionDomainName}`,
    });

    new cdk.CfnOutput(this, "SiteBucketName", {
      value: siteBucket.bucketName,
    });
  }
}
