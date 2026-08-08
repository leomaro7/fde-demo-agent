import {
  Stack,
  StackProps,
  CfnOutput,
  Fn,
  aws_cognito as cognito,
  aws_amplify as amplify,
} from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import { Harness } from './harness.js';
import type { DemoConfig } from './demo-config.js';

export interface DemoStackProps extends StackProps {
  readonly instance: string;
  /** 土台スタック名。Export 名の組み立てに使う。 */
  readonly foundationStackName: string;
  readonly demo: DemoConfig;
}

export class DemoStack extends Stack {
  constructor(scope: Construct, id: string, props: DemoStackProps) {
    super(scope, id, props);
    const { instance, foundationStackName, demo } = props;
    const slug = demo.slug;

    // 土台の値は ImportValue で引く。土台が案件に使われている間は土台を消せなくなるが、
    // それは望ましい挙動（撤去漏れがそのまま検出される）。
    const userPoolId = Fn.importValue(`${foundationStackName}-UserPoolId`);
    const discoveryUrl = Fn.importValue(`${foundationStackName}-DiscoveryUrl`);
    const amplifyAppId = Fn.importValue(`${foundationStackName}-AmplifyAppId`);
    const executionRoleArn = Fn.importValue(`${foundationStackName}-ExecutionRoleArn`);

    const branch = new amplify.CfnBranch(this, 'Branch', {
      appId: amplifyAppId,
      branchName: slug,
    });

    const demoUrl = `https://${slug}.${amplifyAppId}.amplifyapp.com`;

    // コールバック URL はワイルドカード不可。案件ごとに Client を作る。
    // localhost はローカル開発に要る。デモ用途なので残ることは許容する。
    const client = new cognito.CfnUserPoolClient(this, 'Client', {
      userPoolId,
      clientName: `${instance}-${slug}`,
      generateSecret: false,
      allowedOAuthFlows: ['code'],
      allowedOAuthScopes: ['openid', 'email'],
      allowedOAuthFlowsUserPoolClient: true,
      supportedIdentityProviders: ['COGNITO'],
      // `callbackUrLs` / `logoutUrLs` の綴りは誤字ではない。CFn の CallbackURLs を
      // jsii が変換した結果であり、これが aws-cdk-lib の正しいプロパティ名。直さないこと
      callbackUrLs: [`${demoUrl}/`, 'http://localhost:5173/'],
      logoutUrLs: [`${demoUrl}/`, 'http://localhost:5173/'],
    });

    // 案件ごとのグループ。Harness がこの名前を cognito:groups に CONTAINS で探す。
    new cognito.CfnUserPoolGroup(this, 'Group', {
      userPoolId,
      groupName: slug,
    });

    const harness = new Harness(this, 'Harness', {
      instance,
      slug,
      executionRoleArn,
      modelId: demo.harness.modelId,
      systemPrompt: demo.harness.systemPrompt,
      tools: demo.harness.tools,
      discoveryUrl,
      allowedClientId: client.ref,
    });

    new CfnOutput(this, 'DemoUrl', { value: demoUrl });
    new CfnOutput(this, 'HarnessArn', { value: harness.harnessArn });
    new CfnOutput(this, 'ClientId', { value: client.ref });
    new CfnOutput(this, 'BranchName', { value: branch.branchName });
  }
}
