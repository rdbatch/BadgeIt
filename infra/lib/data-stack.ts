import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

/**
 * Builds the predictable SSM parameter namespace for a given environment.
 * Consumer stacks (ApiStack, FrontendStack) compute the same paths from
 * just the environment name, so they never need a direct CDK construct
 * reference to DataStack — decoupling them from DataStack's CloudFormation
 * lifecycle (no `Fn::ImportValue`, no hard cross-stack delete/replace
 * dependency).
 */
export function dataStackParamPaths(environment: string) {
  const base = `/badgetag/${environment}/data`;
  return {
    tableArn: `${base}/table-arn`,
    tableName: `${base}/table-name`,
    imageBucketArn: `${base}/image-bucket-arn`,
    imageBucketName: `${base}/image-bucket-name`,
  };
}

/**
 * DataStack — DynamoDB Global Table and S3 image bucket for BadgeTag profiles.
 */
export class DataStack extends cdk.Stack {
  /** The single DynamoDB Global Table for all profile data */
  public readonly table: dynamodb.TableV2;

  /** The S3 bucket for profile images */
  public readonly imageBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // DynamoDB Global Table (single-table design)
    // Uses TableV2 which deploys as a Global Table with one replica in the
    // primary region. Additional replicas can be added later for multi-region.
    // NOTE: The physical table name retains the original "badgetag" prefix
    // to avoid CloudFormation resource replacement (which would destroy
    // data). Code references this table via stack outputs / env vars, not
    // by hardcoded name.
    this.table = new dynamodb.TableV2(this, "ProfileTable", {
      tableName: `badgetag-profiles-${this.node.tryGetContext("environment") ?? "dev"}`,
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // S3 bucket for profile images — stays fully private. Reads happen only
    // through the frontend's CloudFront distribution (via Origin Access
    // Control, wired up in FrontendStack), writes happen only through the
    // Lambda (grantReadWrite in ApiStack).
    // NOTE: The physical bucket name retains the original "badgetag" prefix
    // to avoid CloudFormation resource replacement (which would destroy
    // data). Code references this bucket via stack outputs / env vars, not
    // by hardcoded name.
    this.imageBucket = new s3.Bucket(this, "ImageBucket", {
      bucketName: `badgetag-images-${cdk.Aws.ACCOUNT_ID}-${this.node.tryGetContext("environment") ?? "dev"}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          id: "cleanup-orphaned-uploads",
          prefix: "uploads/",
          expiration: cdk.Duration.days(7),
        },
      ],
    });

    // Grant CloudFront (via Origin Access Control) read access to this
    // bucket. This must live here — in the stack that owns the actual
    // `AWS::S3::Bucket` resource — rather than in FrontendStack. FrontendStack
    // only holds an *imported* bucket handle (via `fromBucketArn`, resolved
    // from the SSM parameter below), and `addToResourcePolicy()` on an
    // imported bucket is a silent no-op: it never synthesizes an
    // `AWS::S3::BucketPolicy` resource, so no policy would ever actually be
    // created if this were added on the FrontendStack side.
    //
    // Scoped to "any CloudFront distribution in this account" (AWS:SourceArn
    // wildcard) rather than one specific distribution ID, since this stack
    // has no reference to (and must not depend on) FrontendStack's
    // distribution. For this project (single account, one distribution)
    // the security delta is negligible; tighten this if that ever changes.
    this.imageBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal("cloudfront.amazonaws.com")],
        actions: ["s3:GetObject"],
        resources: [this.imageBucket.arnForObjects("*")],
        conditions: {
          ArnLike: {
            "AWS:SourceArn": `arn:${cdk.Aws.PARTITION}:cloudfront::${this.account}:distribution/*`,
          },
        },
      }),
    );

    // Publish identifiers to SSM Parameter Store instead of CloudFormation
    // stack exports. Consumer stacks read these by predictable path (see
    // `dataStackParamPaths`) and reconstruct `ITable`/`IBucket` handles via
    // `fromTableArn`/`fromBucketAttributes`, preserving correct, minimal
    // IAM grants (grantReadWriteData/grantReadWrite) without CloudFormation
    // creating a hard `Fn::ImportValue` dependency on this stack. That
    // dependency is what previously blocked deleting/replacing this stack
    // while ApiStack/FrontendStack were still deployed.
    const environment = this.node.tryGetContext("environment") ?? "dev";
    const paramPaths = dataStackParamPaths(environment);

    new ssm.StringParameter(this, "TableArnParam", {
      parameterName: paramPaths.tableArn,
      stringValue: this.table.tableArn,
    });

    new ssm.StringParameter(this, "TableNameParam", {
      parameterName: paramPaths.tableName,
      stringValue: this.table.tableName,
    });

    new ssm.StringParameter(this, "ImageBucketArnParam", {
      parameterName: paramPaths.imageBucketArn,
      stringValue: this.imageBucket.bucketArn,
    });

    new ssm.StringParameter(this, "ImageBucketNameParam", {
      parameterName: paramPaths.imageBucketName,
      stringValue: this.imageBucket.bucketName,
    });

    // Outputs retained for human visibility (console/CLI) only — no
    // exportName, so no other stack can create a CloudFormation import
    // dependency on them.
    new cdk.CfnOutput(this, "TableName", {
      value: this.table.tableName,
    });

    new cdk.CfnOutput(this, "TableArn", {
      value: this.table.tableArn,
    });

    new cdk.CfnOutput(this, "ImageBucketName", {
      value: this.imageBucket.bucketName,
    });

    new cdk.CfnOutput(this, "ImageBucketArn", {
      value: this.imageBucket.bucketArn,
    });
  }
}
