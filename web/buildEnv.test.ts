import { describe, it, expect } from 'vitest';
import { parseEnvText, requireBuildEnv } from './buildEnv.js';

describe('parseEnvText', () => {
  it('KEY=VALUE の行を読める', () => {
    expect(parseEnvText('VITE_CLIENT_ID=abc123')).toEqual({ VITE_CLIENT_ID: 'abc123' });
  });

  it('値に = が含まれても壊れない（ARN や URL がそのまま入る）', () => {
    const text = 'VITE_HARNESS_ARN=arn:aws:bedrock-agentcore:ap-northeast-1:123:harness/a_b-c';
    expect(parseEnvText(text)).toEqual({
      VITE_HARNESS_ARN: 'arn:aws:bedrock-agentcore:ap-northeast-1:123:harness/a_b-c',
    });
  });

  it('# で始まる行と空行を無視する', () => {
    const text = ['# コメント', '', 'VITE_CLIENT_ID=abc123', ''].join('\n');
    expect(parseEnvText(text)).toEqual({ VITE_CLIENT_ID: 'abc123' });
  });
});

describe('requireBuildEnv', () => {
  const full = {
    VITE_HARNESS_ARN: 'arn:aws:bedrock-agentcore:ap-northeast-1:123:harness/a_b-c',
    VITE_COGNITO_DOMAIN: 'https://fdedemo0809.auth.ap-northeast-1.amazoncognito.com',
    VITE_CLIENT_ID: 'abc123',
  };

  it('必須キーが揃っていればそのまま返す', () => {
    expect(requireBuildEnv(full)).toEqual(full);
  });

  it('必須キーが欠けていたら、欠けているキー名を含むメッセージで投げる', () => {
    const { VITE_CLIENT_ID: _drop, ...rest } = full;
    expect(() => requireBuildEnv(rest)).toThrow(/VITE_CLIENT_ID/);
  });

  it('複数の必須キーが欠けていたら、すべてのキー名を含むメッセージで投げる', () => {
    expect(() => requireBuildEnv({})).toThrow(/VITE_HARNESS_ARN/);
    expect(() => requireBuildEnv({})).toThrow(/VITE_COGNITO_DOMAIN/);
    expect(() => requireBuildEnv({})).toThrow(/VITE_CLIENT_ID/);
  });

  it('余計なキー（VITE_AWS_REGION など）が混ざっていても、必須キーだけを返す', () => {
    const polluted = { ...full, VITE_AWS_REGION: 'us-east-1', VITE_USER_POOL_ID: 'pool-1' };
    expect(requireBuildEnv(polluted)).toEqual(full);
  });
});
