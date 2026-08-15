import { describe, it, expect } from 'vitest';
import { MODELS } from './models.js';

describe('MODELS', () => {
  it('すべて推論プロファイルの ID になっている', () => {
    // 素の ID（anthropic.claude-sonnet-5）を書くと Harness の作成が
    // 非同期に失敗する。3 つとも inferenceTypesSupported は INFERENCE_PROFILE だけ
    for (const id of Object.values(MODELS)) {
      expect(id).toMatch(/^(jp|apac|global)\./);
    }
  });

  it('既定は Claude Sonnet 5', () => {
    // 通しで動かして確かめてあるのはこれだけ。ツール呼び出しの
    // イベント形状は Claude を実測して streamParser を作っている
    expect(MODELS.sonnet5).toBe('global.anthropic.claude-sonnet-5');
  });
});
