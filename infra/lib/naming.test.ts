import { describe, it, expect } from 'vitest';
import { toHarnessName } from './naming.js';

describe('toHarnessName', () => {
  it('instance と slug を _ で繋ぐ', () => {
    expect(toHarnessName('dev', 'sales')).toBe('dev_sales');
  });

  it('ハイフンをアンダースコアに置き換える', () => {
    expect(toHarnessName('dev-1', 'sales-north')).toBe('dev_1_sales_north');
  });

  it('40 文字を超えたら投げる（切り詰めない）', () => {
    expect(() => toHarnessName('a'.repeat(20), 'b'.repeat(20)))
      .toThrow(/40 文字/);
  });

  it('先頭が数字なら投げる', () => {
    expect(() => toHarnessName('1dev', 'sales')).toThrow(/使えない文字/);
  });

  it('英数字とアンダースコア以外が残るなら投げる', () => {
    expect(() => toHarnessName('dev', 'sales.north')).toThrow(/使えない文字/);
  });
});
