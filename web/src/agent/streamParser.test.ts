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
      frame('contentBlockStart', { start: { toolUse: { toolUseId: 'tu-1', name: 'search' } } }),
    );
    expect(e).toEqual({ kind: 'toolUse', toolUseId: 'tu-1', name: 'search' });
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
