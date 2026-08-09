import { describe, it, expect } from 'vitest';
import { createFrameDecoder } from './eventstream.js';

/** テスト用に 1 フレームを組み立てる。CRC は検証しないので 0 で埋める。 */
function buildFrame(eventType: string, payload: string): Uint8Array {
  const enc = new TextEncoder();
  const name = ':event-type';
  const nameBytes = enc.encode(name);
  const valueBytes = enc.encode(eventType);
  // [name len:1][name][type:1][value len:2][value]
  const headersLen = 1 + nameBytes.length + 1 + 2 + valueBytes.length;
  const payloadBytes = enc.encode(payload);
  const total = 4 + 4 + 4 + headersLen + payloadBytes.length + 4;

  const buf = new Uint8Array(total);
  const view = new DataView(buf.buffer);
  let o = 0;
  view.setUint32(o, total); o += 4;
  view.setUint32(o, headersLen); o += 4;
  view.setUint32(o, 0); o += 4;           // prelude CRC（検証しない）
  buf[o] = nameBytes.length; o += 1;
  buf.set(nameBytes, o); o += nameBytes.length;
  buf[o] = 7; o += 1;                      // type 7 = string
  view.setUint16(o, valueBytes.length); o += 2;
  buf.set(valueBytes, o); o += valueBytes.length;
  buf.set(payloadBytes, o); o += payloadBytes.length;
  view.setUint32(o, 0);                    // message CRC（検証しない）
  return buf;
}

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
