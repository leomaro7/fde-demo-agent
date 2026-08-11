# フロントと手順書 実装計画

> **エージェント作業者へ:** 必須サブスキル — この計画は
> `superpowers:subagent-driven-development`（推奨）または `superpowers:executing-plans` で
> タスク単位に実行すること。ステップはチェックボックス（`- [ ]`）で追跡する。

**ゴール:** クライアントがブラウザで URL を開き、Cognito でログインし、エージェントと会話し、
**何を調べたかが右側のトレースに見える**ところまで作る。加えて、その全部を人が再現できる手順書を残す。

**アーキテクチャ:** Vite + React の SPA。Cognito Hosted UI の認可コードフロー（PKCE）で
アクセストークンを取り、ブラウザから `InvokeHarness` を直接叩く。ツールは
return-of-control でブラウザ側が実行する。Amplify へは ZIP を手動デプロイする
（リポジトリ未接続。GitHub のトークンを持ち込まないため）。

**技術スタック:** TypeScript / React / Vite / vitest / aws-cdk-lib（既存）

**設計書:** [../specs/2026-08-08-what-to-build-design.md](../specs/2026-08-08-what-to-build-design.md)
（この計画は設計書 7 章の手順 4〜7 にあたる）

## 前提（すでにできていること）

- 土台スタックと案件スタックは **AWS にデプロイ済み**。`instance=fdedemo0809` / `slug=smoke`
- `web/src/agent/eventstream.ts` — `createFrameDecoder()`
- `web/src/agent/streamParser.ts` — `parseFrame()` と `StreamEvent`
- `demos/smoke/` — `demo.ts`（`DemoConfig`）/ `seed/items.json` / `tools.ts`（`search`）
- テストは vitest（`npx vitest run`）、型検査は `npx tsc --noEmit`。現在 42 件が緑

## Global Constraints

これは全タスクの要件に含まれる。**例外なく守る。すべて実測で確定した事実。**

- **Bearer に載せるのはアクセストークン。** ID トークンは `client_id` クレームが無く 500 になる
- **`toolResult.content` は `text` のみ。** `json` は `unsupported type` で拒否される。必ず文字列化する
- **`runtimeSessionId` は英数字のみ 33〜100 文字**
- **ツールの引数は `contentBlockStart` に入らない。** `contentBlockDelta.delta.toolUse.input` に
  JSON 文字列の断片として流れる。`contentBlockIndex` ごとに連結し、`contentBlockStop` で完成
- **認可に落ちると HTTP 403 ではなく 500** が返る（本文 `{"message":"Authorization denied"}`）。
  ステータスコードだけで判断しない
- **`InvokeHarness` の URL は `POST /harnesses/invoke?harnessArn={arn}`。** ARN はクエリ
- **リージョンは `ap-northeast-1`**
- **一時ファイルを使わない**
- **秘密情報をリポジトリに置かない。** トークン・パスワード・`.env` はコミットしない
- **コミットは Conventional Commits。** 本文には何をしたかより**なぜそうしたか**を書く。
  `Co-Authored-By` トレーラーは付けない
- コメントとコミットメッセージは**日本語**
- eslint は入れていない。lint 用のコメントを足さない
- import は拡張子 `.js` を付ける形で統一（例: `./eventstream.js`）

---

## ファイル構成

| ファイル | 責務 |
|---|---|
| `web/src/agent/__fixtures__/frame.ts` | テスト用のフレーム組み立て。**テスト専用** |
| `web/src/agent/harnessClient.ts` | `fetch` + Bearer + 復号 → `StreamEvent` の非同期列 |
| `web/src/agent/toolLoop.ts` | `stopReason: tool_use` → ツール実行 → `toolResult` で再呼び出し |
| `web/src/auth/pkce.ts` | PKCE の verifier / challenge。**純粋関数** |
| `web/src/auth/cognito.ts` | 認可 URL の組み立てとコード交換 |
| `web/src/config.ts` | ビルド時に渡す設定の読み取りと検証 |
| `web/src/ui/App.tsx` | 画面全体。左に会話、右にトレース |
| `web/src/ui/Conversation.tsx` | 会話の表示と入力 |
| `web/src/ui/TraceView.tsx` | 実行トレースの表示 |
| `web/src/ui/traceText.ts` | トレース 1 行分の文言を作る。**純粋関数** |
| `scripts/stack-outputs.ts` | CFn の出力を `.env` 形式で出す |
| `scripts/deploy-web.ts` | ビルド → ZIP → Amplify へ手動デプロイ |
| `RUNBOOK.md` | 構築から撤去までの手順書 |

---

## Task 1: Harness クライアント

**Files:**
- Create: `web/src/agent/__fixtures__/frame.ts`
- Create: `web/src/agent/harnessClient.ts`
- Test: `web/src/agent/harnessClient.test.ts`
- Modify: `web/src/agent/eventstream.test.ts`（自前の `buildFrame` を fixture の import に置き換える）

**Interfaces:**
- Consumes: `createFrameDecoder()` / `parseFrame()` / `StreamEvent`
- Produces:
```ts
export type HarnessContentBlock =
  | { text: string }
  | { toolUse: { toolUseId: string; name: string; input: unknown } }
  | { toolResult: { toolUseId: string; content: { text: string }[]; status: 'success' | 'error' } };

export interface HarnessMessage {
  role: 'user' | 'assistant';
  content: HarnessContentBlock[];
}

export interface InvokeHarnessOptions {
  harnessArn: string;
  accessToken: string;
  runtimeSessionId: string;
  messages: HarnessMessage[];
  region?: string;                 // 既定 'ap-northeast-1'
  fetchImpl?: typeof fetch;        // テストで差し替える
}

export function newSessionId(): string;
export async function* invokeHarness(o: InvokeHarnessOptions): AsyncGenerator<StreamEvent>;
export class HarnessError extends Error { readonly status: number; readonly denied: boolean; }
```

- [ ] **Step 1: テスト用のフレーム組み立てを切り出す**

`web/src/agent/__fixtures__/frame.ts`:

```ts
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
```

- [ ] **Step 2: 既存テストを fixture に寄せる**

`web/src/agent/eventstream.test.ts` の先頭にある自前の `buildFrame` 関数を削除し、
import に置き換える。**テストの中身（アサーション）は変えないこと。**

```ts
import { buildFrame } from './__fixtures__/frame.js';
```

Run: `npx vitest run web/src/agent/eventstream.test.ts`
Expected: PASS（件数は変わらない）

- [ ] **Step 3: 失敗するテストを書く**

`web/src/agent/harnessClient.test.ts`:

```ts
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
```

- [ ] **Step 4: テストを流して失敗を確認する**

Run: `npx vitest run web/src/agent/harnessClient.test.ts`
Expected: FAIL。`./harnessClient.js` が解決できない

- [ ] **Step 5: クライアントを書く**

`web/src/agent/harnessClient.ts`:

```ts
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
```

- [ ] **Step 6: テストを流して通ることを確認する**

Run: `npx vitest run`
Expected: PASS。全体が緑（既存 42 件 + 新規 7 件）

- [ ] **Step 7: 型検査**

Run: `npx tsc --noEmit`
Expected: 出力なし

- [ ] **Step 8: コミット**

```bash
git add web/src/agent
git commit -m "$(cat <<'EOF'
feat: Harness クライアントを追加

認可拒否が HTTP 403 ではなく 500 で返るため、ステータスコードでは
本物のサーバーエラーと区別できない。本文に Authorization denied が
含まれるかで判定し、HarnessError.denied として呼び出し側に渡す。
商談中に「落ちた」のか「権限が無い」のかを画面で出し分けるために要る。

fetch を差し替え可能にした。AWS を叩かずにストリームの解釈まで
テストできる。テスト用のフレーム組み立ては fixture に切り出し、
eventstream のテストと共有した。
EOF
)"
```

---

## Task 2: ツールループ

**Files:**
- Create: `web/src/agent/toolLoop.ts`
- Test: `web/src/agent/toolLoop.test.ts`

**Interfaces:**
- Consumes: `HarnessMessage` / `HarnessContentBlock`（Task 1）、`StreamEvent`
- Produces:
```ts
export type ToolFn = (input: unknown) => string | Promise<string>;
export type ToolRegistry = Record<string, ToolFn>;

export interface RunTurnOptions {
  /** メッセージ列を渡すとイベントを流す関数。harnessClient を包んで渡す。 */
  readonly invoke: (messages: HarnessMessage[]) => AsyncGenerator<StreamEvent>;
  readonly tools: ToolRegistry;
  readonly messages: HarnessMessage[];
  readonly onEvent?: (e: StreamEvent) => void;
  /** ツール往復の上限。既定 5。 */
  readonly maxRounds?: number;
}

/** 1 ターン回し、更新後のメッセージ列を返す。 */
export async function runTurn(o: RunTurnOptions): Promise<HarnessMessage[]>;
```

**このタスクの肝** — ツールの引数は `contentBlockStart` に入っておらず、
`contentBlockDelta.delta.toolUse.input` に **JSON 文字列の断片**として流れる（実測）。
`contentBlockIndex` ごとに連結し、`contentBlockStop` で完成とみなして `JSON.parse` する。

- [ ] **Step 1: 失敗するテストを書く**

`web/src/agent/toolLoop.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { runTurn } from './toolLoop.js';
import type { StreamEvent } from './streamParser.js';
import type { HarnessMessage } from './harnessClient.js';

/** 用意したイベント列を順に返す invoke を作る。呼ばれるたびに次の配列を流す。 */
function fakeInvoke(rounds: StreamEvent[][]) {
  const seen: HarnessMessage[][] = [];
  let i = 0;
  const invoke = async function* (messages: HarnessMessage[]) {
    seen.push(structuredClone(messages));
    for (const e of rounds[i] ?? []) yield e;
    i += 1;
  };
  return { invoke, seen };
}

const askSearch: StreamEvent[] = [
  { kind: 'toolUse', toolUseId: 'tu-1', name: 'search', type: 'tool_use', contentBlockIndex: 0 },
  { kind: 'toolUseInput', contentBlockIndex: 0, input: '{"keyw' },
  { kind: 'toolUseInput', contentBlockIndex: 0, input: 'ord": "出張"}' },
  { kind: 'contentBlockStop', contentBlockIndex: 0 },
  { kind: 'stop', reason: 'tool_use' },
];

const answer: StreamEvent[] = [
  { kind: 'text', text: '帰着後 5 営業日以内です。' },
  { kind: 'stop', reason: 'end_turn' },
];

describe('runTurn', () => {
  it('断片を連結してツールの引数を組み立て、ツールを呼ぶ', async () => {
    const search = vi.fn(() => '[A-001] 帰着後 5 営業日以内');
    const { invoke } = fakeInvoke([askSearch, answer]);
    await runTurn({
      invoke,
      tools: { search },
      messages: [{ role: 'user', content: [{ text: '出張の精算は' }] }],
    });
    expect(search).toHaveBeenCalledWith({ keyword: '出張' });
  });

  it('ツール結果を text で返す（json は拒否されるため）', async () => {
    const { invoke, seen } = fakeInvoke([askSearch, answer]);
    await runTurn({
      invoke,
      tools: { search: () => '[A-001] 帰着後 5 営業日以内' },
      messages: [{ role: 'user', content: [{ text: '出張の精算は' }] }],
    });
    const secondRequest = seen[1];
    expect(secondRequest.at(-1)).toEqual({
      role: 'user',
      content: [
        {
          toolResult: {
            toolUseId: 'tu-1',
            content: [{ text: '[A-001] 帰着後 5 営業日以内' }],
            status: 'success',
          },
        },
      ],
    });
  });

  it('assistant の toolUse を履歴に残してから結果を返す', async () => {
    const { invoke, seen } = fakeInvoke([askSearch, answer]);
    await runTurn({
      invoke,
      tools: { search: () => 'ok' },
      messages: [{ role: 'user', content: [{ text: '出張の精算は' }] }],
    });
    expect(seen[1][1]).toEqual({
      role: 'assistant',
      content: [{ toolUse: { toolUseId: 'tu-1', name: 'search', input: { keyword: '出張' } } }],
    });
  });

  it('最終的な本文を assistant メッセージとして返す', async () => {
    const { invoke } = fakeInvoke([askSearch, answer]);
    const messages = await runTurn({
      invoke,
      tools: { search: () => 'ok' },
      messages: [{ role: 'user', content: [{ text: '出張の精算は' }] }],
    });
    expect(messages.at(-1)).toEqual({
      role: 'assistant',
      content: [{ text: '帰着後 5 営業日以内です。' }],
    });
  });

  it('知らないツールを呼ばれたら error の toolResult を返して会話を続ける', async () => {
    const unknown: StreamEvent[] = [
      { kind: 'toolUse', toolUseId: 'tu-9', name: 'nosuch', type: 'tool_use', contentBlockIndex: 0 },
      { kind: 'toolUseInput', contentBlockIndex: 0, input: '{}' },
      { kind: 'contentBlockStop', contentBlockIndex: 0 },
      { kind: 'stop', reason: 'tool_use' },
    ];
    const { invoke, seen } = fakeInvoke([unknown, answer]);
    await runTurn({ invoke, tools: {}, messages: [{ role: 'user', content: [{ text: 'x' }] }] });
    const result = seen[1].at(-1)!.content[0] as { toolResult: { status: string; content: { text: string }[] } };
    expect(result.toolResult.status).toBe('error');
    expect(result.toolResult.content[0].text).toContain('nosuch');
  });

  it('ツールが投げても会話を止めず、error として返す', async () => {
    const { invoke, seen } = fakeInvoke([askSearch, answer]);
    await runTurn({
      invoke,
      tools: {
        search: () => {
          throw new Error('seed が壊れている');
        },
      },
      messages: [{ role: 'user', content: [{ text: 'x' }] }],
    });
    const result = seen[1].at(-1)!.content[0] as { toolResult: { status: string; content: { text: string }[] } };
    expect(result.toolResult.status).toBe('error');
    expect(result.toolResult.content[0].text).toContain('seed が壊れている');
  });

  it('ツール往復が上限を超えたら止める（無限ループを防ぐ）', async () => {
    const { invoke } = fakeInvoke([askSearch, askSearch, askSearch]);
    const messages = await runTurn({
      invoke,
      tools: { search: () => 'ok' },
      messages: [{ role: 'user', content: [{ text: 'x' }] }],
      maxRounds: 2,
    });
    const last = messages.at(-1)!;
    expect(JSON.stringify(last)).toContain('上限');
  });

  it('異常な stopReason は理由を本文に添える（無言で終わらせない）', async () => {
    const filtered: StreamEvent[] = [
      { kind: 'text', text: '途中まで' },
      { kind: 'stop', reason: 'content_filtered' },
    ];
    const { invoke } = fakeInvoke([filtered]);
    const messages = await runTurn({
      invoke,
      tools: {},
      messages: [{ role: 'user', content: [{ text: 'x' }] }],
    });
    const text = (messages.at(-1)!.content[0] as { text: string }).text;
    expect(text).toContain('途中まで');
    expect(text).toContain('フィルタ');
  });

  it('正常終了には余計な注記を足さない', async () => {
    const { invoke } = fakeInvoke([answer]);
    const messages = await runTurn({
      invoke,
      tools: {},
      messages: [{ role: 'user', content: [{ text: 'x' }] }],
    });
    expect(messages.at(-1)).toEqual({
      role: 'assistant',
      content: [{ text: '帰着後 5 営業日以内です。' }],
    });
  });

  it('イベントを onEvent にそのまま流す（画面のトレース用）', async () => {
    const seenEvents: StreamEvent[] = [];
    const { invoke } = fakeInvoke([askSearch, answer]);
    await runTurn({
      invoke,
      tools: { search: () => 'ok' },
      messages: [{ role: 'user', content: [{ text: 'x' }] }],
      onEvent: (e) => seenEvents.push(e),
    });
    expect(seenEvents).toContainEqual({ kind: 'text', text: '帰着後 5 営業日以内です。' });
    expect(seenEvents.some((e) => e.kind === 'toolUse')).toBe(true);
  });
});
```

- [ ] **Step 2: テストを流して失敗を確認する**

Run: `npx vitest run web/src/agent/toolLoop.test.ts`
Expected: FAIL。`./toolLoop.js` が解決できない

- [ ] **Step 3: ツールループを書く**

`web/src/agent/toolLoop.ts`:

```ts
import type { StreamEvent } from './streamParser.js';
import type { HarnessMessage, HarnessContentBlock } from './harnessClient.js';

export type ToolFn = (input: unknown) => string | Promise<string>;
export type ToolRegistry = Record<string, ToolFn>;

export interface RunTurnOptions {
  readonly invoke: (messages: HarnessMessage[]) => AsyncGenerator<StreamEvent>;
  readonly tools: ToolRegistry;
  readonly messages: HarnessMessage[];
  readonly onEvent?: (e: StreamEvent) => void;
  readonly maxRounds?: number;
}

interface PendingTool {
  toolUseId: string;
  name: string;
  /** contentBlockDelta で届く JSON の断片を溜める。 */
  raw: string;
}

/**
 * 1 ターン回して、更新後のメッセージ列を返す。
 *
 * inline_function は return-of-control なので、Harness は stopReason: tool_use で止まり、
 * 呼び出し側がツールを実行して toolResult を返す。
 *
 * ツールの引数は contentBlockStart には入っておらず、
 * contentBlockDelta.delta.toolUse.input に JSON 文字列の断片として流れる（実測）。
 * contentBlockIndex ごとに連結し、contentBlockStop で完成とみなす。
 */
export async function runTurn(o: RunTurnOptions): Promise<HarnessMessage[]> {
  const maxRounds = o.maxRounds ?? 5;
  let messages = [...o.messages];

  for (let round = 0; round < maxRounds; round++) {
    const pending = new Map<number, PendingTool>();
    const completed: PendingTool[] = [];
    let text = '';
    let stopReason = 'end_turn';

    for await (const event of o.invoke(messages)) {
      o.onEvent?.(event);
      switch (event.kind) {
        case 'text':
          text += event.text;
          break;
        case 'toolUse':
          pending.set(event.contentBlockIndex, {
            toolUseId: event.toolUseId,
            name: event.name,
            raw: '',
          });
          break;
        case 'toolUseInput': {
          const p = pending.get(event.contentBlockIndex);
          if (p) p.raw += event.input;
          break;
        }
        case 'contentBlockStop': {
          const p = pending.get(event.contentBlockIndex);
          if (p) {
            completed.push(p);
            pending.delete(event.contentBlockIndex);
          }
          break;
        }
        case 'stop':
          stopReason = event.reason;
          break;
      }
    }

    if (stopReason !== 'tool_use' || completed.length === 0) {
      return [...messages, { role: 'assistant', content: [{ text: text + stopNote(stopReason) }] }];
    }

    const toolUseBlocks: HarnessContentBlock[] = [];
    const resultBlocks: HarnessContentBlock[] = [];

    for (const p of completed) {
      const { input, parseError } = parseInput(p.raw);
      toolUseBlocks.push({ toolUse: { toolUseId: p.toolUseId, name: p.name, input } });
      // ツールは 1 回だけ呼ぶ。結果と成否を別々に取りに行くと二重に実行される
      const outcome = await runTool(o.tools, p.name, input, parseError);
      resultBlocks.push({
        toolResult: {
          toolUseId: p.toolUseId,
          // toolResult.content は text のみ。json は拒否される（実測）
          content: [{ text: outcome.text }],
          status: outcome.status,
        },
      });
    }

    messages = [
      ...messages,
      { role: 'assistant', content: toolUseBlocks },
      { role: 'user', content: resultBlocks },
    ];
  }

  return [
    ...messages,
    {
      role: 'assistant',
      content: [{ text: `ツールの呼び出しが上限（${maxRounds} 回）に達したため中断しました。` }],
    },
  ];
}

/**
 * 異常終了の理由を人の言葉にする。
 *
 * 商談中に画面が黙って止まるのが最悪。stopReason は 14 種あり、
 * end_turn 以外で終わることが普通にある（実測。aws-facts.md 参照）。
 */
const NORMAL_STOP = new Set(['end_turn', 'stop_sequence']);

const STOP_REASON_NOTE: Record<string, string> = {
  max_tokens: '（応答が長すぎるため途中で止まりました）',
  max_output_tokens_exceeded: '（応答が長すぎるため途中で止まりました）',
  max_iterations_exceeded: '（ツールの呼び出しが多すぎるため中断しました）',
  timeout_exceeded: '（時間切れで中断しました）',
  content_filtered: '（内容フィルタにより応答が止まりました）',
  malformed_tool_use: '（ツールの呼び出しが壊れていました）',
  malformed_model_output: '（モデルの出力が壊れていました）',
  model_context_window_exceeded: '（会話が長くなりすぎました。画面を読み込み直してください）',
  interrupted: '（中断されました）',
  partial_turn: '（応答が途中で終わりました）',
};

function stopNote(reason: string): string {
  if (NORMAL_STOP.has(reason)) return '';
  return `\n\n${STOP_REASON_NOTE[reason] ?? `（応答が ${reason} で終了しました）`}`;
}

function parseInput(raw: string): { input: unknown; parseError?: string } {
  try {
    return { input: raw === '' ? {} : JSON.parse(raw) };
  } catch (e) {
    return { input: {}, parseError: `ツールの引数を JSON として読めませんでした: ${raw}` };
  }
}

interface ToolOutcome {
  text: string;
  status: 'success' | 'error';
}

async function runTool(
  tools: ToolRegistry,
  name: string,
  input: unknown,
  parseError: string | undefined,
): Promise<ToolOutcome> {
  if (parseError) return { text: parseError, status: 'error' };
  const fn = tools[name];
  if (!fn) return { text: `ツール "${name}" はこのデモに登録されていません。`, status: 'error' };
  try {
    return { text: await fn(input), status: 'success' };
  } catch (e) {
    return { text: `ツール "${name}" の実行に失敗しました: ${(e as Error).message}`, status: 'error' };
  }
}
```

- [ ] **Step 4: テストを流して通ることを確認する**

Run: `npx vitest run web/src/agent/toolLoop.test.ts`
Expected: PASS。8 件すべて緑

- [ ] **Step 5: ツールが 1 回しか呼ばれないことを確かめる**

`web/src/agent/toolLoop.test.ts` に 1 件足す:

```ts
  it('ツールは 1 回だけ呼ぶ（結果と成否を二度取りしない）', async () => {
    const search = vi.fn(() => 'ok');
    const { invoke } = fakeInvoke([askSearch, answer]);
    await runTurn({
      invoke,
      tools: { search },
      messages: [{ role: 'user', content: [{ text: 'x' }] }],
    });
    expect(search).toHaveBeenCalledTimes(1);
  });
```

Run: `npx vitest run web/src/agent/toolLoop.test.ts`
Expected: PASS。Step 3 の注意に従って直してあれば通る

- [ ] **Step 6: 全体を流す**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 全部 PASS、型検査は出力なし

- [ ] **Step 7: コミット**

```bash
git add web/src/agent/toolLoop.ts web/src/agent/toolLoop.test.ts
git commit -m "$(cat <<'EOF'
feat: ツールループを追加

inline_function は return-of-control なので、Harness は stopReason: tool_use で
止まり、呼び出し側がツールを実行して toolResult を返す必要がある。

ツールの引数は contentBlockStart には入っておらず、contentBlockDelta の
delta.toolUse.input に JSON の断片として流れる。contentBlockIndex ごとに
連結し、contentBlockStop で完成とみなす。ここは実測で分かったことで、
推定のままだと引数が組み立てられずデモが動かない。

ツールが投げても会話を止めない。商談中に画面が止まるのが最悪であり、
error の toolResult を返せばエージェントが言い直せる。
往復には上限を置いた。無限ループのほうが「答えない」より悪い。
EOF
)"
```

---

## Task 3: Cognito のログイン

**Files:**
- Create: `web/src/auth/pkce.ts`
- Create: `web/src/auth/cognito.ts`
- Test: `web/src/auth/pkce.test.ts`
- Test: `web/src/auth/cognito.test.ts`
- Modify: `infra/lib/foundation-stack.ts`（Hosted UI の URL を出力に足す）
- Modify: `infra/lib/foundation-stack.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
```ts
// pkce.ts
export function base64UrlEncode(bytes: Uint8Array): string;
export function randomUrlSafe(byteLength: number): string;
export async function challengeFromVerifier(verifier: string): Promise<string>;
export async function createPkcePair(): Promise<{ verifier: string; challenge: string }>;

// cognito.ts
export function buildAuthorizeUrl(o: {
  domain: string; clientId: string; redirectUri: string; challenge: string; state: string;
}): string;
export async function exchangeCodeForToken(o: {
  domain: string; clientId: string; redirectUri: string; code: string; verifier: string;
  fetchImpl?: typeof fetch;
}): Promise<string>;
```

**実測済みの事実** — Hosted UI は `https://<instance>.auth.<region>.amazoncognito.com`。
`/oauth2/authorize` と `/oauth2/token` が生きていることを確認済み。
User Pool Client は `generateSecret: false`（公開クライアント）なので **PKCE を使う**。

- [ ] **Step 1: 失敗するテストを書く（PKCE）**

`web/src/auth/pkce.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { base64UrlEncode, randomUrlSafe, challengeFromVerifier, createPkcePair } from './pkce.js';

describe('base64UrlEncode', () => {
  it('URL に使えない文字を出さない', () => {
    const encoded = base64UrlEncode(new Uint8Array([251, 255, 190, 0, 1, 2]));
    expect(encoded).not.toMatch(/[+/=]/);
  });
});

describe('challengeFromVerifier', () => {
  it('RFC 7636 の例と一致する', async () => {
    // RFC 7636 Appendix B の値。実装が正しいことの動かぬ証拠になる
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    await expect(challengeFromVerifier(verifier)).resolves.toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });
});

describe('randomUrlSafe', () => {
  it('呼ぶたびに違う値を返す', () => {
    expect(randomUrlSafe(32)).not.toBe(randomUrlSafe(32));
  });
});

describe('createPkcePair', () => {
  it('verifier から導いた challenge を返す', async () => {
    const pair = await createPkcePair();
    await expect(challengeFromVerifier(pair.verifier)).resolves.toBe(pair.challenge);
  });

  it('verifier は RFC 7636 の長さ制約（43〜128 文字）に収まる', async () => {
    const { verifier } = await createPkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
  });
});
```

- [ ] **Step 2: テストを流して失敗を確認する**

Run: `npx vitest run web/src/auth/pkce.test.ts`
Expected: FAIL。`./pkce.js` が解決できない

- [ ] **Step 3: PKCE を書く**

`web/src/auth/pkce.ts`:

```ts
/**
 * PKCE（RFC 7636）。User Pool Client は generateSecret: false の公開クライアントなので、
 * 認可コードを横取りされても交換できないようにこれを使う。
 */

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomUrlSafe(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export async function challengeFromVerifier(verifier: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

export async function createPkcePair(): Promise<{ verifier: string; challenge: string }> {
  // 32 バイト → base64url で 43 文字。RFC 7636 の下限ちょうど
  const verifier = randomUrlSafe(32);
  return { verifier, challenge: await challengeFromVerifier(verifier) };
}
```

- [ ] **Step 4: テストを流して通ることを確認する**

Run: `npx vitest run web/src/auth/pkce.test.ts`
Expected: PASS。5 件すべて緑

- [ ] **Step 5: 失敗するテストを書く（Cognito）**

`web/src/auth/cognito.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildAuthorizeUrl, exchangeCodeForToken } from './cognito.js';

const base = {
  domain: 'https://example.auth.ap-northeast-1.amazoncognito.com',
  clientId: 'client-abc',
  redirectUri: 'http://localhost:5173/',
};

describe('buildAuthorizeUrl', () => {
  it('認可コードフローと PKCE の指定を載せる', () => {
    const url = new URL(buildAuthorizeUrl({ ...base, challenge: 'ch', state: 'st' }));
    expect(url.origin + url.pathname).toBe(`${base.domain}/oauth2/authorize`);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('client-abc');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:5173/');
    expect(url.searchParams.get('code_challenge')).toBe('ch');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe('st');
  });
});

describe('exchangeCodeForToken', () => {
  it('フォーム形式で POST し、アクセストークンを返す', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ access_token: 'at-1', id_token: 'it-1' }), { status: 200 });
    }) as unknown as typeof fetch;

    const token = await exchangeCodeForToken({ ...base, code: 'c1', verifier: 'v1', fetchImpl });

    expect(token).toBe('at-1');
    expect(seen!.url).toBe(`${base.domain}/oauth2/token`);
    expect((seen!.init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/x-www-form-urlencoded',
    );
    const body = new URLSearchParams(seen!.init.body as string);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('c1');
    expect(body.get('code_verifier')).toBe('v1');
  });

  it('ID トークンではなくアクセストークンを返す', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ access_token: 'at-1', id_token: 'it-1' }), {
        status: 200,
      })) as unknown as typeof fetch;
    // ID トークンには client_id クレームが無く、Harness の allowedClients 検証に落ちて 500 になる
    await expect(exchangeCodeForToken({ ...base, code: 'c', verifier: 'v', fetchImpl })).resolves.toBe('at-1');
  });

  it('交換に失敗したら投げる', async () => {
    const fetchImpl = (async () =>
      new Response('invalid_grant', { status: 400 })) as unknown as typeof fetch;
    await expect(exchangeCodeForToken({ ...base, code: 'c', verifier: 'v', fetchImpl })).rejects.toThrow(
      /invalid_grant/,
    );
  });
});
```

- [ ] **Step 6: テストを流して失敗を確認する**

Run: `npx vitest run web/src/auth/cognito.test.ts`
Expected: FAIL。`./cognito.js` が解決できない

- [ ] **Step 7: Cognito のログインを書く**

`web/src/auth/cognito.ts`:

```ts
/**
 * Cognito Hosted UI の認可コードフロー（PKCE）。
 *
 * Hosted UI は https://<instance>.auth.<region>.amazoncognito.com（実測）。
 * コールバック URL はワイルドカード不可なので、redirectUri は
 * User Pool Client に登録したものと完全に一致させる（末尾のスラッシュも含む）。
 */

export function buildAuthorizeUrl(o: {
  readonly domain: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly challenge: string;
  readonly state: string;
}): string {
  const params = new URLSearchParams({
    client_id: o.clientId,
    response_type: 'code',
    scope: 'openid email',
    redirect_uri: o.redirectUri,
    code_challenge: o.challenge,
    code_challenge_method: 'S256',
    state: o.state,
  });
  return `${o.domain}/oauth2/authorize?${params.toString()}`;
}

export async function exchangeCodeForToken(o: {
  readonly domain: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly code: string;
  readonly verifier: string;
  readonly fetchImpl?: typeof fetch;
}): Promise<string> {
  const doFetch = o.fetchImpl ?? globalThis.fetch;
  const res = await doFetch(`${o.domain}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: o.clientId,
      code: o.code,
      redirect_uri: o.redirectUri,
      code_verifier: o.verifier,
    }).toString(),
  });

  if (!res.ok) {
    throw new Error(`トークンの交換に失敗しました (${res.status}): ${await res.text()}`);
  }

  // アクセストークンを使う。ID トークンには client_id クレームが無く、
  // Harness の allowedClients 検証に落ちて 500 になる（実測）
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error('応答に access_token がありません');
  return json.access_token;
}
```

- [ ] **Step 8: テストを流して通ることを確認する**

Run: `npx vitest run web/src/auth`
Expected: PASS。8 件すべて緑

- [ ] **Step 9: 土台スタックに Hosted UI の URL を出力する**

`infra/lib/foundation-stack.ts` の `addDomain` の呼び出しを変数に受け、出力を 1 つ足す。

```ts
    const domain = this.userPool.addDomain('Domain', {
      cognitoDomain: { domainPrefix: instance },
    });
```

`CfnOutput` の並びに次を足す（Export はしない。案件スタックは使わないため）:

```ts
    // フロントのログイン先。案件スタックは使わないので Export しない
    new CfnOutput(this, 'HostedUiDomain', { value: `https://${domain.domainName}.auth.${this.region}.amazoncognito.com` });
```

`infra/lib/foundation-stack.test.ts` に 1 件足す:

```ts
  it('Hosted UI の URL を出力する（フロントのログイン先）', () => {
    const outputs = synth().findOutputs('HostedUiDomain');
    expect(JSON.stringify(outputs)).toContain('.auth.ap-northeast-1.amazoncognito.com');
  });
```

- [ ] **Step 10: テストと synth を流す**

Run: `npx vitest run && npx tsc --noEmit && npx cdk synth -c instance=demo1 --quiet`
Expected: 全部 PASS、synth はエラーも警告もなし

- [ ] **Step 11: コミット**

```bash
git add web/src/auth infra/lib/foundation-stack.ts infra/lib/foundation-stack.test.ts
git commit -m "$(cat <<'EOF'
feat: Cognito Hosted UI のログイン（PKCE）を追加

User Pool Client は generateSecret: false の公開クライアントなので、
認可コードを横取りされても交換できないよう PKCE を使う。
challenge の導出は RFC 7636 の例と突き合わせてテストしている。
自前実装の暗号処理は「動いているように見えて間違っている」ことがあるため。

アクセストークンを返す。ID トークンには client_id クレームが無く、
Harness の allowedClients 検証に落ちて 500 になる。

Hosted UI の URL を土台スタックの出力に足した。フロントのログイン先で、
これまで人が instance から組み立てるしかなかった。案件スタックは
使わないので Export はしない。
EOF
)"
```

---

## Task 4: 設定の受け渡しと会話の画面

**Files:**
- Create: `web/index.html`
- Create: `web/vite.config.ts`
- Create: `web/src/main.tsx`
- Create: `web/src/config.ts`
- Create: `web/src/ui/App.tsx`
- Create: `web/src/ui/Conversation.tsx`
- Create: `scripts/stack-outputs.ts`
- Test: `web/src/config.test.ts`
- Test: `scripts/stack-outputs.test.ts`
- Modify: `package.json`（依存とスクリプトを足す）
- Modify: `demos/smoke/tools.ts`（ツールの登録表を足す）
- Modify: `tsconfig.json`（JSX の設定）

**Interfaces:**
- Consumes: `invokeHarness` / `newSessionId` / `HarnessMessage`（Task 1）、
  `runTurn` / `ToolRegistry`（Task 2）、`createPkcePair` / `buildAuthorizeUrl` /
  `exchangeCodeForToken`（Task 3）、`demo`（`demos/smoke/demo.ts`）
- Produces:
```ts
// config.ts
export interface WebConfig {
  readonly harnessArn: string;
  readonly cognitoDomain: string;
  readonly clientId: string;
  readonly region: string;
}
export function readConfig(env: Record<string, string | undefined>): WebConfig;

// demos/smoke/tools.ts に追加
export const tools: ToolRegistry;

// scripts/stack-outputs.ts
export function toEnvLines(outputs: Record<string, string>): string;
```

- [ ] **Step 1: 依存を入れ、JSX を有効にする**

```bash
npm i -D react react-dom @types/react @types/react-dom @vitejs/plugin-react vite jsdom @testing-library/react
```

`tsconfig.json` の `compilerOptions` に `"jsx": "react-jsx"` を足す。
`include` は既に `web/**/*.ts` を含むので `"web/**/*.tsx"` も足す。

`package.json` の `scripts` に足す:

```json
    "dev": "vite --config web/vite.config.ts",
    "build:web": "vite build --config web/vite.config.ts"
```

- [ ] **Step 2: 失敗するテストを書く（設定の読み取り）**

`web/src/config.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readConfig } from './config.js';

const full = {
  VITE_HARNESS_ARN: 'arn:aws:bedrock-agentcore:ap-northeast-1:1:harness/a_b-c',
  VITE_COGNITO_DOMAIN: 'https://x.auth.ap-northeast-1.amazoncognito.com',
  VITE_CLIENT_ID: 'client-1',
};

describe('readConfig', () => {
  it('必要な値をそろえて返す', () => {
    expect(readConfig(full)).toEqual({
      harnessArn: full.VITE_HARNESS_ARN,
      cognitoDomain: full.VITE_COGNITO_DOMAIN,
      clientId: full.VITE_CLIENT_ID,
      region: 'ap-northeast-1',
    });
  });

  it('足りない値があれば、どれが足りないかを言って投げる', () => {
    // 空白の画面だけ出て原因が分からないのが最悪なので、起動時に落とす
    expect(() => readConfig({ ...full, VITE_CLIENT_ID: undefined })).toThrow(/VITE_CLIENT_ID/);
  });
});
```

- [ ] **Step 3: テストを流して失敗を確認する**

Run: `npx vitest run web/src/config.test.ts`
Expected: FAIL。`./config.js` が解決できない

- [ ] **Step 4: 設定の読み取りを書く**

`web/src/config.ts`:

```ts
export interface WebConfig {
  readonly harnessArn: string;
  readonly cognitoDomain: string;
  readonly clientId: string;
  readonly region: string;
}

/**
 * ビルド時に渡された設定を読む。
 *
 * 足りなければ起動時に投げる。空白の画面だけ出て原因が分からないのが、
 * 商談前の確認では最悪のため。
 */
export function readConfig(env: Record<string, string | undefined>): WebConfig {
  const required = ['VITE_HARNESS_ARN', 'VITE_COGNITO_DOMAIN', 'VITE_CLIENT_ID'] as const;
  const missing = required.filter((k) => !env[k]);
  if (missing.length > 0) {
    throw new Error(`設定が足りません: ${missing.join(', ')}。scripts/stack-outputs.ts で作れます。`);
  }
  return {
    harnessArn: env.VITE_HARNESS_ARN!,
    cognitoDomain: env.VITE_COGNITO_DOMAIN!,
    clientId: env.VITE_CLIENT_ID!,
    region: env.VITE_REGION ?? 'ap-northeast-1',
  };
}
```

- [ ] **Step 5: 失敗するテストを書く（スタック出力の変換）**

`scripts/stack-outputs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { toEnvLines } from './stack-outputs.js';

describe('toEnvLines', () => {
  it('スタック出力を Vite が読む環境変数の形にする', () => {
    const lines = toEnvLines({
      HarnessArn: 'arn:aws:bedrock-agentcore:ap-northeast-1:1:harness/a_b-c',
      ClientId: 'client-1',
      HostedUiDomain: 'https://x.auth.ap-northeast-1.amazoncognito.com',
      DemoUrl: 'https://smoke.app.amplifyapp.com',
    });
    expect(lines.split('\n').sort()).toEqual([
      'VITE_CLIENT_ID=client-1',
      'VITE_COGNITO_DOMAIN=https://x.auth.ap-northeast-1.amazoncognito.com',
      'VITE_HARNESS_ARN=arn:aws:bedrock-agentcore:ap-northeast-1:1:harness/a_b-c',
    ]);
  });

  it('必要な出力が欠けていたら投げる', () => {
    expect(() => toEnvLines({ ClientId: 'c' })).toThrow(/HarnessArn/);
  });
});
```

- [ ] **Step 6: テストを流して失敗を確認する**

Run: `npx vitest run scripts/stack-outputs.test.ts`
Expected: FAIL。`./stack-outputs.js` が解決できない

- [ ] **Step 7: スタック出力の取り出しを書く**

`scripts/stack-outputs.ts`:

```ts
/**
 * 土台スタックと案件スタックの CFn 出力を、Vite が読む環境変数の形にして出す。
 *
 * 使い方:
 *   npx tsx scripts/stack-outputs.ts <instance> <slug> > web/.env.local
 *
 * 人が値をコピーすると必ず間違える。実物から引く。
 */
import { execFileSync } from 'node:child_process';

const REQUIRED = {
  HarnessArn: 'VITE_HARNESS_ARN',
  ClientId: 'VITE_CLIENT_ID',
  HostedUiDomain: 'VITE_COGNITO_DOMAIN',
} as const;

export function toEnvLines(outputs: Record<string, string>): string {
  const missing = Object.keys(REQUIRED).filter((k) => !outputs[k]);
  if (missing.length > 0) {
    throw new Error(`スタックの出力が足りません: ${missing.join(', ')}`);
  }
  return Object.entries(REQUIRED)
    .map(([key, envName]) => `${envName}=${outputs[key]}`)
    .join('\n');
}

function stackOutputs(stackName: string): Record<string, string> {
  const raw = execFileSync(
    'aws',
    [
      'cloudformation', 'describe-stacks',
      '--stack-name', stackName,
      '--region', 'ap-northeast-1',
      '--query', 'Stacks[0].Outputs',
      '--output', 'json',
    ],
    { encoding: 'utf-8' },
  );
  const entries = JSON.parse(raw) as { OutputKey: string; OutputValue: string }[];
  return Object.fromEntries(entries.map((e) => [e.OutputKey, e.OutputValue]));
}

// このファイルを直接実行したときだけ AWS を叩く（テストからの import では叩かない）
if (process.argv[1]?.endsWith('stack-outputs.ts')) {
  const [instance, slug] = process.argv.slice(2);
  if (!instance || !slug) {
    throw new Error('使い方: npx tsx scripts/stack-outputs.ts <instance> <slug>');
  }
  const outputs = {
    ...stackOutputs(`FdeDemo-${instance}-Foundation`),
    ...stackOutputs(`FdeDemo-${instance}-${slug}`),
  };
  console.log(toEnvLines(outputs));
}
```

- [ ] **Step 8: テストを流して通ることを確認する**

Run: `npx vitest run web/src/config.test.ts scripts/stack-outputs.test.ts`
Expected: PASS。4 件すべて緑

- [ ] **Step 9: 案件のツール登録表を足す**

`demos/smoke/tools.ts` の末尾に足す（既存の `search` は消さない）:

```ts
import type { ToolRegistry } from '../../web/src/agent/toolLoop.js';

/** demo.ts の tools 宣言と名前を合わせること。ここが食い違うとツールが呼ばれない。 */
export const tools: ToolRegistry = { search: (input) => search(input as { keyword: string }) };
```

- [ ] **Step 10: Vite の設定と入口を書く**

`web/vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: { port: 5173 },
});
```

`web/index.html`:

```html
<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>デモ</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`web/src/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App.js';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 11: 会話の画面を書く**

`web/src/ui/Conversation.tsx`:

```tsx
import { useState } from 'react';
import type { HarnessMessage } from '../agent/harnessClient.js';

/** 画面に出す 1 行。ツール呼び出しは会話には出さない（右のトレースに出す）。 */
function visibleText(message: HarnessMessage): string {
  return message.content.map((b) => ('text' in b ? b.text : '')).join('');
}

export function Conversation(props: {
  readonly messages: HarnessMessage[];
  readonly busy: boolean;
  readonly examples: readonly string[];
  readonly onSend: (text: string) => void;
}) {
  const [draft, setDraft] = useState('');

  const send = (text: string) => {
    if (!text.trim() || props.busy) return;
    setDraft('');
    props.onSend(text);
  };

  return (
    <section style={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0 }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '1rem' }}>
        {props.messages.map((m, i) => {
          const text = visibleText(m);
          if (!text) return null;
          return (
            <p key={i} style={{ margin: '0 0 1rem', whiteSpace: 'pre-wrap' }}>
              <strong>{m.role === 'user' ? 'あなた' : 'エージェント'}: </strong>
              {text}
            </p>
          );
        })}
        {props.busy && <p style={{ opacity: 0.6 }}>考えています…</p>}
      </div>

      <div style={{ padding: '0 1rem 0.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {props.examples.map((q) => (
          <button key={q} onClick={() => send(q)} disabled={props.busy} style={{ fontSize: '0.85rem' }}>
            {q}
          </button>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
        style={{ display: 'flex', gap: '0.5rem', padding: '1rem' }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="質問を入力"
          style={{ flex: 1, padding: '0.5rem' }}
        />
        <button type="submit" disabled={props.busy}>
          送信
        </button>
      </form>
    </section>
  );
}
```

`web/src/ui/App.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { readConfig } from '../config.js';
import { createPkcePair, randomUrlSafe } from '../auth/pkce.js';
import { buildAuthorizeUrl, exchangeCodeForToken } from '../auth/cognito.js';
import { invokeHarness, newSessionId, HarnessError, type HarnessMessage } from '../agent/harnessClient.js';
import { runTurn } from '../agent/toolLoop.js';
import { Conversation } from './Conversation.js';
import { demo } from '../../../demos/smoke/demo.js';
import { tools } from '../../../demos/smoke/tools.js';

const config = readConfig(import.meta.env as unknown as Record<string, string | undefined>);
const redirectUri = `${window.location.origin}/`;

export function App() {
  const [token, setToken] = useState<string | null>(null);
  const [messages, setMessages] = useState<HarnessMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId] = useState(newSessionId);

  useEffect(() => {
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      const verifier = sessionStorage.getItem('pkce_verifier');

      if (code && verifier) {
        try {
          setToken(
            await exchangeCodeForToken({
              domain: config.cognitoDomain,
              clientId: config.clientId,
              redirectUri,
              code,
              verifier,
            }),
          );
          sessionStorage.removeItem('pkce_verifier');
          window.history.replaceState({}, '', redirectUri);
        } catch (e) {
          setError((e as Error).message);
        }
        return;
      }

      const pair = await createPkcePair();
      sessionStorage.setItem('pkce_verifier', pair.verifier);
      window.location.href = buildAuthorizeUrl({
        domain: config.cognitoDomain,
        clientId: config.clientId,
        redirectUri,
        challenge: pair.challenge,
        state: randomUrlSafe(16),
      });
    })();
  }, []);

  const send = async (text: string) => {
    if (!token) return;
    setError(null);
    setBusy(true);
    const next: HarnessMessage[] = [...messages, { role: 'user', content: [{ text }] }];
    setMessages(next);
    try {
      setMessages(
        await runTurn({
          invoke: (ms) =>
            invokeHarness({
              harnessArn: config.harnessArn,
              accessToken: token,
              runtimeSessionId: sessionId,
              messages: ms,
              region: config.region,
            }),
          tools,
          messages: next,
        }),
      );
    } catch (e) {
      // 認可拒否も 500 で来る。商談中に黙って止まるのが最悪なので必ず出す
      setError(
        e instanceof HarnessError && e.denied
          ? 'このアカウントにはこのデモを見る権限がありません。'
          : `応答に失敗しました: ${(e as Error).message}`,
      );
    } finally {
      setBusy(false);
    }
  };

  if (!token) return <p style={{ padding: '2rem' }}>{error ?? 'ログインしています…'}</p>;

  return (
    <main style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{ padding: '0.75rem 1rem', background: demo.brand.primary, color: '#fff' }}>
        <strong>{demo.clientName}</strong> — デモ
      </header>
      {error && <p style={{ color: '#b91c1c', padding: '0 1rem' }}>{error}</p>}
      <div style={{ flex: 1, minHeight: 0 }}>
        <Conversation messages={messages} busy={busy} examples={demo.examples} onSend={send} />
      </div>
    </main>
  );
}
```

- [ ] **Step 12: 全体を流す**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 全部 PASS、型検査は出力なし

- [ ] **Step 13: ローカルで実際に通す（未確認を 1 件潰す）**

```bash
npx tsx scripts/stack-outputs.ts fdedemo0809 smoke > web/.env.local
npm run dev
```

ブラウザで `http://localhost:5173/` を開く。**Hosted UI に飛び、ログインし、戻ってきて
`demo.examples` の 1 問目を押すと答えが返ること**を確認する。

**ここで確認するのは次の 1 点** — 実測は `admin-initiate-auth` で取ったトークンで行った。
**Hosted UI 経由のアクセストークンでも Harness が通るか**は未確認である。
落ちた場合は、トークンを decode して `client_id` と `cognito:groups` を確認し、
結果を `aws-facts.md` に書いてから相談すること。

**`web/.env.local` をコミットしないこと**（`.gitignore` の `.env.*` で除外済み。確認する）。

- [ ] **Step 14: コミット**

```bash
git add web package.json package-lock.json tsconfig.json scripts demos/smoke/tools.ts
git commit -m "$(cat <<'EOF'
feat: 会話の画面と設定の受け渡しを追加

設定は人がコピーせず、スタックの出力から引く。ARN や Client ID を手で
写すと必ず間違え、しかも画面が真っ白になるだけで原因が分からない。
足りない値があれば起動時に、どれが足りないかを言って落とす。

エラーは必ず画面に出す。商談中に黙って止まるのが最悪であり、
とくに認可拒否は 500 で来るので「落ちた」と区別して出し分ける。

例示の 3 問はボタンにした。商談ではこれを順に押す。3 つ目は
答えられない質問で、運用部門の懸念を先に否定するために置いてある。
EOF
)"
```

---

## Task 5: Amplify へのデプロイ

**Files:**
- Create: `scripts/deploy-web.ts`
- Test: `scripts/deploy-web.test.ts`
- Modify: `package.json`（`deploy:web` スクリプト）

**Interfaces:**
- Consumes: `toEnvLines`（Task 4）
- Produces:
```ts
export function zipUploadRequest(o: { zipUploadUrl: string; zipPath: string }): string[];
export function deployWeb(o: { instance: string; slug: string }): Promise<string>; // DemoUrl を返す
```

**実測済みの手順**（`aws-facts.md`）— 自前の S3 バケットは要らない。

```
1. aws amplify create-deployment  → jobId と zipUploadUrl が返る
2. curl -X PUT --upload-file dist.zip "<zipUploadUrl>"
3. aws amplify start-deployment --job-id <jobId>
```

- [ ] **Step 1: 失敗するテストを書く**

`scripts/deploy-web.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { zipUploadRequest } from './deploy-web.js';

describe('zipUploadRequest', () => {
  it('署名付き URL に ZIP を PUT する curl の引数を作る', () => {
    const args = zipUploadRequest({ zipUploadUrl: 'https://s3/put?sig=1', zipPath: '/tmp/x/dist.zip' });
    expect(args).toEqual(['-X', 'PUT', '--upload-file', '/tmp/x/dist.zip', 'https://s3/put?sig=1']);
  });

  it('URL をシェルに展開させない形で渡す（署名に & が入るため）', () => {
    const args = zipUploadRequest({ zipUploadUrl: 'https://s3/put?a=1&b=2', zipPath: 'z.zip' });
    // 配列のまま execFile に渡す前提。1 要素として保たれていること
    expect(args.at(-1)).toBe('https://s3/put?a=1&b=2');
  });
});
```

- [ ] **Step 2: テストを流して失敗を確認する**

Run: `npx vitest run scripts/deploy-web.test.ts`
Expected: FAIL。`./deploy-web.js` が解決できない

- [ ] **Step 3: デプロイのスクリプトを書く**

`scripts/deploy-web.ts`:

```ts
/**
 * フロントをビルドして Amplify に手動デプロイする。
 *
 * 使い方:
 *   npx tsx scripts/deploy-web.ts <instance> <slug>
 *
 * リポジトリを接続していないので自動ビルドは走らない。ZIP を上げる。
 * 自前の S3 バケットは要らない（create-deployment が署名付き URL を返す）。
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toEnvLines } from './stack-outputs.js';

const REGION = 'ap-northeast-1';

/** 署名付き URL に & が入るので、シェルを介さず配列のまま execFile に渡す。 */
export function zipUploadRequest(o: { zipUploadUrl: string; zipPath: string }): string[] {
  return ['-X', 'PUT', '--upload-file', o.zipPath, o.zipUploadUrl];
}

function aws(args: string[]): string {
  return execFileSync('aws', [...args, '--region', REGION], { encoding: 'utf-8' });
}

function stackOutputs(stackName: string): Record<string, string> {
  const raw = aws(['cloudformation', 'describe-stacks', '--stack-name', stackName,
    '--query', 'Stacks[0].Outputs', '--output', 'json']);
  const entries = JSON.parse(raw) as { OutputKey: string; OutputValue: string }[];
  return Object.fromEntries(entries.map((e) => [e.OutputKey, e.OutputValue]));
}

export async function deployWeb(o: { instance: string; slug: string }): Promise<string> {
  const outputs = {
    ...stackOutputs(`FdeDemo-${o.instance}-Foundation`),
    ...stackOutputs(`FdeDemo-${o.instance}-${o.slug}`),
  };

  // ビルド設定はリポジトリの web/.env.local に書く。ビルド成果物だけを一時領域に置く
  writeFileSync('web/.env.local', toEnvLines(outputs) + '\n');
  execFileSync('npm', ['run', 'build:web'], { stdio: 'inherit' });

  const work = mkdtempSync(join(tmpdir(), 'fde-demo-'));
  const zipPath = join(work, 'dist.zip');
  execFileSync('zip', ['-qr', zipPath, '.'], { cwd: 'dist' });

  const created = JSON.parse(
    aws(['amplify', 'create-deployment', '--app-id', outputs.AmplifyAppId, '--branch-name', o.slug]),
  ) as { jobId: string; zipUploadUrl: string };

  execFileSync('curl', ['-fsS', ...zipUploadRequest({ zipUploadUrl: created.zipUploadUrl, zipPath })]);

  aws(['amplify', 'start-deployment', '--app-id', outputs.AmplifyAppId,
    '--branch-name', o.slug, '--job-id', created.jobId]);

  return outputs.DemoUrl;
}

if (process.argv[1]?.endsWith('deploy-web.ts')) {
  const [instance, slug] = process.argv.slice(2);
  if (!instance || !slug) throw new Error('使い方: npx tsx scripts/deploy-web.ts <instance> <slug>');
  deployWeb({ instance, slug }).then((url) => console.log(`デモの URL: ${url}`));
}
```

`package.json` の `scripts` に足す:

```json
    "deploy:web": "tsx scripts/deploy-web.ts"
```

- [ ] **Step 4: テストを流して通ることを確認する**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 全部 PASS

- [ ] **Step 5: 実際にデプロイして通す**

```bash
npx tsx scripts/deploy-web.ts fdedemo0809 smoke
```

Expected: ビルドが通り、`デモの URL: https://smoke.<appId>.amplifyapp.com` が出る。

ジョブの完了を待つ:

```bash
aws amplify list-jobs --region ap-northeast-1 --app-id <appId> --branch-name smoke \
  --query 'jobSummaries[0].{status:status,jobId:jobId}' --output json
```
Expected: `status` が `SUCCEED` になる。

**ブラウザで `DemoUrl` を開き、ログインして 3 問すべてを通すこと。**
とくに **3 問目（答えられない質問）で、エージェントが答えを拒み、
どこに回すかを示すこと**を確認する。ここがこのデモの肝である。

**所要時間を記録する**（要件書 1.1 の「設定を書いてから URL 発行まで」に対応する）。

- [ ] **Step 6: コミット**

```bash
git add scripts/deploy-web.ts scripts/deploy-web.test.ts package.json
git commit -m "$(cat <<'EOF'
feat: Amplify への手動デプロイを自動化した

リポジトリを接続していないので自動ビルドは走らない。ZIP を上げる。
create-deployment が署名付き URL を返すので、自前の S3 バケットは要らない。

署名付き URL には & が入る。シェルを介すと展開されて壊れるので、
execFile に配列のまま渡す。ここは一度踏むと原因が分かりにくい。

ビルド設定はスタックの出力から作る。人が写すと間違えるうえ、
間違いが「画面が真っ白」としてしか現れない。
EOF
)"
```

---

## Task 6: 実行トレース

**Files:**
- Create: `web/src/ui/traceText.ts`
- Create: `web/src/ui/TraceView.tsx`
- Test: `web/src/ui/traceText.test.ts`
- Modify: `web/src/ui/App.tsx`（トレースを右に置く）

**Interfaces:**
- Consumes: `StreamEvent`
- Produces:
```ts
export interface TraceLine {
  readonly label: string;
  readonly detail: string;
}
export function extractCode(input: unknown, maxLength?: number): string;
export function toTraceLines(events: readonly StreamEvent[]): TraceLine[];
```

**要件書 4.1** — 実行トレースが見えることはこの基盤の差別化点。単に答えるだけの
チャットとの差はここに出る。

**前身での失敗** — Code Interpreter の入力には**生成コードとデータ全体**が入るため、
そのまま出すと画面が JSON で埋まった。**コード本体だけを抜き出し、長さも抑える**必要がある。

- [ ] **Step 1: 失敗するテストを書く**

`web/src/ui/traceText.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { extractCode, toTraceLines } from './traceText.js';
import type { StreamEvent } from '../agent/streamParser.js';

describe('extractCode', () => {
  it('code キーがあればコード本体だけを返す', () => {
    const input = { code: 'print(sum(x))', data: [{ a: 1 }, { a: 2 }] };
    expect(extractCode(input)).toBe('print(sum(x))');
  });

  it('データ全体を混ぜない（画面が JSON で埋まるのを防ぐ）', () => {
    const input = { code: 'print(1)', data: Array.from({ length: 500 }, (_, i) => ({ i })) };
    expect(extractCode(input)).not.toContain('499');
  });

  it('長すぎるコードは切り詰めて、切ったことが分かるようにする', () => {
    const code = 'x'.repeat(1000);
    const out = extractCode({ code }, 100);
    expect(out.length).toBeLessThanOrEqual(120);
    expect(out).toContain('…');
  });

  it('code キーが無ければ入力を短く要約する', () => {
    expect(extractCode({ keyword: '出張' })).toContain('出張');
  });
});

describe('toTraceLines', () => {
  it('ツール呼び出しを 1 行にする', () => {
    const events: StreamEvent[] = [
      { kind: 'toolUse', toolUseId: 't1', name: 'search', type: 'tool_use', contentBlockIndex: 0 },
      { kind: 'toolUseInput', contentBlockIndex: 0, input: '{"keyword":"出張"}' },
      { kind: 'contentBlockStop', contentBlockIndex: 0 },
    ];
    const lines = toTraceLines(events);
    expect(lines).toHaveLength(1);
    expect(lines[0].label).toContain('search');
    expect(lines[0].detail).toContain('出張');
  });

  it('誰が実行したかが分かる（ブラウザ側か Harness 側か）', () => {
    const events: StreamEvent[] = [
      { kind: 'toolUse', toolUseId: 't1', name: 'code', type: 'server_tool_use', contentBlockIndex: 0 },
      { kind: 'toolUseInput', contentBlockIndex: 0, input: '{"code":"print(1)"}' },
      { kind: 'contentBlockStop', contentBlockIndex: 0 },
    ];
    expect(toTraceLines(events)[0].label).toContain('Harness');
  });

  it('本文の差分はトレースに出さない', () => {
    expect(toTraceLines([{ kind: 'text', text: 'こんにちは' }])).toHaveLength(0);
  });

  it('ツール結果の成否を出す', () => {
    const events: StreamEvent[] = [
      { kind: 'toolResult', toolUseId: 't1', status: 'error' },
    ];
    expect(toTraceLines(events)[0].detail).toContain('error');
  });
});
```

- [ ] **Step 2: テストを流して失敗を確認する**

Run: `npx vitest run web/src/ui/traceText.test.ts`
Expected: FAIL。`./traceText.js` が解決できない

- [ ] **Step 3: トレースの文言を書く**

`web/src/ui/traceText.ts`:

```ts
import type { StreamEvent } from '../agent/streamParser.js';

export interface TraceLine {
  readonly label: string;
  readonly detail: string;
}

/**
 * ツール入力から画面に出す文字列を作る。
 *
 * Code Interpreter の入力には生成コードとデータ全体が入る。そのまま出すと
 * 画面が JSON で埋まるので、コード本体だけを抜き、長さも抑える（前身での失敗）。
 */
export function extractCode(input: unknown, maxLength = 400): string {
  const source =
    input && typeof input === 'object' && 'code' in input && typeof (input as { code: unknown }).code === 'string'
      ? (input as { code: string }).code
      : JSON.stringify(input ?? {});
  return source.length > maxLength ? `${source.slice(0, maxLength)}…` : source;
}

const WHO: Record<string, string> = {
  tool_use: 'ブラウザ',
  mcp_tool_use: 'Harness (MCP)',
  server_tool_use: 'Harness',
};

export function toTraceLines(events: readonly StreamEvent[]): TraceLine[] {
  const pending = new Map<number, { name: string; type: string; raw: string }>();
  const lines: TraceLine[] = [];

  for (const e of events) {
    switch (e.kind) {
      case 'toolUse':
        pending.set(e.contentBlockIndex, { name: e.name, type: e.type, raw: '' });
        break;
      case 'toolUseInput': {
        const p = pending.get(e.contentBlockIndex);
        if (p) p.raw += e.input;
        break;
      }
      case 'contentBlockStop': {
        const p = pending.get(e.contentBlockIndex);
        if (!p) break;
        pending.delete(e.contentBlockIndex);
        lines.push({
          label: `${p.name}（${WHO[p.type] ?? p.type} が実行）`,
          detail: extractCode(safeParse(p.raw)),
        });
        break;
      }
      case 'toolResult':
        lines.push({ label: '結果', detail: e.status });
        break;
    }
  }
  return lines;
}

function safeParse(raw: string): unknown {
  try {
    return raw === '' ? {} : JSON.parse(raw);
  } catch {
    return raw;
  }
}
```

- [ ] **Step 4: テストを流して通ることを確認する**

Run: `npx vitest run web/src/ui/traceText.test.ts`
Expected: PASS。8 件すべて緑

- [ ] **Step 5: トレースの画面を書く**

`web/src/ui/TraceView.tsx`:

```tsx
import type { TraceLine } from './traceText.js';

export function TraceView(props: { readonly lines: readonly TraceLine[] }) {
  return (
    <aside
      style={{
        width: '22rem',
        borderLeft: '1px solid #e5e7eb',
        overflowY: 'auto',
        padding: '1rem',
        fontSize: '0.85rem',
      }}
    >
      <h2 style={{ fontSize: '0.9rem', margin: '0 0 0.75rem' }}>実行トレース</h2>
      {props.lines.length === 0 && <p style={{ opacity: 0.6 }}>まだ何も調べていません</p>}
      {props.lines.map((line, i) => (
        <div key={i} style={{ marginBottom: '0.75rem' }}>
          <div style={{ fontWeight: 600 }}>{line.label}</div>
          <pre style={{ margin: '0.25rem 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {line.detail}
          </pre>
        </div>
      ))}
    </aside>
  );
}
```

- [ ] **Step 6: 画面に組み込む**

`web/src/ui/App.tsx` を次のように変える。

1. import に足す:

```tsx
import { TraceView } from './TraceView.js';
import { toTraceLines } from './traceText.js';
import type { StreamEvent } from '../agent/streamParser.js';
```

2. 状態を足す:

```tsx
  const [events, setEvents] = useState<StreamEvent[]>([]);
```

3. `send` の中で、送信前に `setEvents([])` し、`runTurn` に `onEvent` を渡す:

```tsx
          onEvent: (e) => setEvents((prev) => [...prev, e]),
```

4. 会話の右にトレースを置く:

```tsx
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <Conversation messages={messages} busy={busy} examples={demo.examples} onSend={send} />
        <TraceView lines={toTraceLines(events)} />
      </div>
```

- [ ] **Step 7: 全体を流してデプロイする**

```bash
npx vitest run && npx tsc --noEmit
npx tsx scripts/deploy-web.ts fdedemo0809 smoke
```

**ブラウザで 3 問を通し、右のトレースに `search（ブラウザ が実行）` と
検索語が出ることを確認する。**

- [ ] **Step 8: コミット**

```bash
git add web/src/ui
git commit -m "$(cat <<'EOF'
feat: 実行トレースを画面に出した

何を調べたかが見えることがこの基盤の差別化点で、単に答えるだけの
チャットとの差はここに出る（要件書 4.1）。

Code Interpreter の入力には生成コードとデータ全体が入る。前身では
そのまま出して画面が JSON で埋まった。コード本体だけを抜き、
長さも抑える。切ったことが分かるようにしてある。

誰がツールを実行したかも出す。ブラウザ側と Harness 側が同じ
ストリームに混ざるため、区別が付かないと説明できない。
EOF
)"
```

---

## Task 7: 手順書

**Files:**
- Create: `RUNBOOK.md`
- Modify: `CLAUDE.md`（現状の記述を更新）

**Interfaces:**
- Consumes: これまでの全成果物
- Produces: 人が最初から最後まで再現できる手順書

**必須サブスキル** — このタスクは `verify-runbook` スキルに従って行うこと。
**書いてから検証するのではなく、1 手順書いたらその場で流し、出力を貼ってから次に進む。**
要件書 9.1 は「ドキュメントを先に書いて後で検証する」を、やらないほうがよいことの
筆頭に挙げている。

- [ ] **Step 1: `verify-runbook` スキルを起動する**

このタスクの進め方はスキルが指示する。**先に読むこと。**

- [ ] **Step 2: 手順書に載せる範囲を決めて書きながら流す**

載せるのは次の 6 つ。**各手順は実際に実行し、出力を貼ること。**

1. 前提（AWS の認証情報、`npm install`、CDK の bootstrap 確認）
2. 土台の構築（`cdk deploy` と出力の意味）
3. 案件の追加（案件スタックのデプロイ、デモユーザーの作成とグループ追加）
4. フロントのデプロイ（`scripts/deploy-web.ts`、ジョブ完了の確認）
5. 動作確認（ログイン、3 問、トレース）
6. 撤去（`cdk destroy` の順序、Harness の削除に数分かかること、`cleanup-check`）

**2 周目（既にリソースがある状態）で成立するかを必ず確認する。**

**数値を埋め込まない**（要件書 5.7）。テスト件数のような変動する数字は書かない。

**パスワードを書かない。** デモユーザーのパスワードは実行時に `read -rs` で受ける。

- [ ] **Step 3: `CLAUDE.md` の「現状」を更新する**

「実装は 1 行もない」は、もはや事実ではない。何ができていて、次に何をするのかに書き換える。
**`RUNBOOK.md` へのポインタを置く。**

- [ ] **Step 4: コミット**

```bash
git add RUNBOOK.md CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: 構築から撤去までの手順書を追加

書きながら実行した。前身では README を書いたあとに通し検証をして、
/tmp に書く手順・実際と違う画面遷移・確認方法の無い記述など
多数の欠陥が出た。順序を逆にしないための手順書である。

CLAUDE.md の「実装は 1 行もない」を書き換えた。事実でなくなったまま
残すと、次のセッションがゼロから作り直そうとする。
EOF
)"
```

---

## この計画を終えた時点の状態

| | |
|---|---|
| できること | クライアントが URL を開き、ログインし、会話し、**何を調べたかが見える** |
| 商談で見せるもの | 例示の 3 問。**3 つ目は答えられない質問** |
| 撤去 | `cdk destroy` 2 回。手順書に検証済みの手順がある |
| 残るもの | 要件書 7.1（リポジトリと Cognito の分割単位）は**未決のまま** |

## 次にやりうること

**実案件を 1 件起こす。** `new-demo` スキルから入る（`CLAUDE.md`）。
そこで初めて「答えてはいけないこと」を聞き出す設計が試される。

**工場（生成の自動化）はまだ作らない。** 要件書 9 章のとおり、型が見えてからにする。
