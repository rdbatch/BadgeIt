import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { Construct } from "constructs";
import { dataStackParamPaths } from "./data-stack";
import { authStackParamPaths } from "./auth-stack";

/**
 * Builds the predictable SSM parameter namespace for a given environment.
 * FrontendStack computes the same path from just the environment name, so
 * it never needs a direct CDK construct/prop reference to ApiStack —
 * decoupling it from ApiStack's CloudFormation lifecycle (no
 * `Fn::ImportValue`, no hard cross-stack delete/replace dependency).
 */
export function apiStackParamPaths(environment: string) {
  const base = `/badgeit/${environment}/api`;
  return {
    apiUrl: `${base}/api-url`,
  };
}

export interface ApiStackProps extends cdk.StackProps {
  /**
   * Deployment environment (e.g. "dev", "staging", "prod"). Used to look up
   * DataStack's and AuthStack's published resource identifiers in SSM
   * Parameter Store (see `dataStackParamPaths` / `authStackParamPaths`),
   * avoiding direct CDK construct references (and the CloudFormation
   * `Fn::ImportValue` hard dependency that comes with them) on those stacks.
   */
  readonly environment: string;
  /**
   * Origins allowed to call this API directly (e.g. local dev against a
   * deployed API). In production the frontend calls /api/* same-origin
   * through CloudFront, which never triggers CORS, so this can be left
   * empty for prod deploys.
   */
  readonly allowedOrigins?: string[];
}

/**
 * ApiStack — Rust Lambda function behind an HTTP API Gateway for BadgeIt.
 */
export class ApiStack extends cdk.Stack {
  /** The HTTP API Gateway URL */
  public readonly apiUrl: string;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const environment = props.environment;
    const paramPaths = dataStackParamPaths(environment);

    // Resolve DataStack's table/bucket via SSM (deploy-time CFN tokens, not
    // a synth-time lookup) and reconstruct full ITable/IBucket handles from
    // their ARNs. This preserves correct, minimal-privilege IAM grants via
    // grantReadWriteData/grantReadWrite below, without creating a
    // CloudFormation stack-export dependency on DataStack.
    const tableArn = ssm.StringParameter.valueForStringParameter(
      this,
      paramPaths.tableArn,
    );
    const imageBucketArn = ssm.StringParameter.valueForStringParameter(
      this,
      paramPaths.imageBucketArn,
    );

    const table = dynamodb.Table.fromTableArn(this, "ProfileTable", tableArn);
    const imageBucket = s3.Bucket.fromBucketArn(
      this,
      "ImageBucket",
      imageBucketArn,
    );

    // Resolve AuthStack's Cognito identifiers via SSM — same rationale as
    // the table/bucket lookups above.
    const authParamPaths = authStackParamPaths(environment);
    const userPoolId = ssm.StringParameter.valueForStringParameter(
      this,
      authParamPaths.userPoolId,
    );
    const userPoolClientId = ssm.StringParameter.valueForStringParameter(
      this,
      authParamPaths.userPoolClientId,
    );

    // Rust Lambda function (ARM64 Graviton)
    const apiFn = new lambda.Function(this, "ApiFn", {
      functionName: `badgeit-api-${environment}`,
      runtime: lambda.Runtime.PROVIDED_AL2023,
      architecture: lambda.Architecture.ARM_64,
      handler: "bootstrap",
      code: lambda.Code.fromAsset("../backend/target/lambda/api"),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        TABLE_NAME: table.tableName,
        BUCKET_NAME: imageBucket.bucketName,
        // Empty (site-root-relative) base — images are served same-origin
        // via the frontend's CloudFront distribution (an /images/*
        // behavior pointed at the image bucket). The S3 object key already
        // starts with "images/", so the resulting image_url is
        // "/images/<profile_id>". Using a relative path also avoids a
        // circular dependency between ApiStack and FrontendStack.
        IMAGE_BASE_URL: "",
        USER_POOL_ID: userPoolId,
        USER_POOL_CLIENT_ID: userPoolClientId,
      },
    });

    // Grant Lambda permissions to DynamoDB and S3
    table.grantReadWriteData(apiFn);
    imageBucket.grantReadWrite(apiFn);

    // HTTP API Gateway
    const integration = new HttpLambdaIntegration("ApiIntegration", apiFn);

    // CORS is only needed for direct (non-CloudFront) callers, e.g. local
    // dev hitting the deployed API from http://localhost. The production
    // frontend calls /api/* same-origin through CloudFront, which browsers
    // never treat as cross-origin. Default to no allowed origins so the API
    // is not callable cross-site unless explicitly configured.
    const allowedOrigins = props.allowedOrigins ?? [];

    const httpApi = new apigwv2.HttpApi(this, "HttpApi", {
      apiName: `badgeit-api-${environment}`,
      corsPreflight:
        allowedOrigins.length > 0
          ? {
              allowOrigins: allowedOrigins,
              allowMethods: [
                apigwv2.CorsHttpMethod.GET,
                apigwv2.CorsHttpMethod.PUT,
                apigwv2.CorsHttpMethod.POST,
                apigwv2.CorsHttpMethod.DELETE,
                apigwv2.CorsHttpMethod.OPTIONS,
              ],
              allowHeaders: ["Content-Type", "Authorization"],
            }
          : undefined,
      // We create the default ($default) stage ourselves below so we can
      // attach throttle settings — HttpApiProps has no direct throttle knob.
      createDefaultStage: false,
    });

    // Basic throttling to blunt scripted abuse. Tune based on real traffic;
    // API Gateway's account-level default is 10,000 rps/5,000 burst, so this
    // is intentionally much lower for a low-traffic app.
    new apigwv2.HttpStage(this, "DefaultStage", {
      httpApi,
      stageName: "$default",
      autoDeploy: true,
      throttle: {
        rateLimit: 50,
        burstLimit: 100,
      },
    });

    // Routes
    // NOTE: HTTP API route matching prioritizes more specific (literal)
    // path segments over parameterized ones automatically, so
    // /api/profile/me is correctly matched ahead of /api/profile/{id}
    // regardless of declaration order — but it's declared first here for
    // readability, to mirror the Lambda-side router's match-arm order.
    httpApi.addRoutes({
      path: "/api/profile/me",
      methods: [apigwv2.HttpMethod.GET],
      integration,
    });

    httpApi.addRoutes({
      path: "/api/profile/{id}",
      methods: [apigwv2.HttpMethod.GET],
      integration,
    });

    httpApi.addRoutes({
      path: "/api/profile",
      methods: [apigwv2.HttpMethod.PUT],
      integration,
    });

    httpApi.addRoutes({
      path: "/api/profile",
      methods: [apigwv2.HttpMethod.DELETE],
      integration,
    });

    httpApi.addRoutes({
      path: "/api/profile/image",
      methods: [apigwv2.HttpMethod.POST],
      integration,
    });

    this.apiUrl = httpApi.apiEndpoint;

    // Publish the API URL to SSM instead of a CloudFormation stack export —
    // see `apiStackParamPaths`. Avoids a CloudFormation `Fn::ImportValue`
    // hard dependency on this stack from FrontendStack.
    new ssm.StringParameter(this, "ApiUrlParam", {
      parameterName: apiStackParamPaths(environment).apiUrl,
      stringValue: this.apiUrl,
    });

    // Output retained for human visibility (console/CLI) only — no
    // exportName, so no other stack can create a CloudFormation import
    // dependency on it.
    new cdk.CfnOutput(this, "ApiUrl", {
      value: httpApi.apiEndpoint,
    });
  }
}
