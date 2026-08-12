import { createFrameDecoder } from './eventstream.js';
import { parseFrame, type StreamEvent } from './streamParser.js';

export type HarnessContentBlock =
  | { text: string }
  | { toolUse: { toolUseId: string; name: string; input: unknown } }
  | { toolResult: { toolUseId: string; content: { text: string }[]; status: 'success' | 'error' } };

export interface HarnessMessage {
  role: 'user' | 'assistant';
  content: HarnessContentBlock[];
}

export interface InvokeHarnessOptions {
  readonly harnessArn: string;
  /** アクセストークン。ID トークンは client_id クレームが無く 500 になる。 */
  readonly accessToken: string;
  readonly runtimeSessionId: string;
  readonly messages: HarnessMessage[];
  readonly region?: string;
  readonly fetchImpl?: typeof fetch;
}

/** InvokeHarness が返したエラー。認可拒否も 500 で来るので denied で区別する。 */
export class HarnessError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly denied: boolean,
  ) {
    super(message);
    this.name = 'HarnessError';
  }
}

/** runtimeSessionId は英数字のみ 33〜100 文字（実測）。 */
export function newSessionId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(40);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

export async function* invokeHarness(o: InvokeHarnessOptions): AsyncGenerator<StreamEvent> {
  const region = o.region ?? 'ap-northeast-1';
  const doFetch = o.fetchImpl ?? globalThis.fetch;

  // ARN はパスではなくクエリパラメータ（実測）
  const url =
    `https://bedrock-agentcore.${region}.amazonaws.com/harnesses/invoke` +
    `?harnessArn=${encodeURIComponent(o.harnessArn)}`;

  const res = await doFetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${o.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ runtimeSessionId: o.runtimeSessionId, messages: o.messages }),
  });

  if (!res.ok || !res.body) {
    const text = await res.text();
    // 認可拒否は 403 ではなく 500 で返る。ステータスでは区別できないので本文を見る
    const denied = text.includes('Authorization denied');
    throw new HarnessError(text || res.statusText, res.status, denied);
  }

  const decoder = createFrameDecoder();
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const frame of decoder.push(value)) {
      const event = parseFrame(frame);
      if (event) yield event;
    }
  }
}
