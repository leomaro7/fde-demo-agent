import type { Frame } from './eventstream.js';

export type StreamEvent =
  | { kind: 'text'; text: string }
  | { kind: 'toolUse'; toolUseId: string; name: string }
  | { kind: 'toolResult'; toolUseId: string; status: string }
  | { kind: 'stop'; reason: string }
  | { kind: 'error'; message: string };

/**
 * フレームを 1 つ、画面が扱える形に変換する。
 *
 * イベント名は Bedrock Converse と同じ（実測。aws-facts.md 参照）。
 * 知らないイベントは null を返して捨てる。増えても壊れないようにするため。
 */
export function parseFrame(frame: Frame): StreamEvent | null {
  const exceptionType = frame.headers[':exception-type'];
  const body = decodeJson(frame.payload);

  if (exceptionType) {
    return { kind: 'error', message: String(body?.message ?? exceptionType) };
  }

  switch (frame.headers[':event-type']) {
    case 'contentBlockDelta': {
      const text = body?.delta?.text;
      return typeof text === 'string' ? { kind: 'text', text } : null;
    }
    case 'contentBlockStart': {
      const start = body?.start;
      if (start?.toolUse) {
        return { kind: 'toolUse', toolUseId: start.toolUse.toolUseId, name: start.toolUse.name };
      }
      if (start?.toolResult) {
        return {
          kind: 'toolResult',
          toolUseId: start.toolResult.toolUseId,
          status: start.toolResult.status ?? 'success',
        };
      }
      return null;
    }
    case 'messageStop':
      return { kind: 'stop', reason: String(body?.stopReason ?? 'end_turn') };
    default:
      return null;
  }
}

/** payload の形はイベント種別ごとに違う。呼び出し側の switch で絞る。 */
function decodeJson(payload: Uint8Array): any {
  try {
    return JSON.parse(new TextDecoder().decode(payload));
  } catch {
    return undefined;
  }
}
