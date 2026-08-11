/**
 * テスト専用。application/vnd.amazon.eventstream のフレームを 1 つ組み立てる。
 * CRC は復号側で検証していないので 0 で埋める。
 */
export function buildFrame(eventType: string, payload: string): Uint8Array {
  const enc = new TextEncoder();
  const nameBytes = enc.encode(':event-type');
  const valueBytes = enc.encode(eventType);
  const headersLen = 1 + nameBytes.length + 1 + 2 + valueBytes.length;
  const payloadBytes = enc.encode(payload);
  const total = 4 + 4 + 4 + headersLen + payloadBytes.length + 4;

  const buf = new Uint8Array(total);
  const view = new DataView(buf.buffer);
  let o = 0;
  view.setUint32(o, total); o += 4;
  view.setUint32(o, headersLen); o += 4;
  view.setUint32(o, 0); o += 4;
  buf[o] = nameBytes.length; o += 1;
  buf.set(nameBytes, o); o += nameBytes.length;
  buf[o] = 7; o += 1;
  view.setUint16(o, valueBytes.length); o += 2;
  buf.set(valueBytes, o); o += valueBytes.length;
  buf.set(payloadBytes, o); o += payloadBytes.length;
  view.setUint32(o, 0);
  return buf;
}

/** 複数フレームを 1 つの ReadableStream にして返す（fetch の body の代わり）。 */
export function frameStream(frames: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const f of frames) controller.enqueue(f);
      controller.close();
    },
  });
}
