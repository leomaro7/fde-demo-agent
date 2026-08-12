import { describe, it, expect } from 'vitest';
import { createFrameDecoder } from './eventstream.js';
import { buildFrame } from './__fixtures__/frame.js';

describe('createFrameDecoder', () => {
  it('1 フレームを復号する', () => {
    const frame = buildFrame('contentBlockDelta', '{"delta":{"text":"こんにちは"}}');
    const frames = createFrameDecoder().push(frame);
    expect(frames).toHaveLength(1);
    expect(frames[0].headers[':event-type']).toBe('contentBlockDelta');
    expect(new TextDecoder().decode(frames[0].payload)).toContain('こんにちは');
  });

  it('フレーム境界をまたぐ分割入力を復号する', () => {
    // 前身ではここが実際に起きた。7 バイトずつに割って通す
    const frame = buildFrame('contentBlockDelta', '{"delta":{"text":"分割"}}');
    const decoder = createFrameDecoder();
    const collected = [];
    for (let i = 0; i < frame.length; i += 7) {
      collected.push(...decoder.push(frame.slice(i, i + 7)));
    }
    expect(collected).toHaveLength(1);
    expect(new TextDecoder().decode(collected[0].payload)).toContain('分割');
  });

  it('1 チャンクに 2 フレームが入っていても両方返す', () => {
    const a = buildFrame('messageStart', '{}');
    const b = buildFrame('messageStop', '{"stopReason":"end_turn"}');
    const merged = new Uint8Array(a.length + b.length);
    merged.set(a, 0);
    merged.set(b, a.length);
    expect(createFrameDecoder().push(merged)).toHaveLength(2);
  });

  it('フレームが揃うまでは何も返さない', () => {
    const frame = buildFrame('messageStart', '{}');
    expect(createFrameDecoder().push(frame.slice(0, 5))).toHaveLength(0);
  });
});
