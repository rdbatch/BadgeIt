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
            SITE_URL: Match.anyValue(),
          },
        },
      });
    });

    test("defaults SITE_URL to empty when siteUrl prop is not set", () => {
      template.hasResourceProperties("AWS::Lambda::Function", {
        Environment: {
          Variables: Match.objectLike({
            SITE_URL: "",
          }),
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

    test("has GET /__og/profile/{id} route for crawler-facing OpenGraph HTML", () => {
      template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
        RouteKey: "GET /__og/profile/{id}",
      });
    });

    test("has GET /api/connections route", () => {
      template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
        RouteKey: "GET /api/connections",
      });
    });

    test("has POST /api/connections route", () => {
      template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
        RouteKey: "POST /api/connections",
      });
    });

    test("has DELETE /api/connections/{id} route", () => {
      template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
        RouteKey: "DELETE /api/connections/{id}",
      });
    });
  });

  describe("Observability", () => {
    test("creates a CloudWatch dashboard", () => {
      template.hasResourceProperties("AWS::CloudWatch::Dashboard", {
        DashboardName: "badgeit-test",
      });
    });

    test("creates an alarm on Lambda errors", () => {
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        AlarmName: "badgeit-api-test-lambda-errors",
        Namespace: "AWS/Lambda",
        MetricName: "Errors",
        Threshold: 5,
      });
    });

    test("creates an alarm on Lambda p99 duration", () => {
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        AlarmName: "badgeit-api-test-lambda-p99-duration",
        Namespace: "AWS/Lambda",
        MetricName: "Duration",
        ExtendedStatistic: "p99",
      });
    });

    test("creates an alarm on API Gateway 5xx responses", () => {
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        AlarmName: "badgeit-api-test-5xx",
        Namespace: "AWS/ApiGateway",
      });
    });

    test("creates an alarm on DynamoDB throttled requests", () => {
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        AlarmName: "badgeit-api-test-dynamodb-throttles",
        Namespace: "AWS/DynamoDB",
        MetricName: "ThrottledRequests",
      });
    });

    test("dashboard includes a Logs Insights widget querying for profile_created", () => {
      const dashboard = template.findResources("AWS::CloudWatch::Dashboard");
      const body = Object.values(dashboard)[0].Properties.DashboardBody;
      // DashboardBody is a Fn::Join'd JSON string in the synthesized
      // template — assert the query text appears somewhere in its parts
      // rather than parsing the whole Fn::Join expression.
      const joined = JSON.stringify(body);
      expect(joined).toContain("profile_created");
      expect(joined).toContain("public_card_view");
    });
  });

  describe("siteUrl prop", () => {
    test("sets SITE_URL when siteUrl is provided", () => {
      const app = new cdk.App({ context: { environment: "test" } });
      const env = { account: "123456789012", region: "us-east-1" };

      new DataStack(app, "SiteUrlDataStack", {
        tags: { project: "badgeit", environment: "test" },
        env,
      });
      new AuthStack(app, "SiteUrlAuthStack", {
        tags: { project: "badgeit", environment: "test" },
        sesDomainName: "test.badgeit.app",
        env,
      });
      const apiStack = new ApiStack(app, "SiteUrlApiStack", {
        tags: { project: "badgeit", environment: "test" },
        env,
        environment: "test",
        siteUrl: "https://badgeit.example.com",
      });

      Template.fromStack(apiStack).hasResourceProperties("AWS::Lambda::Function", {
        Environment: {
          Variables: Match.objectLike({
            SITE_URL: "https://badgeit.example.com",
          }),
        },
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
