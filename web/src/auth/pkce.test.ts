import { describe, it, expect } from 'vitest';
import { base64UrlEncode, randomUrlSafe, challengeFromVerifier, createPkcePair } from './pkce.js';

describe('base64UrlEncode', () => {
  it('URL に使えない文字を出さない', () => {
    const encoded = base64UrlEncode(new Uint8Array([251, 255, 190, 0, 1, 2]));
    expect(encoded).not.toMatch(/[+/=]/);
  });
});

describe('challengeFromVerifier', () => {
  it('RFC 7636 の例と一致する', async () => {
    // RFC 7636 Appendix B の値。実装が正しいことの動かぬ証拠になる
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    await expect(challengeFromVerifier(verifier)).resolves.toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });
});

describe('randomUrlSafe', () => {
  it('呼ぶたびに違う値を返す', () => {
    expect(randomUrlSafe(32)).not.toBe(randomUrlSafe(32));
  });
});

describe('createPkcePair', () => {
  it('verifier から導いた challenge を返す', async () => {
    const pair = await createPkcePair();
    await expect(challengeFromVerifier(pair.verifier)).resolves.toBe(pair.challenge);
  });

  it('verifier は RFC 7636 の長さ制約（43〜128 文字）に収まる', async () => {
    const { verifier } = await createPkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
  });
});
