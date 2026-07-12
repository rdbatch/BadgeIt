import * as cdk from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import { AuthStack } from "../lib/auth-stack";

describe("AuthStack", () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App({ context: { environment: "test" } });
    const stack = new AuthStack(app, "TestAuthStack", {
      tags: { project: "badgeit", environment: "test" },
      sesDomainName: "test.badgeit.app",
    });
    template = Template.fromStack(stack);
  });

  describe("Cognito User Pool", () => {
    test("creates a user pool with email sign-in", () => {
      template.hasResourceProperties("AWS::Cognito::UserPool", {
        UsernameAttributes: ["email"],
        AutoVerifiedAttributes: ["email"],
      });
    });

    test("enables self sign-up", () => {
      template.hasResourceProperties("AWS::Cognito::UserPool", {
        AdminCreateUserConfig: {
          AllowAdminCreateUserOnly: false,
        },
      });
    });

    test("enables email OTP in sign-in policy", () => {
      template.hasResourceProperties("AWS::Cognito::UserPool", {
        Policies: {
          SignInPolicy: {
            AllowedFirstAuthFactors: ["PASSWORD", "EMAIL_OTP"],
          },
        },
      });
    });

    test("uses Essentials feature plan for choice-based auth", () => {
      template.hasResourceProperties("AWS::Cognito::UserPool", {
        UserPoolTier: "ESSENTIALS",
      });
    });

    test("has RETAIN deletion policy", () => {
      template.hasResource("AWS::Cognito::UserPool", {
        DeletionPolicy: "Retain",
        UpdateReplacePolicy: "Retain",
      });
    });
  });

  describe("User Pool Client", () => {
    test("creates a client with USER_AUTH flow", () => {
      template.hasResourceProperties("AWS::Cognito::UserPoolClient", {
        ExplicitAuthFlows: Match.arrayWith(["ALLOW_USER_AUTH"]),
      });
    });

    test("does not allow SRP or user password flows", () => {
      template.hasResourceProperties("AWS::Cognito::UserPoolClient", {
        ExplicitAuthFlows: Match.not(
          Match.arrayWith(["ALLOW_USER_SRP_AUTH"]),
        ),
      });
    });

    test("allows refresh token auth so the frontend can silently renew tokens", () => {
      template.hasResourceProperties("AWS::Cognito::UserPoolClient", {
        ExplicitAuthFlows: Match.arrayWith(["ALLOW_REFRESH_TOKEN_AUTH"]),
      });
    });

    test("prevents user existence errors", () => {
      template.hasResourceProperties("AWS::Cognito::UserPoolClient", {
        PreventUserExistenceErrors: "ENABLED",
      });
    });

    test("sets explicit token validity so lifetimes are not left to Cognito defaults", () => {
      template.hasResourceProperties("AWS::Cognito::UserPoolClient", {
        IdTokenValidity: 60,
        AccessTokenValidity: 60,
        RefreshTokenValidity: 43200, // 30 days, expressed in minutes by CDK
        TokenValidityUnits: {
          IdToken: "minutes",
          AccessToken: "minutes",
          RefreshToken: "minutes",
        },
      });
    });
  });

  describe("SSM Parameters", () => {
    test("publishes user pool ID to SSM", () => {
      template.hasResourceProperties("AWS::SSM::Parameter", {
        Name: "/badgeit/test/auth/user-pool-id",
        Type: "String",
      });
    });

    test("publishes user pool client ID to SSM", () => {
      template.hasResourceProperties("AWS::SSM::Parameter", {
        Name: "/badgeit/test/auth/user-pool-client-id",
        Type: "String",
      });
    });
  });

  describe("Outputs", () => {
    test("has a User Pool ID output with no CloudFormation export (avoids hard cross-stack dependency)", () => {
      template.hasOutput("UserPoolId", { Export: Match.absent() });
    });

    test("has a User Pool Client ID output with no CloudFormation export", () => {
      template.hasOutput("UserPoolClientId", { Export: Match.absent() });
    });

    test("has an SES from address output with no CloudFormation export", () => {
      template.hasOutput("SesFromAddress", {
        Value: "noreply@test.badgeit.app",
        Export: Match.absent(),
      });
    });
  });

  describe("SES Email Identity", () => {
    test("creates a domain identity for the configured SES domain", () => {
      template.hasResourceProperties("AWS::SES::EmailIdentity", {
        EmailIdentity: "test.badgeit.app",
      });
    });

    test("configures the User Pool to send email via SES with the domain-based from address", () => {
      template.hasResourceProperties("AWS::Cognito::UserPool", {
        EmailConfiguration: {
          EmailSendingAccount: "DEVELOPER",
          From: "BadgeIt <noreply@test.badgeit.app>",
        },
      });
    });
  });

  test("does not create a Pre Sign-up trigger (new users must confirm via a real emailed code)", () => {
    template.resourceCountIs("AWS::Lambda::Function", 0);
    const userPools = template.findResources("AWS::Cognito::UserPool");
    for (const userPool of Object.values(userPools)) {
      expect(userPool.Properties.LambdaConfig).toBeUndefined();
    }
  });
});
