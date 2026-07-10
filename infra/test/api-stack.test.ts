import * as cdk from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import { DataStack } from "../lib/data-stack";
import { AuthStack } from "../lib/auth-stack";
import { ApiStack } from "../lib/api-stack";

describe("ApiStack", () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App({ context: { environment: "test" } });
    const env = { account: "123456789012", region: "us-east-1" };

    // DataStack and AuthStack publish their identifiers to SSM under a path
    // derived from the "test" environment; ApiStack reads them back the
    // same way it would in a real, separately-deployed stack.
    new DataStack(app, "TestDataStack", {
      tags: { project: "badgeit", environment: "test" },
      env,
    });

    new AuthStack(app, "TestAuthStack", {
      tags: { project: "badgeit", environment: "test" },
      sesDomainName: "test.badgeit.app",
      env,
    });

    const apiStack = new ApiStack(app, "TestApiStack", {
      tags: { project: "badgeit", environment: "test" },
      env,
      environment: "test",
    });

    template = Template.fromStack(apiStack);
  });

  describe("Lambda Function", () => {
    test("creates a Lambda with ARM64 and provided.al2023 runtime", () => {
      template.hasResourceProperties("AWS::Lambda::Function", {
        FunctionName: "badgeit-api-test",
        Architectures: ["arm64"],
        Runtime: "provided.al2023",
      });
    });

    test("has correct environment variables", () => {
      template.hasResourceProperties("AWS::Lambda::Function", {
        Environment: {
          Variables: {
            TABLE_NAME: Match.anyValue(),
            BUCKET_NAME: Match.anyValue(),
            IMAGE_BASE_URL: Match.anyValue(),
            USER_POOL_ID: Match.anyValue(),
            USER_POOL_CLIENT_ID: Match.anyValue(),
          },
        },
      });
    });

    test("uses an empty (root-relative) IMAGE_BASE_URL since images are served same-origin via FrontendStack", () => {
      template.hasResourceProperties("AWS::Lambda::Function", {
        Environment: {
          Variables: Match.objectLike({
            IMAGE_BASE_URL: "",
          }),
        },
      });
    });

    test("has DynamoDB read/write permissions", () => {
      template.hasResourceProperties("AWS::IAM::Policy", {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith([
                "dynamodb:BatchGetItem",
                "dynamodb:GetItem",
                "dynamodb:PutItem",
              ]),
              Effect: "Allow",
            }),
          ]),
        },
      });
    });

    test("has S3 read/write permissions", () => {
      template.hasResourceProperties("AWS::IAM::Policy", {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith([
                "s3:GetObject*",
                "s3:GetBucket*",
              ]),
              Effect: "Allow",
            }),
          ]),
        },
      });
    });
  });

  describe("HTTP API Gateway", () => {
    test("creates an HTTP API", () => {
      template.hasResourceProperties("AWS::ApiGatewayV2::Api", {
        Name: "badgeit-api-test",
        ProtocolType: "HTTP",
      });
    });

    test("has no CORS configuration by default (same-origin via CloudFront)", () => {
      template.hasResourceProperties("AWS::ApiGatewayV2::Api", {
        CorsConfiguration: Match.absent(),
      });
    });

    test("has default stage with throttling configured", () => {
      template.hasResourceProperties("AWS::ApiGatewayV2::Stage", {
        StageName: "$default",
        AutoDeploy: true,
        DefaultRouteSettings: Match.objectLike({
          ThrottlingRateLimit: 50,
          ThrottlingBurstLimit: 100,
        }),
      });
    });

    test("has GET /api/profile/me route", () => {
      template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
        RouteKey: "GET /api/profile/me",
      });
    });

    test("has GET /api/profile/{id} route", () => {
      template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
        RouteKey: "GET /api/profile/{id}",
      });
    });

    test("has PUT /api/profile route", () => {
      template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
        RouteKey: "PUT /api/profile",
      });
    });

    test("has DELETE /api/profile route", () => {
      template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
        RouteKey: "DELETE /api/profile",
      });
    });

    test("has POST /api/profile/image route", () => {
      template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
        RouteKey: "POST /api/profile/image",
      });
    });
  });

  describe("SSM Parameters", () => {
    test("publishes API URL to SSM", () => {
      template.hasResourceProperties("AWS::SSM::Parameter", {
        Name: "/badgeit/test/api/api-url",
        Type: "String",
      });
    });
  });

  describe("Outputs", () => {
    test("has an API URL output with no CloudFormation export (avoids hard cross-stack dependency)", () => {
      template.hasOutput("ApiUrl", { Export: Match.absent() });
    });
  });
});
