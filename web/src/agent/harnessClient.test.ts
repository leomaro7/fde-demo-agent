import { describe, it, expect } from 'vitest';
import { invokeHarness, newSessionId, HarnessError } from './harnessClient.js';
import { buildFrame, frameStream } from './__fixtures__/frame.js';

function okFetch(frames: Uint8Array[], capture?: (req: { url: string; init: RequestInit }) => void) {
  return (async (url: string, init: RequestInit) => {
    capture?.({ url, init });
    return new Response(frameStream(frames), {
      status: 200,
      headers: { 'content-type': 'application/vnd.amazon.eventstream' },
    });
  }) as unknown as typeof fetch;
}

const baseOptions = {
  harnessArn: 'arn:aws:bedrock-agentcore:ap-northeast-1:123456789012:harness/x_y-abc',
  accessToken: 'token-abc',
  runtimeSessionId: newSessionId(),
  messages: [{ role: 'user' as const, content: [{ text: 'こんにちは' }] }],
};

async function collect(gen: AsyncGenerator<unknown>) {
  const out = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe('newSessionId', () => {
  it('英数字のみ 33〜100 文字（AgentCore の制約）', () => {
    const id = newSessionId();
    expect(id).toMatch(/^[A-Za-z0-9]+$/);
    expect(id.length).toBeGreaterThanOrEqual(33);
    expect(id.length).toBeLessThanOrEqual(100);
  });

  it('呼ぶたびに違う値を返す', () => {
    expect(newSessionId()).not.toBe(newSessionId());
  });
});

describe('invokeHarness', () => {
  it('ARN をクエリパラメータに載せ、アクセストークンを Bearer で送る', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    await collect(
      invokeHarness({
        ...baseOptions,
        fetchImpl: okFetch([buildFrame('messageStop', '{"stopReason":"end_turn"}')], (r) => (seen = r)),
      }),
    );
    expect(seen!.url).toContain('/harnesses/invoke?harnessArn=');
    expect(seen!.url).toContain(encodeURIComponent(baseOptions.harnessArn));
    expect((seen!.init.headers as Record<string, string>).Authorization).toBe('Bearer token-abc');
  });

  it('本文にセッション ID とメッセージを載せる', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    await collect(
      invokeHarness({
        ...baseOptions,
        fetchImpl: okFetch([buildFrame('messageStop', '{"stopReason":"end_turn"}')], (r) => (seen = r)),
      }),
    );
    const body = JSON.parse(seen!.init.body as string);
    expect(body.runtimeSessionId).toBe(baseOptions.runtimeSessionId);
    expect(body.messages).toEqual([{ role: 'user', content: [{ text: 'こんにちは' }] }]);
  });

  it('フレームを解釈済みのイベントとして順に返す', async () => {
    const frames = [
      buildFrame('contentBlockDelta', '{"contentBlockIndex":0,"delta":{"text":"はい"}}'),
      buildFrame('messageStop', '{"stopReason":"end_turn"}'),
    ];
    const events = await collect(invokeHarness({ ...baseOptions, fetchImpl: okFetch(frames) }));
    expect(events).toEqual([
      { kind: 'text', text: 'はい' },
      { kind: 'stop', reason: 'end_turn' },
    ]);
  });

  it('認可拒否は 500 で返るので、本文を見て denied と判定する', async () => {
    const deniedFetch = (async () =>
      new Response(JSON.stringify({ message: 'Authorization denied' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;

    const err = await invokeHarness({ ...baseOptions, fetchImpl: deniedFetch })
      .next()
      .then(() => undefined)
      .catch((e) => e as HarnessError);

    expect(err).toBeInstanceOf(HarnessError);
    expect(err!.status).toBe(500);
    expect(err!.denied).toBe(true);
  });

  it('本物のサーバーエラーは denied にしない', async () => {
    const brokenFetch = (async () =>
      new Response(JSON.stringify({ message: 'Internal failure' }), { status: 500 })) as unknown as typeof fetch;

    const err = await invokeHarness({ ...baseOptions, fetchImpl: brokenFetch })
      .next()
      .then(() => undefined)
      .catch((e) => e as HarnessError);

    expect(err!.denied).toBe(false);
  });
});
