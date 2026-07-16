import * as cdk from "aws-cdk-lib";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import { Construct } from "constructs";
import { dataStackParamPaths } from "./data-stack";
import { apiStackParamPaths } from "./api-stack";
import { frontendStackParamPaths } from "./frontend-stack";

export interface MonitoringStackProps extends cdk.StackProps {
  /**
   * Deployment environment (e.g. "dev", "staging", "prod"). Used to look up
   * ApiStack's, DataStack's, and FrontendStack's published resource
   * identifiers in SSM Parameter Store.
   */
  readonly environment: string;
}

/**
 * MonitoringStack — the single `badgetag-{environment}` CloudWatch dashboard,
 * combining Lambda/API Gateway/DynamoDB metrics with CloudFront metrics.
 *
 * This lives in its own stack, deployed after both ApiStack and
 * FrontendStack, because those two can't reference each other directly:
 * FrontendStack needs ApiStack's URL to build its `/api/*` origin, so
 * ApiStack can never depend on FrontendStack without a deploy-order cycle
 * (see app.ts). A dashboard needs metrics from both, so it can't live in
 * either — hence its own stack, deployed last.
 *
 * All resource identifiers are resolved via SSM Parameter Store (see the
 * `*StackParamPaths` helpers) and used to reconstruct raw `cloudwatch.Metric`
 * objects directly (namespace/metricName/dimensionsMap), rather than via
 * L2 construct helpers like `table.metricThrottledRequests()` — this stack
 * only ever imports plain strings (names/ids) from SSM, never live CDK
 * construct handles, so there's no `Fn::ImportValue` dependency on either
 * source stack.
 */
export class MonitoringStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);

    const environment = props.environment;
    const apiParamPaths = apiStackParamPaths(environment);
    const dataParamPaths = dataStackParamPaths(environment);
    const frontendParamPaths = frontendStackParamPaths(environment);

    const apiId = ssm.StringParameter.valueForStringParameter(this, apiParamPaths.apiId);
    const functionName = ssm.StringParameter.valueForStringParameter(
      this,
      apiParamPaths.functionName,
    );
    const logGroupName = ssm.StringParameter.valueForStringParameter(
      this,
      apiParamPaths.logGroupName,
    );
    const tableName = ssm.StringParameter.valueForStringParameter(
      this,
      dataParamPaths.tableName,
    );
    const distributionId = ssm.StringParameter.valueForStringParameter(
      this,
      frontendParamPaths.distributionId,
    );

    const lambdaMetric = (metricName: string, statistic: string) =>
      new cloudwatch.Metric({
        namespace: "AWS/Lambda",
        metricName,
        dimensionsMap: { FunctionName: functionName },
        statistic,
        period: cdk.Duration.minutes(5),
      });
    const lambdaInvocations = lambdaMetric("Invocations", "Sum");
    const lambdaErrors = lambdaMetric("Errors", "Sum");
    const lambdaDurationP50 = lambdaMetric("Duration", "p50");
    const lambdaDurationP99 = lambdaMetric("Duration", "p99");

    // HTTP API (v2) publishes to the same AWS/ApiGateway namespace as REST
    // APIs, dimensioned by ApiId rather than ApiName/Stage.
    const apiGatewayMetric = (metricName: string) =>
      new cloudwatch.Metric({
        namespace: "AWS/ApiGateway",
        metricName,
        dimensionsMap: { ApiId: apiId },
        statistic: "Sum",
        period: cdk.Duration.minutes(5),
      });

    const dynamoThrottledRequests = new cloudwatch.Metric({
      namespace: "AWS/DynamoDB",
      metricName: "ThrottledRequests",
      dimensionsMap: { TableName: tableName },
      statistic: "Sum",
      period: cdk.Duration.minutes(5),
    });

    // CloudFront always publishes its CloudWatch metrics to us-east-1,
    // regardless of the region this stack deploys to — so every metric
    // below pins `region: "us-east-1"` explicitly (CloudWatch dashboards
    // support graphing metrics from a region other than the dashboard's
    // own). CacheHitRate/error-rate metrics require FrontendStack's
    // CfnMonitoringSubscription ("additional metrics") to be enabled.
    const cloudFrontMetric = (metricName: string, statistic: string) =>
      new cloudwatch.Metric({
        namespace: "AWS/CloudFront",
        metricName,
        dimensionsMap: { DistributionId: distributionId, Region: "Global" },
        region: "us-east-1",
        statistic,
      });

    const dashboard = new cloudwatch.Dashboard(this, "Dashboard", {
      dashboardName: `badgetag-${environment}`,
    });

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: "Lambda Invocations & Errors",
        left: [lambdaInvocations, lambdaErrors],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: "Lambda Duration (p50 / p99)",
        left: [lambdaDurationP50, lambdaDurationP99],
        width: 12,
      }),
    );

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: "API Gateway Requests / 4xx / 5xx",
        left: [apiGatewayMetric("Count"), apiGatewayMetric("4xxError"), apiGatewayMetric("5xxError")],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: "DynamoDB Throttled Requests",
        left: [dynamoThrottledRequests],
        width: 12,
      }),
    );

    dashboard.addWidgets(
      new cloudwatch.LogQueryWidget({
        title: "Profiles Created (usage counter)",
        logGroupNames: [logGroupName],
        view: cloudwatch.LogQueryVisualizationType.TABLE,
        queryLines: ['filter fields.metric = "profile_created"', "stats count() as profiles_created"],
      }),
      new cloudwatch.LogQueryWidget({
        title: "Public Card Views (usage counter)",
        logGroupNames: [logGroupName],
        view: cloudwatch.LogQueryVisualizationType.TABLE,
        queryLines: ['filter fields.metric = "public_card_view"', "stats count() as card_views"],
      }),
    );

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: "CloudFront Requests",
        left: [cloudFrontMetric("Requests", "Sum")],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: "CloudFront Cache Hit Rate (%)",
        left: [cloudFrontMetric("CacheHitRate", "Average")],
        width: 12,
      }),
    );

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: "CloudFront Data Transfer",
        left: [cloudFrontMetric("BytesDownloaded", "Sum"), cloudFrontMetric("BytesUploaded", "Sum")],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: "CloudFront Error Rates (%)",
        left: [
          cloudFrontMetric("4xxErrorRate", "Average"),
          cloudFrontMetric("5xxErrorRate", "Average"),
          cloudFrontMetric("TotalErrorRate", "Average"),
        ],
        width: 12,
      }),
    );

    dashboard.addWidgets(
      new cloudwatch.TextWidget({
        markdown:
          "**Geographic traffic**: CloudFront doesn't publish a per-country " +
          "breakdown to CloudWatch. View it in the CloudFront console under " +
          "this distribution → Reports & analytics → Viewers, or at " +
          `https://console.aws.amazon.com/cloudfront/v4/home?region=us-east-1#/distributions/${distributionId}`,
        width: 24,
        height: 2,
      }),
    );
  }
}
