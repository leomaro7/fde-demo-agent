import { describe, it, expect } from 'vitest';
import { readConfig } from './config.js';

const full = {
  VITE_HARNESS_ARN: 'arn:aws:bedrock-agentcore:ap-northeast-1:1:harness/a_b-c',
  VITE_COGNITO_DOMAIN: 'https://x.auth.ap-northeast-1.amazoncognito.com',
  VITE_CLIENT_ID: 'client-1',
};

describe('readConfig', () => {
  it('必要な値をそろえて返す', () => {
    expect(readConfig(full)).toEqual({
      harnessArn: full.VITE_HARNESS_ARN,
      cognitoDomain: full.VITE_COGNITO_DOMAIN,
      clientId: full.VITE_CLIENT_ID,
      region: 'ap-northeast-1',
    });
  });

  it('足りない値があれば、どれが足りないかを言って投げる', () => {
    // 空白の画面だけ出て原因が分からないのが最悪なので、起動時に落とす
    expect(() => readConfig({ ...full, VITE_CLIENT_ID: undefined })).toThrow(/VITE_CLIENT_ID/);
  });
});
