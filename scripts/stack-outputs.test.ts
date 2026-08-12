import { describe, it, expect } from 'vitest';
import { toEnvLines } from './stack-outputs.js';

describe('toEnvLines', () => {
  it('スタック出力を Vite が読む環境変数の形にする', () => {
    const lines = toEnvLines({
      HarnessArn: 'arn:aws:bedrock-agentcore:ap-northeast-1:1:harness/a_b-c',
      ClientId: 'client-1',
      HostedUiDomain: 'https://x.auth.ap-northeast-1.amazoncognito.com',
      DemoUrl: 'https://smoke.app.amplifyapp.com',
    }, 'smoke');
    expect(lines.split('\n').sort()).toEqual([
      'VITE_CLIENT_ID=client-1',
      'VITE_COGNITO_DOMAIN=https://x.auth.ap-northeast-1.amazoncognito.com',
      'VITE_DEMO_SLUG=smoke',
      'VITE_HARNESS_ARN=arn:aws:bedrock-agentcore:ap-northeast-1:1:harness/a_b-c',
    ]);
  });

  it('必要な出力が欠けていたら投げる', () => {
    expect(() => toEnvLines({ ClientId: 'c' }, 'smoke')).toThrow(/HarnessArn/);
  });
});
