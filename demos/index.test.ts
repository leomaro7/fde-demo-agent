import { describe, it, expect } from 'vitest';
import { demos, pickDemo } from './index.js';

describe('demos', () => {
  it('登録表の鍵と、案件が名乗る slug が一致している', () => {
    // ここがずれると、指定した案件と違うものが配信される
    for (const [key, entry] of Object.entries(demos)) {
      expect(entry.demo.slug).toBe(key);
    }
  });

  it('案件が宣言したツールは、すべて登録表に実装がある', () => {
    // demo.ts の宣言と tools.ts の登録表が食い違うと、Harness が結果を待ったまま止まる
    for (const entry of Object.values(demos)) {
      const declared = entry.demo.harness.tools
        .filter((t) => t.type === 'inline_function')
        .map((t) => t.name);
      for (const name of declared) {
        expect(Object.keys(entry.tools)).toContain(name);
      }
    }
  });

  it('例示は 3 問ある', () => {
    for (const entry of Object.values(demos)) {
      expect(entry.demo.examples).toHaveLength(3);
    }
  });
});

describe('pickDemo', () => {
  it('slug で案件を引ける', () => {
    expect(pickDemo('smoke').demo.slug).toBe('smoke');
    expect(pickDemo('sales').demo.slug).toBe('sales');
    expect(pickDemo('hr').demo.slug).toBe('hr');
  });

  it('知らない slug なら、選べるものを挙げて投げる', () => {
    // 黙って別の案件を出すのが最悪。クライアントに他社のデモを見せることになる
    expect(() => pickDemo('nosuch')).toThrow(/nosuch/);
    expect(() => pickDemo('nosuch')).toThrow(/smoke/);
  });
});
