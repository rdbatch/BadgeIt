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
    ): wafv2.CfnWebACL.RuleProperty => ({
      name,
      priority,
      overrideAction: { none: {} },
      statement: {
        managedRuleGroupStatement: {
          vendorName: "AWS",
          name,
        },
      },
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: `badgeit-${environment}-${metricSuffix}`,
      },
    });

    this.webAcl = new wafv2.CfnWebACL(this, "WebAcl", {
      name: `badgeit-${environment}`,
      scope: "CLOUDFRONT",
      defaultAction: { allow: {} },
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: `badgeit-${environment}`,
      },
      rules: [
        managedRule("AWSManagedRulesCommonRuleSet", 0, "core-rule-set"),
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
            metricName: `badgeit-${environment}-rate-limit`,
          },
        },
      ],
    });
  }
}
