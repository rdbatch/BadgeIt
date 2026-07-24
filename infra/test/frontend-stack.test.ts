import * as cdk from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import { FrontendStack } from "../lib/frontend-stack";
import { DataStack } from "../lib/data-stack";
import { ApiStack } from "../lib/api-stack";
import { AuthStack } from "../lib/auth-stack";
import * as path from "path";
import * as fs from "fs";

// Ensure frontend/dist exists for asset resolution during synth
const distPath = path.join(__dirname, "../../frontend/dist");
if (!fs.existsSync(distPath)) {
  fs.mkdirSync(distPath, { recursive: true });
  fs.writeFileSync(path.join(distPath, "index.html"), "<html></html>");
}

/**
 * FrontendStack resolves DataStack's image bucket ARN and ApiStack's API
 * URL via SSM (see dataStackParamPaths / apiStackParamPaths) instead of
 * direct construct references. To exercise FrontendStack in isolation, we
 * still deploy DataStack + AuthStack + ApiStack alongside it in the same
 * App so the SSM parameters they publish exist for FrontendStack to read.
 */
function synthFrontendStack(
  app: cdk.App,
  id: string,
  env: cdk.Environment,
  overrides: Partial<
    Omit<
      ConstructorParameters<typeof FrontendStack>[2],
      "environment" | "env" | "tags"
    >
  > = {},
) {
  new DataStack(app, `${id}Data`, {
    tags: { project: "badgetag", environment: "test" },
    env,
  });
  const authStack = new AuthStack(app, `${id}Auth`, {
    tags: { project: "badgetag", environment: "test" },
    sesDomainName: "test.badgetag.me",
    passkeyRelyingPartyId: "test.badgetag.me",
    alertEmail: "ops@example.com",
    env,
  });
  const apiStack = new ApiStack(app, `${id}Api`, {
    tags: { project: "badgetag", environment: "test" },
    environment: "test",
    env,
  });
  apiStack.addDependency(authStack);
  const stack = new FrontendStack(app, id, {
    tags: { project: "badgetag", environment: "test" },
    environment: "test",
    env,
    ...overrides,
  });
  stack.addDependency(apiStack);
  return stack;
}

describe("FrontendStack", () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App({ context: { environment: "test" } });
    const env = { account: "123456789012", region: "us-east-1" };
    const stack = synthFrontendStack(app, "TestFrontendStack", env);
    template = Template.fromStack(stack);
  });

  describe("S3 Site Bucket", () => {
    test("creates a bucket with block public access", () => {
      template.hasResourceProperties("AWS::S3::Bucket", {
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
      });
    });

    test("uses S3 managed encryption", () => {
      template.hasResourceProperties("AWS::S3::Bucket", {
        BucketEncryption: {
          ServerSideEncryptionConfiguration: [
            {
              ServerSideEncryptionByDefault: {
                SSEAlgorithm: "AES256",
              },
            },
          ],
        },
      });
    });
  });

  describe("CloudFront Distribution", () => {
    test("creates a distribution", () => {
      template.resourceCountIs("AWS::CloudFront::Distribution", 1);
    });

    test("has S3 origin for default behavior", () => {
      template.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: {
          Origins: Match.arrayWith([
            Match.objectLike({
              S3OriginConfig: Match.anyValue(),
            }),
          ]),
        },
      });
    });

    test("has API Gateway origin for /api/* behavior", () => {
      template.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: {
          Origins: Match.arrayWith([
            Match.objectLike({
              // The domain is derived at deploy time from ApiStack's API
              // URL (an SSM dynamic reference resolved by CloudFormation),
              // so it renders as an Fn::Select/Fn::Split expression rather
              // than a literal string — just assert the origin shape.
              DomainName: Match.anyValue(),
              CustomOriginConfig: Match.objectLike({
                OriginProtocolPolicy: "https-only",
              }),
            }),
          ]),
        },
      });
    });

    test("has /api/* cache behavior with all methods allowed", () => {
      template.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: {
          CacheBehaviors: Match.arrayWith([
            Match.objectLike({
              PathPattern: "/api/*",
              AllowedMethods: Match.arrayWith([
                "GET",
                "HEAD",
                "OPTIONS",
                "PUT",
                "PATCH",
                "POST",
                "DELETE",
              ]),
            }),
          ]),
        },
      });
    });

    test("has S3 origin for /images/* behavior (profile images served same-origin)", () => {
      template.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: {
          Origins: Match.arrayWith([
            Match.objectLike({
              S3OriginConfig: Match.anyValue(),
            }),
          ]),
        },
      });
    });

    test("has /images/* cache behavior restricted to GET/HEAD", () => {
      template.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: {
          CacheBehaviors: Match.arrayWith([
            Match.objectLike({
              PathPattern: "/images/*",
              AllowedMethods: Match.arrayWith(["GET", "HEAD"]),
            }),
          ]),
        },
      });
    });

    test("has SPA routing via custom error responses", () => {
      template.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: {
          CustomErrorResponses: Match.arrayWith([
            Match.objectLike({
              ErrorCode: 403,
              ResponseCode: 200,
              ResponsePagePath: "/index.html",
            }),
            Match.objectLike({
              ErrorCode: 404,
              ResponseCode: 200,
              ResponsePagePath: "/index.html",
            }),
          ]),
        },
      });
    });

    test("has default root object set to index.html", () => {
      template.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: {
          DefaultRootObject: "index.html",
        },
      });
    });

    test("has no-cache behavior for /index.html", () => {
      template.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: {
          CacheBehaviors: Match.arrayWith([
            Match.objectLike({
              PathPattern: "/index.html",
              CachePolicyId: Match.anyValue(),
            }),
          ]),
        },
      });
    });

    test("does not have a dedicated cache behavior for /config.json (stays under the 5-behavior cap; falls through to the default S3 behavior)", () => {
      template.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: {
          CacheBehaviors: Match.not(
            Match.arrayWith([
              Match.objectLike({
                PathPattern: "/config.json",
              }),
            ]),
          ),
        },
      });
    });

    test("deploys index.html and config.json with no-cache, must-revalidate headers and an explicit invalidation", () => {
      template.hasResourceProperties("Custom::CDKBucketDeployment", {
        DistributionPaths: ["/index.html", "/config.json"],
        SystemMetadata: { "cache-control": "no-cache, must-revalidate" },
      });
    });

    test("has /__og/* cache behavior pointed at the API Gateway origin, disabled cache", () => {
      template.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: {
          CacheBehaviors: Match.arrayWith([
            Match.objectLike({
              PathPattern: "/__og/*",
              AllowedMethods: Match.arrayWith(["GET", "HEAD"]),
              CachePolicyId: Match.anyValue(),
            }),
          ]),
        },
      });
    });

    test("attaches a CloudFront Function to the default behavior for viewer-request", () => {
      template.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: {
          DefaultCacheBehavior: Match.objectLike({
            FunctionAssociations: Match.arrayWith([
              Match.objectLike({ EventType: "viewer-request" }),
            ]),
          }),
        },
      });
    });

    test("creates the crawler-rewrite CloudFront Function", () => {
      template.resourceCountIs("AWS::CloudFront::Function", 1);
    });
  });

  describe("BucketDeployment", () => {
    test("creates custom resources for deployment (hashed assets + no-cache files)", () => {
      template.resourceCountIs("Custom::CDKBucketDeployment", 2);
    });
  });

  describe("Image bucket access", () => {
    test("does not attempt to create a bucket policy here (imageBucket is only an imported handle; the real grant lives in DataStack)", () => {
      // Regression test: an earlier version called
      // imageBucket.addToResourcePolicy(...) here, which is a silent no-op
      // on an imported (fromBucketArn) bucket — no policy was ever actually
      // created, so CloudFront's OAC had no grant and every /images/*
      // request 403'd. Only the SiteBucket's own policy (for its OAC
      // origins) should exist in this stack.
      template.resourceCountIs("AWS::S3::BucketPolicy", 1);
    });
  });

  describe("Outputs", () => {
    test("has a distribution domain name output with no CloudFormation export (avoids hard cross-stack dependency)", () => {
      template.hasOutput("DistributionDomainName", { Export: Match.absent() });
    });

    test("has a distribution URL output with no CloudFormation export", () => {
      template.hasOutput("DistributionUrl", { Export: Match.absent() });
    });

    test("has a site bucket name output with no CloudFormation export", () => {
      template.hasOutput("SiteBucketName", { Export: Match.absent() });
    });
  });

  describe("Custom domain (not yet configured)", () => {
    test("distribution has no aliases by default", () => {
      template.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: Match.objectLike({
          Aliases: Match.absent(),
        }),
      });
    });
  });

  describe("Custom domain (configured)", () => {
    let domainTemplate: Template;

    beforeAll(() => {
      const app = new cdk.App({ context: { environment: "test" } });
      const env = { account: "123456789012", region: "us-east-1" };
      const stack = synthFrontendStack(app, "TestFrontendDomainStack", env, {
        domainNames: ["badgetag.example.com"],
        certificateArn:
          "arn:aws:acm:us-east-1:123456789012:certificate/test-cert-id",
      });
      domainTemplate = Template.fromStack(stack);
    });

    test("distribution uses the configured domain as an alias", () => {
      domainTemplate.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: Match.objectLike({
          Aliases: ["badgetag.example.com"],
        }),
      });
    });

    test("distribution references the provided certificate", () => {
      domainTemplate.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: Match.objectLike({
          ViewerCertificate: Match.objectLike({
            AcmCertificateArn:
              "arn:aws:acm:us-east-1:123456789012:certificate/test-cert-id",
          }),
        }),
      });
    });

    test("DistributionUrl output uses the custom domain", () => {
      domainTemplate.hasOutput("DistributionUrl", {
        Value: "https://badgetag.example.com",
      });
    });

    test("throws if certificateArn is missing but domainNames is set", () => {
      const app = new cdk.App({ context: { environment: "test" } });
      expect(
        () =>
          new FrontendStack(app, "TestFrontendMissingCertStack", {
            tags: { project: "badgetag", environment: "test" },
            environment: "test",
            domainNames: ["badgetag.example.com"],
          }),
      ).toThrow(/certificateArn is required/);
    });
  });
});
