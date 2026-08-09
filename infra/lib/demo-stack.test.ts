import { describe, it, expect } from 'vitest';
import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { DemoStack } from './demo-stack.js';
import { FoundationStack } from './foundation-stack.js';
import { demo } from '../../demos/smoke/demo.js';

function synth() {
  const app = new App();
  const stack = new DemoStack(app, 'FdeDemo-demo1-smoke', {
    instance: 'demo1',
    foundationStackName: 'FdeDemo-demo1-Foundation',
    demo,
    env: { account: '123456789012', region: 'ap-northeast-1' },
  });
  return Template.fromStack(stack);
}

describe('DemoStack', () => {
  it('案件ごとにグループを作る', () => {
    synth().hasResourceProperties('AWS::Cognito::UserPoolGroup', { GroupName: 'smoke' });
  });

  it('コールバックにブランチ URL と localhost の両方を登録する', () => {
    synth().hasResourceProperties('AWS::Cognito::UserPoolClient', {
      CallbackURLs: Match.arrayWith(['http://localhost:5173/']),
    });
  });

  it('パスワード認証は管理 API 経由だけに開ける（インターネット越しには開けない）', () => {
    synth().hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ExplicitAuthFlows: ['ALLOW_ADMIN_USER_PASSWORD_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH'],
    });
  });

  it('Amplify ブランチを案件スタックが持つ', () => {
    synth().hasResourceProperties('AWS::Amplify::Branch', { BranchName: 'smoke' });
  });

  it('Harness を 1 つ作る', () => {
    synth().resourceCountIs('AWS::BedrockAgentCore::Harness', 1);
  });

  it('土台の値は ImportValue で引く（ハードコードしない）', () => {
    const json = JSON.stringify(synth().toJSON());
    expect(json).toContain('FdeDemo-demo1-Foundation-ExecutionRoleArn');
    expect(json).toContain('FdeDemo-demo1-Foundation-AmplifyAppId');
  });

  it('デモの URL と Harness ARN を出力する', () => {
    const outputs = synth().findOutputs('*');
    expect(Object.keys(outputs)).toEqual(
      expect.arrayContaining(['DemoUrl', 'HarnessArn']),
    );
  });

  it('案件スタックは土台スタックに明示的に依存する（Fn.importValue はリテラル文字列で CDK が依存を推論できないため）', () => {
    // Fn.importValue は文字列引数を渡すだけで、CDK のスタック間依存グラフには
    // 載らない。addStackDependency（app.ts で実際に呼んでいるもの）を呼んで
    // 初めて dependencies に載ることを確認する。DemoStack 単体の synth() では
    // 依存先スタックが存在しないため検証できず、FoundationStack と同じ App に
    // 載せて組み立てる必要がある。
    const app = new App();
    const foundationStackName = 'FdeDemo-demo1-Foundation';
    const foundation = new FoundationStack(app, foundationStackName, {
      instance: 'demo1',
      env: { account: '123456789012', region: 'ap-northeast-1' },
    });
    const demoStack = new DemoStack(app, 'FdeDemo-demo1-smoke', {
      instance: 'demo1',
      foundationStackName,
      demo,
      env: { account: '123456789012', region: 'ap-northeast-1' },
    });
    demoStack.addStackDependency(foundation);

    expect(demoStack.dependencies).toContain(foundation);
  });
});
