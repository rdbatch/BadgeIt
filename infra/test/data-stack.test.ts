import * as cdk from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import { DataStack } from "../lib/data-stack";

describe("DataStack", () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App({ context: { environment: "test" } });
    const stack = new DataStack(app, "TestDataStack", {
      tags: { project: "badgetag", environment: "test" },
      env: { region: "us-east-1", account: "123456789012" },
    });
    template = Template.fromStack(stack);
  });

  describe("DynamoDB Global Table", () => {
    test("creates a Global Table with correct key schema", () => {
      template.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
        KeySchema: [
          { AttributeName: "pk", KeyType: "HASH" },
          { AttributeName: "sk", KeyType: "RANGE" },
        ],
      });
    });

    test("uses PAY_PER_REQUEST billing mode", () => {
      template.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
        BillingMode: "PAY_PER_REQUEST",
      });
    });

    test("has a single replica with point-in-time recovery enabled", () => {
      template.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
        Replicas: [
          {
            Region: "us-east-1",
            PointInTimeRecoverySpecification: {
              PointInTimeRecoveryEnabled: true,
            },
          },
        ],
      });
    });

    test("has correct attribute definitions", () => {
      template.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
        AttributeDefinitions: [
          { AttributeName: "pk", AttributeType: "S" },
          { AttributeName: "sk", AttributeType: "S" },
        ],
      });
    });

    test("has RETAIN deletion policy", () => {
      template.hasResource("AWS::DynamoDB::GlobalTable", {
        DeletionPolicy: "Retain",
        UpdateReplacePolicy: "Retain",
      });
    });
  });

  describe("S3 Image Bucket", () => {
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

    test("has lifecycle rule for orphaned uploads", () => {
      template.hasResourceProperties("AWS::S3::Bucket", {
        LifecycleConfiguration: {
          Rules: Match.arrayWith([
            Match.objectLike({
              Id: "cleanup-orphaned-uploads",
              Prefix: "uploads/",
              ExpirationInDays: 7,
              Status: "Enabled",
            }),
          ]),
        },
      });
    });

    test("has no CORS configuration (uploads go through Lambda, not direct browser-to-S3)", () => {
      const buckets = template.findResources("AWS::S3::Bucket");
      const imageBucket = Object.values(buckets).find((b: any) =>
        b.Properties?.BucketName?.["Fn::Join"]?.[1]?.some((part: unknown) =>
          typeof part === "string" && part.includes("badgetag-images"),
        ),
      );
      expect(imageBucket?.Properties?.CorsConfiguration).toBeUndefined();
    });

    test("has RETAIN deletion policy", () => {
      template.hasResource("AWS::S3::Bucket", {
        DeletionPolicy: "Retain",
        UpdateReplacePolicy: "Retain",
      });
    });

    test("creates no CloudFront distribution (images are served same-origin via FrontendStack's /images/* behavior)", () => {
      template.resourceCountIs("AWS::CloudFront::Distribution", 0);
    });

    test("grants CloudFront (via OAC) read access to objects in the bucket", () => {
      // This grant must live here (on the real bucket resource) rather than
      // in FrontendStack, which only holds an imported bucket handle via
      // fromBucketArn — addToResourcePolicy() on an imported bucket is a
      // silent no-op and would never synthesize this policy.
      template.hasResourceProperties("AWS::S3::BucketPolicy", {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: "Allow",
              Principal: { Service: "cloudfront.amazonaws.com" },
              Action: "s3:GetObject",
              Condition: {
                ArnLike: {
                  "AWS:SourceArn": Match.objectLike({
                    "Fn::Join": Match.arrayWith([
                      Match.arrayWith([
                        Match.stringLikeRegexp(":cloudfront::.*:distribution/\\*"),
                      ]),
                    ]),
                  }),
                },
              },
            }),
          ]),
        },
      });
    });
  });

  describe("SSM Parameters", () => {
    test("publishes table ARN to SSM", () => {
      template.hasResourceProperties("AWS::SSM::Parameter", {
        Name: "/badgetag/test/data/table-arn",
        Type: "String",
      });
    });

    test("publishes table name to SSM", () => {
      template.hasResourceProperties("AWS::SSM::Parameter", {
        Name: "/badgetag/test/data/table-name",
        Type: "String",
      });
    });

    test("publishes image bucket ARN to SSM", () => {
      template.hasResourceProperties("AWS::SSM::Parameter", {
        Name: "/badgetag/test/data/image-bucket-arn",
        Type: "String",
      });
    });

    test("publishes image bucket name to SSM", () => {
      template.hasResourceProperties("AWS::SSM::Parameter", {
        Name: "/badgetag/test/data/image-bucket-name",
        Type: "String",
      });
    });
  });

  describe("Outputs", () => {
    test("has a table name output with no CloudFormation export (avoids hard cross-stack dependency)", () => {
      template.hasOutput("TableName", { Export: Match.absent() });
    });

    test("has a table ARN output with no CloudFormation export", () => {
      template.hasOutput("TableArn", { Export: Match.absent() });
    });

    test("has an image bucket name output with no CloudFormation export", () => {
      template.hasOutput("ImageBucketName", { Export: Match.absent() });
    });

    test("has an image bucket ARN output with no CloudFormation export", () => {
      template.hasOutput("ImageBucketArn", { Export: Match.absent() });
    });
  });
});
