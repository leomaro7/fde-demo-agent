import { describe, it, expect } from 'vitest';
import { parseFrame } from './streamParser.js';

function frame(eventType: string, body: unknown) {
  return {
    headers: { ':event-type': eventType },
    payload: new TextEncoder().encode(JSON.stringify(body)),
  };
}

describe('parseFrame', () => {
  it('本文の差分を text として返す', () => {
    const e = parseFrame(frame('contentBlockDelta', { delta: { text: 'こんにちは' } }));
    expect(e).toEqual({ kind: 'text', text: 'こんにちは' });
  });

  it('toolUse の開始を返す', () => {
    const e = parseFrame(
      frame('contentBlockStart', {
        contentBlockIndex: 0,
        start: { toolUse: { toolUseId: 'tu-1', name: 'search', type: 'tool_use' } },
      }),
    );
    expect(e).toEqual({
      kind: 'toolUse',
      toolUseId: 'tu-1',
      name: 'search',
      type: 'tool_use',
      contentBlockIndex: 0,
    });
  });

  it('実測ペイロード: contentBlockStart の toolUse から type と contentBlockIndex を取れる', () => {
    // 実測ヘッダは :event-type / :content-type / :message-type の 3 つだが、
    // parseFrame は :event-type しか見ないため、テストでは省略している
    const e = parseFrame(
      frame('contentBlockStart', {
        contentBlockIndex: 0,
        start: {
          toolUse: {
            name: 'search',
            toolUseId: 'tooluse_uhosq6zEZBv2HPysAs44MK',
            type: 'tool_use',
          },
        },
      }),
    );
    expect(e).toEqual({
      kind: 'toolUse',
      toolUseId: 'tooluse_uhosq6zEZBv2HPysAs44MK',
      name: 'search',
      type: 'tool_use',
      contentBlockIndex: 0,
    });
  });

  it('実測ペイロード: toolUse.input の断片を空文字列も含めて取り出せる', () => {
    const fragments = ['', '{"keywor', 'd": "出張 精算"}'];
    const events = fragments.map((input) =>
      parseFrame(frame('contentBlockDelta', { contentBlockIndex: 0, delta: { toolUse: { input } } })),
    );
    expect(events).toEqual([
      { kind: 'toolUseInput', contentBlockIndex: 0, input: '' },
      { kind: 'toolUseInput', contentBlockIndex: 0, input: '{"keywor' },
      { kind: 'toolUseInput', contentBlockIndex: 0, input: 'd": "出張 精算"}' },
    ]);
  });

  it('delta.text と delta.toolUse.input が同じ contentBlockDelta でも正しく振り分けられる', () => {
    const textEvent = parseFrame(
      frame('contentBlockDelta', { contentBlockIndex: 0, delta: { text: 'こんにちは' } }),
    );
    const inputEvent = parseFrame(
      frame('contentBlockDelta', { contentBlockIndex: 1, delta: { toolUse: { input: '{"a":1}' } } }),
    );
    expect(textEvent).toEqual({ kind: 'text', text: 'こんにちは' });
    expect(inputEvent).toEqual({ kind: 'toolUseInput', contentBlockIndex: 1, input: '{"a":1}' });
  });

  it('実測ペイロード: contentBlockStop で contentBlockIndex を拾える', () => {
    const e = parseFrame(frame('contentBlockStop', { contentBlockIndex: 0 }));
    expect(e).toEqual({ kind: 'contentBlockStop', contentBlockIndex: 0 });
  });

  it('toolResult を返す', () => {
    const e = parseFrame(
      frame('contentBlockStart', { start: { toolResult: { toolUseId: 'tu-1', status: 'success' } } }),
    );
    expect(e).toEqual({ kind: 'toolResult', toolUseId: 'tu-1', status: 'success' });
  });

  it('stopReason を返す', () => {
    expect(parseFrame(frame('messageStop', { stopReason: 'tool_use' })))
      .toEqual({ kind: 'stop', reason: 'tool_use' });
  });

  it('例外ヘッダを error として返す', () => {
    const e = parseFrame({
      headers: { ':exception-type': 'internalServerException' },
      payload: new TextEncoder().encode(JSON.stringify({ message: '落ちた' })),
    });
    expect(e).toEqual({ kind: 'error', message: '落ちた' });
  });

  it('知らないイベントは null を返す', () => {
    expect(parseFrame(frame('messageStart', {}))).toBeNull();
  });
});
