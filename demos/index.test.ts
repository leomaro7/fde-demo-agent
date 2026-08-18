import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
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
  // 案件名を書かない。企業リポジトリでは見本を消すので（RUNBOOK 4.4）、
  // 書くと消した瞬間に落ちる。実際に落ちた（2026-08-14）
  it('登録されている案件は slug で引ける', () => {
    for (const slug of Object.keys(demos)) {
      expect(pickDemo(slug).demo.slug).toBe(slug);
    }
  });

  it('知らない slug なら、選べるものを挙げて投げる', () => {
    // 黙って別の案件を出すのが最悪。クライアントに他社のデモを見せることになる
    expect(() => pickDemo('nosuch')).toThrow(/nosuch/);
    for (const slug of Object.keys(demos)) {
      expect(() => pickDemo('nosuch')).toThrow(new RegExp(slug));
    }
  });
});

describe('配信物に他案件が混ざらない仕組み', () => {
  it('画面は登録表を import していない（全案件がバンドルに入るため）', () => {
    // 登録表を直接 import すると Vite が全案件を巻き込み、クライアントの
    // ブラウザに他社のデモデータが配られる。実際にそうなっていた。
    // 要件書 4.1「他案件の画面に入れない」に反する
    const app = readFileSync(new URL('../web/src/ui/App.tsx', import.meta.url), 'utf-8');
    expect(app).not.toContain('demos/index.js');
    expect(app).toContain("from '#demo'");
    expect(app).toContain("from '#demo-tools'");
  });

  it('vite が slug から案件を別名解決している', () => {
    const cfg = readFileSync(new URL('../web/vite.config.ts', import.meta.url), 'utf-8');
    expect(cfg).toContain('VITE_DEMO_SLUG');
    expect(cfg).toContain("'#demo'");
  });
});
