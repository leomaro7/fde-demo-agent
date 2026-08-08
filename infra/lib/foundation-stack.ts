import {
  Stack,
  StackProps,
  CfnOutput,
  RemovalPolicy,
  aws_cognito as cognito,
  aws_amplify as amplify,
} from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import { harnessExecutionRole } from './harness-execution-role.js';

export interface FoundationStackProps extends StackProps {
  /** 同一アカウントに複数の土台を置くための識別子。グローバル一意な名前に必ず入る。 */
  readonly instance: string;
}

export class FoundationStack extends Stack {
  readonly userPool: cognito.UserPool;

  constructor(scope: Construct, id: string, props: FoundationStackProps) {
    super(scope, id, props);
    const { instance } = props;

    // デモは数週間で廃棄する前提。撤去は 1 手で残骸なく終わる必要がある。
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // ドメインプレフィックスはリージョン内で全 AWS アカウント共通の名前空間。
    // 一意性の責任は instance を決める人にある。アカウント ID は入れない
    // （ログイン URL はクライアントのブラウザに表示される）。
    this.userPool.addDomain('Domain', {
      cognitoDomain: { domainPrefix: instance },
    });

    // リポジトリは接続しない。中身は start-deployment で ZIP を上げる。
    // 接続すると GitHub のアクセストークンが要り、シークレットを CFn に持ち込むことになる。
    const amplifyApp = new amplify.CfnApp(this, 'App', { name: `fde-demo-${instance}` });

    const executionRole = harnessExecutionRole(this, 'HarnessExecutionRole');

    new CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      exportName: `${this.stackName}-UserPoolId`,
    });
    new CfnOutput(this, 'DiscoveryUrl', {
      value: `https://cognito-idp.${this.region}.amazonaws.com/${this.userPool.userPoolId}/.well-known/openid-configuration`,
      exportName: `${this.stackName}-DiscoveryUrl`,
    });
    new CfnOutput(this, 'AmplifyAppId', {
      value: amplifyApp.attrAppId,
      exportName: `${this.stackName}-AmplifyAppId`,
    });
    new CfnOutput(this, 'ExecutionRoleArn', {
      value: executionRole.roleArn,
      exportName: `${this.stackName}-ExecutionRoleArn`,
    });
  }
}
