import * as cdk from "aws-cdk-lib";
import * as wafv2 from "aws-cdk-lib/aws-wafv2";
import { Construct } from "constructs";

export interface WafStackProps extends cdk.StackProps {
  readonly environment: string;
}

/**
 * WafStack — the CLOUDFRONT-scope WAF Web ACL that FrontendStack's
 * distribution must be associated with to use a CloudFront flat-rate
 * pricing plan. Always deployed to us-east-1 regardless of the app's
 * `--context region` — CLOUDFRONT-scope WAFv2 resources can only be
 * created via the us-east-1 API endpoint. FrontendStack references this
 * stack's Web ACL ARN directly via `crossRegionReferences` (see app.ts).
 *
 * Rule groups here are Free-tier-compatible; AWS WAF's documented
 * "Baseline"/"IP reputation" categories don't reliably predict this —
 * Admin protection and Anonymous IP list are both rejected by the WAFv2
 * API on Free tier despite Admin protection being categorized as
 * "Baseline." Verify any addition against the live Web ACL before
 * assuming it'll deploy.
 */
export class WafStack extends cdk.Stack {
  public readonly webAcl: wafv2.CfnWebACL;

  constructor(scope: Construct, id: string, props: WafStackProps) {
    super(scope, id, props);

    const environment = props.environment;

    const managedRule = (
      name: string,
      priority: number,
      metricSuffix: string,
      ruleActionOverrides?: wafv2.CfnWebACL.RuleActionOverrideProperty[],
    ): wafv2.CfnWebACL.RuleProperty => ({
      name,
      priority,
      overrideAction: { none: {} },
      statement: {
        managedRuleGroupStatement: {
          vendorName: "AWS",
          name,
          ruleActionOverrides,
        },
      },
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: `badgetag-${environment}-${metricSuffix}`,
      },
    });

    this.webAcl = new wafv2.CfnWebACL(this, "WebAcl", {
      name: `badgetag-${environment}`,
      scope: "CLOUDFRONT",
      defaultAction: { allow: {} },
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: `badgetag-${environment}`,
      },
      rules: [
        managedRule("AWSManagedRulesCommonRuleSet", 0, "core-rule-set", [
          // Default CRS blocks any request body over 8KB. Profile picture
          // uploads send a base64-encoded, resized JPEG in a JSON body that
          // routinely exceeds that — count instead of block so uploads
          // aren't silently dropped by WAF before reaching the API.
          { name: "SizeRestrictions_BODY", actionToUse: { count: {} } },
        ]),
        managedRule("AWSManagedRulesKnownBadInputsRuleSet", 1, "known-bad-inputs"),
        managedRule("AWSManagedRulesAmazonIpReputationList", 2, "ip-reputation"),
        {
          name: "RateLimitPerIp",
          priority: 3,
          action: { block: {} },
          statement: {
            rateBasedStatement: {
              limit: 2000,
              evaluationWindowSec: 300,
              aggregateKeyType: "IP",
            },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: `badgetag-${environment}-rate-limit`,
          },
        },
      ],
    });
  }
}
