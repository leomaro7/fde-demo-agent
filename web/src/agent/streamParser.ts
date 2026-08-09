import type { Frame } from './eventstream.js';

export type StreamEvent =
  | { kind: 'text'; text: string }
  | { kind: 'toolUse'; toolUseId: string; name: string; type: string; contentBlockIndex: number }
  | { kind: 'toolUseInput'; contentBlockIndex: number; input: string }
  | { kind: 'toolResult'; toolUseId: string; status: string }
  | { kind: 'contentBlockStop'; contentBlockIndex: number }
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
      // text と toolUse.input は同じ contentBlockDelta に混在する（実測）。中身で振り分ける。
      const text = body?.delta?.text;
      if (typeof text === 'string') {
        return { kind: 'text', text };
      }
      const input = body?.delta?.toolUse?.input;
      if (typeof input === 'string') {
        // 空文字列の断片（1 個目）も含めて返す。連結側で捨てるかどうかを決めさせる
        return { kind: 'toolUseInput', contentBlockIndex: body?.contentBlockIndex, input };
      }
      return null;
    }
    case 'contentBlockStart': {
      const start = body?.start;
      if (start?.toolUse) {
        return {
          kind: 'toolUse',
          toolUseId: start.toolUse.toolUseId,
          name: start.toolUse.name,
          type: start.toolUse.type,
          contentBlockIndex: body?.contentBlockIndex,
        };
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
    case 'contentBlockStop':
      return { kind: 'contentBlockStop', contentBlockIndex: body?.contentBlockIndex };
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
