import { describe, it, expect } from 'vitest';
import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { FoundationStack } from './foundation-stack.js';

function synth(instance = 'demo1') {
  const app = new App();
  const stack = new FoundationStack(app, `FdeDemo-${instance}-Foundation`, {
    instance,
    env: { account: '123456789012', region: 'ap-northeast-1' },
  });
  return Template.fromStack(stack);
}

describe('FoundationStack', () => {
  it('Cognito ドメインのプレフィックスは instance そのもの', () => {
    const t = synth('demo1');
    t.hasResourceProperties('AWS::Cognito::UserPoolDomain', { Domain: 'demo1' });
    // 注: ブリーフ原文は `expect(JSON.stringify(t.toJSON())).not.toContain('123456789012')`
    // でテンプレート全文を走査していたが、これは削除した。実行ロールの信頼ポリシーは
    // aws:SourceAccount にアカウント ID の実値を要求する（このファイル内の次のテストが
    // 検証している。要件は harness-execution-role.ts 冒頭のコメント参照）ため、
    // テンプレート全文にアカウント ID が一切現れないことは原理的に成立しない。
    // ここで守るべきなのは「利用者に見える名前」（Cognito ドメイン、Amplify アプリ名、
    // IAM ロール名）にアカウント ID が入らないことであり、上の hasResourceProperties と
    // 下のテストがそれぞれ検証している。
  });

  it('Amplify アプリ名に instance が入る', () => {
    synth('demo1').hasResourceProperties('AWS::Amplify::App', { Name: 'fde-demo-demo1' });
  });

  it('IAM ロール名を指定しない（自動命名に任せる）', () => {
    const roles = synth().findResources('AWS::IAM::Role');
    for (const role of Object.values(roles)) {
      expect(role.Properties).not.toHaveProperty('RoleName');
    }
  });

  it('実行ロールの信頼ポリシーが SourceAccount で絞られている', () => {
    synth().hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Principal: { Service: 'bedrock-agentcore.amazonaws.com' },
            Condition: Match.objectLike({
              StringEquals: { 'aws:SourceAccount': '123456789012' },
            }),
          }),
        ]),
      }),
    });
  });

  it('案件スタックが要る 4 つを Export する', () => {
    const outputs = synth().findOutputs('*');
    const names = Object.values(outputs).map((o: any) => o.Export?.Name);
    expect(names).toEqual(
      expect.arrayContaining([
        'FdeDemo-demo1-Foundation-UserPoolId',
        'FdeDemo-demo1-Foundation-DiscoveryUrl',
        'FdeDemo-demo1-Foundation-AmplifyAppId',
        'FdeDemo-demo1-Foundation-ExecutionRoleArn',
      ]),
    );
  });
});
