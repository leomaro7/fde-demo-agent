import { describe, it, expect } from 'vitest';
import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { DemoStack } from './demo-stack.js';
import type { DemoConfig } from './demo-config.js';

/**
 * 検査用の案件。**見本の案件を import しない。**
 *
 * 企業リポジトリでは見本を消す（RUNBOOK 4.4）。見本に依存していると、
 * 消した瞬間にこのテストが読み込めなくなり、**土台の検査ごと落ちる**。
 * 実際に落ちた（2026-08-14）。ここで見たいのは DemoStack の形であって、
 * どの案件を渡したかではない。
 */
const demo: DemoConfig = {
  slug: 'smoke',
  clientName: '検査用',
  brand: { primary: '#000000' },
  harness: {
    modelId: 'global.anthropic.claude-sonnet-5',
    systemPrompt: '検査用',
    tools: [],
  },
  examples: ['1', '2', '3'],
};

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

});
