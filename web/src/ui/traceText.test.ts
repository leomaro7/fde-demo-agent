import { describe, it, expect } from 'vitest';
import { extractCode, toTraceLines } from './traceText.js';
import type { StreamEvent } from '../agent/streamParser.js';

describe('extractCode', () => {
  it('code キーがあればコード本体だけを返す', () => {
    const input = { code: 'print(sum(x))', data: [{ a: 1 }, { a: 2 }] };
    expect(extractCode(input)).toBe('print(sum(x))');
  });

  it('データ全体を混ぜない（画面が JSON で埋まるのを防ぐ）', () => {
    const input = { code: 'print(1)', data: Array.from({ length: 500 }, (_, i) => ({ i })) };
    expect(extractCode(input)).not.toContain('499');
  });

  it('長すぎるコードは切り詰めて、切ったことが分かるようにする', () => {
    const code = 'x'.repeat(1000);
    const out = extractCode({ code }, 100);
    expect(out.length).toBeLessThanOrEqual(120);
    expect(out).toContain('…');
  });

  it('code キーが無ければ入力を短く要約する', () => {
    expect(extractCode({ keyword: '出張' })).toContain('出張');
  });
});

describe('toTraceLines', () => {
  it('ツール呼び出しを 1 行にする', () => {
    const events: StreamEvent[] = [
      { kind: 'toolUse', toolUseId: 't1', name: 'search', type: 'tool_use', contentBlockIndex: 0 },
      { kind: 'toolUseInput', contentBlockIndex: 0, input: '{"keyword":"出張"}' },
      { kind: 'contentBlockStop', contentBlockIndex: 0 },
    ];
    const lines = toTraceLines(events);
    expect(lines).toHaveLength(1);
    expect(lines[0].label).toContain('search');
    expect(lines[0].detail).toContain('出張');
  });

  it('誰が実行したかが分かる（ブラウザ側か Harness 側か）', () => {
    const events: StreamEvent[] = [
      { kind: 'toolUse', toolUseId: 't1', name: 'code', type: 'server_tool_use', contentBlockIndex: 0 },
      { kind: 'toolUseInput', contentBlockIndex: 0, input: '{"code":"print(1)"}' },
      { kind: 'contentBlockStop', contentBlockIndex: 0 },
    ];
    expect(toTraceLines(events)[0].label).toContain('Harness');
  });

  it('本文の差分はトレースに出さない', () => {
    expect(toTraceLines([{ kind: 'text', text: 'こんにちは' }])).toHaveLength(0);
  });

  it('ツール結果の成否を出す', () => {
    const events: StreamEvent[] = [
      { kind: 'toolResult', toolUseId: 't1', status: 'error' },
    ];
    expect(toTraceLines(events)[0].detail).toContain('error');
  });
});
