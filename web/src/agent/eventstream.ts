export interface Frame {
  readonly headers: Record<string, string>;
  readonly payload: Uint8Array;
}

/**
 * application/vnd.amazon.eventstream のデコーダ。
 *
 * フレーム構造（実測。aws-facts.md 参照）:
 *   [total length: 4][headers length: 4][prelude CRC: 4][headers][payload][message CRC: 4]
 *   ヘッダ: [name length: 1][name][value type: 1][value]  ※ type 7 = string（長さ 2 バイト）
 *
 * CRC は検証しない。デモ基盤であり、壊れたフレームは JSON パースの時点で落ちる。
 *
 * チャンクはフレーム境界をまたいで届く。状態を持ち、揃ったフレームだけ返す。
 */
export function createFrameDecoder(): { push(chunk: Uint8Array): Frame[] } {
  let buffer = new Uint8Array(0);

  return {
    push(chunk: Uint8Array): Frame[] {
      const merged = new Uint8Array(buffer.length + chunk.length);
      merged.set(buffer, 0);
      merged.set(chunk, buffer.length);
      buffer = merged;

      const frames: Frame[] = [];
      while (buffer.length >= 12) {
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        const total = view.getUint32(0);
        if (buffer.length < total) break;

        const headersLen = view.getUint32(4);
        const headersStart = 12;
        const payloadStart = headersStart + headersLen;
        const payloadEnd = total - 4;

        frames.push({
          headers: parseHeaders(buffer.subarray(headersStart, payloadStart)),
          payload: buffer.slice(payloadStart, payloadEnd),
        });
        buffer = buffer.slice(total);
      }
      return frames;
    },
  };
}

function parseHeaders(bytes: Uint8Array): Record<string, string> {
  const decoder = new TextDecoder();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headers: Record<string, string> = {};
  let o = 0;

  while (o < bytes.length) {
    const nameLen = bytes[o];
    o += 1;
    const name = decoder.decode(bytes.subarray(o, o + nameLen));
    o += nameLen;
    const type = bytes[o];
    o += 1;
    if (type !== 7) {
      // string 以外は使っていない。読み飛ばせないので打ち切る
      break;
    }
    const valueLen = view.getUint16(o);
    o += 2;
    headers[name] = decoder.decode(bytes.subarray(o, o + valueLen));
    o += valueLen;
  }
  return headers;
}
