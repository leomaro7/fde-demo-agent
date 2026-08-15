import { describe, it, expect } from 'vitest';
import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { Harness, HarnessToolSpec } from './harness.js';

function synth(tools?: readonly HarnessToolSpec[]) {
  const app = new App();
  const stack = new Stack(app, 'Test', {
    env: { account: '123456789012', region: 'ap-northeast-1' },
  });
  new Harness(stack, 'Harness', {
    instance: 'demo1',
    slug: 'smoke',
    executionRoleArn: 'arn:aws:iam::123456789012:role/role-name',
    modelId: 'global.anthropic.claude-sonnet-5',
    systemPrompt: 'あなたは検証用のエージェントです。',
    tools: tools ?? [
      {
        type: 'inline_function',
        name: 'search',
        description: 'キーワードで検索する',
        inputSchema: { type: 'object', properties: { keyword: { type: 'string' } } },
      },
      { type: 'agentcore_code_interpreter', name: 'code' },
    ],
    discoveryUrl: 'https://example.invalid/.well-known/openid-configuration',
    allowedClientId: 'client-abc',
  });
  return Template.fromStack(stack);
}

describe('Harness', () => {
  it('SystemPrompt は [{ Text }] の配列で出る', () => {
    synth().hasResourceProperties('AWS::BedrockAgentCore::Harness', {
      SystemPrompt: [{ Text: 'あなたは検証用のエージェントです。' }],
    });
  });

  it('Memory を省略せず Disabled を明示する', () => {
    // 省略するとサービスが managed memory を勝手に用意してしまう
    synth().hasResourceProperties('AWS::BedrockAgentCore::Harness', {
      Memory: { Disabled: {} },
    });
  });

  it('HarnessName はハイフンを含まない', () => {
    synth().hasResourceProperties('AWS::BedrockAgentCore::Harness', {
      HarnessName: 'demo1_smoke',
    });
  });

  it('cognito:groups を CONTAINS で検証する', () => {
    synth().hasResourceProperties('AWS::BedrockAgentCore::Harness', {
      AuthorizerConfiguration: {
        CustomJWTAuthorizer: {
          DiscoveryUrl: 'https://example.invalid/.well-known/openid-configuration',
          AllowedClients: ['client-abc'],
          CustomClaims: [
            {
              InboundTokenClaimName: 'cognito:groups',
              InboundTokenClaimValueType: 'STRING_ARRAY',
              AuthorizingClaimMatchValue: {
                ClaimMatchValue: { MatchValueString: 'smoke' },
                ClaimMatchOperator: 'CONTAINS',
              },
            },
          ],
        },
      },
    });
  });

  it('ツールは Type / Name / Config の形で出る', () => {
    synth().hasResourceProperties('AWS::BedrockAgentCore::Harness', {
      Tools: [
        {
          Type: 'inline_function',
          Name: 'search',
          Config: {
            InlineFunction: {
              Description: 'キーワードで検索する',
              InputSchema: { type: 'object', properties: { keyword: { type: 'string' } } },
            },
          },
        },
        { Type: 'agentcore_code_interpreter', Name: 'code', Config: { AgentCoreCodeInterpreter: {} } },
      ],
    });
  });

  it('VPC を使わないので Environment を出さない', () => {
    const resources = synth().findResources('AWS::BedrockAgentCore::Harness');
    const props = Object.values(resources)[0].Properties;
    expect(props).not.toHaveProperty('Environment');
  });

  it('inline_function で description がないとき Harness 構築時にエラーが出る', () => {
    expect(() =>
      synth([
        {
          type: 'inline_function',
          name: 'search',
          inputSchema: { type: 'object', properties: { keyword: { type: 'string' } } },
        },
      ]),
    ).toThrow(`inline_function のツール "search" には description と inputSchema が必要です。`);
  });

  it('inline_function で inputSchema がないとき Harness 構築時にエラーが出る', () => {
    expect(() =>
      synth([
        {
          type: 'inline_function',
          name: 'search',
          description: 'キーワードで検索する',
        },
      ]),
    ).toThrow(`inline_function のツール "search" には description と inputSchema が必要です。`);
  });
});
