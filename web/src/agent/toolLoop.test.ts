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

  it('登録表に無いツールは Harness が実行したものとみなし、toolResult を返さない', async () => {
    // Code Interpreter の code_interpreter / file_operations / shell は
    // type: 'tool_use' で来るが Harness が実行済み。こちらが結果を返すと二重になる
    const serverSide: StreamEvent[] = [
      { kind: 'toolUse', toolUseId: 'tu-s', name: 'shell', type: 'tool_use', contentBlockIndex: 0 },
      { kind: 'toolUseInput', contentBlockIndex: 0, input: '{"command":"ls"}' },
      { kind: 'contentBlockStop', contentBlockIndex: 0 },
      { kind: 'toolResult', toolUseId: 'tu-s', status: 'success' },
      { kind: 'text', text: '集計しました。' },
      { kind: 'stop', reason: 'end_turn' },
    ];
    const { invoke, seen } = fakeInvoke([serverSide]);
    const messages = await runTurn({
      invoke,
      tools: { get_sales: () => 'csv' },
      messages: [{ role: 'user', content: [{ text: 'x' }] }],
    });
    // 往復していない = toolResult を送り返していない
    expect(seen).toHaveLength(1);
    expect(messages.at(-1)).toEqual({ role: 'assistant', content: [{ text: '集計しました。' }] });
  });

  it('登録表に無いツールを Harness が待っているなら、理由を画面に出す（黙って止まらない）', async () => {
    // demo.ts のツール宣言と tools.ts の登録表が食い違うと起きる
    const waiting: StreamEvent[] = [
      { kind: 'toolUse', toolUseId: 'tu-x', name: 'typo_tool', type: 'tool_use', contentBlockIndex: 0 },
      { kind: 'toolUseInput', contentBlockIndex: 0, input: '{}' },
      { kind: 'contentBlockStop', contentBlockIndex: 0 },
      { kind: 'stop', reason: 'tool_use' },
    ];
    const { invoke } = fakeInvoke([waiting]);
    const messages = await runTurn({
      invoke,
      tools: { get_sales: () => 'csv' },
      messages: [{ role: 'user', content: [{ text: 'x' }] }],
    });
    const out = (messages.at(-1)!.content[0] as { text: string }).text;
    expect(out).toContain('登録されて');
    expect(out).toContain('tools.ts');
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

  it('ツールを呼ぶ前の前置きを assistant メッセージの text ブロックとして残す', async () => {
    const preambleThenSearch: StreamEvent[] = [
      { kind: 'text', text: '規程を確認します。' },
      { kind: 'toolUse', toolUseId: 'tu-1', name: 'search', type: 'tool_use', contentBlockIndex: 0 },
      { kind: 'toolUseInput', contentBlockIndex: 0, input: '{"keyword": "出張"}' },
      { kind: 'contentBlockStop', contentBlockIndex: 0 },
      { kind: 'stop', reason: 'tool_use' },
    ];
    const { invoke, seen } = fakeInvoke([preambleThenSearch, answer]);
    await runTurn({
      invoke,
      tools: { search: () => 'ok' },
      messages: [{ role: 'user', content: [{ text: '出張の精算は' }] }],
    });
    expect(seen[1][1]).toEqual({
      role: 'assistant',
      content: [
        { text: '規程を確認します。' },
        { toolUse: { toolUseId: 'tu-1', name: 'search', input: { keyword: '出張' } } },
      ],
    });
  });

  it('server_tool_use の toolUse はブラウザ側では実行しない（Harness が実行済み）', async () => {
    const search = vi.fn(() => 'ok');
    // Code Interpreter 等。Harness が既に実行し、結果を踏まえて自分で応答まで終える想定
    const codeInterpreterRound: StreamEvent[] = [
      { kind: 'toolUse', toolUseId: 'tu-ci', name: 'code', type: 'server_tool_use', contentBlockIndex: 0 },
      { kind: 'toolUseInput', contentBlockIndex: 0, input: '{"code": "1+1"}' },
      { kind: 'contentBlockStop', contentBlockIndex: 0 },
      { kind: 'toolResult', toolUseId: 'tu-ci', status: 'success' },
      { kind: 'text', text: '2 です。' },
      { kind: 'stop', reason: 'end_turn' },
    ];
    const seenEvents: StreamEvent[] = [];
    const { invoke } = fakeInvoke([codeInterpreterRound]);
    const messages = await runTurn({
      invoke,
      tools: { search },
      messages: [{ role: 'user', content: [{ text: 'x' }] }],
      onEvent: (e) => seenEvents.push(e),
    });

    // ブラウザ側のツールは呼ばれない
    expect(search).not.toHaveBeenCalled();
    // toolResult を積んでいない = 往復せず、そのターンの text だけが最終応答になる
    expect(messages.at(-1)).toEqual({
      role: 'assistant',
      content: [{ text: '2 です。' }],
    });
    // onEvent には Harness 側の実行イベントも含めて全部流れる（画面のトレース用）
    expect(seenEvents).toEqual(codeInterpreterRound);
  });

  it('複数のツールが同時に呼ばれても contentBlockIndex ごとに断片が混ざらない', async () => {
    const twoToolsInterleaved: StreamEvent[] = [
      { kind: 'toolUse', toolUseId: 'tu-a', name: 'toolA', type: 'tool_use', contentBlockIndex: 0 },
      { kind: 'toolUse', toolUseId: 'tu-b', name: 'toolB', type: 'tool_use', contentBlockIndex: 1 },
      { kind: 'toolUseInput', contentBlockIndex: 0, input: '{"a"' },
      { kind: 'toolUseInput', contentBlockIndex: 1, input: '{"b"' },
      { kind: 'toolUseInput', contentBlockIndex: 0, input: ': 1}' },
      { kind: 'toolUseInput', contentBlockIndex: 1, input: ': 2}' },
      { kind: 'contentBlockStop', contentBlockIndex: 0 },
      { kind: 'contentBlockStop', contentBlockIndex: 1 },
      { kind: 'stop', reason: 'tool_use' },
    ];
    const toolA = vi.fn(() => 'A の結果');
    const toolB = vi.fn(() => 'B の結果');
    const { invoke, seen } = fakeInvoke([twoToolsInterleaved, answer]);
    await runTurn({
      invoke,
      tools: { toolA, toolB },
      messages: [{ role: 'user', content: [{ text: 'x' }] }],
    });

    expect(toolA).toHaveBeenCalledWith({ a: 1 });
    expect(toolB).toHaveBeenCalledWith({ b: 2 });

    const resultMessage = seen[1].at(-1)!;
    expect(resultMessage).toEqual({
      role: 'user',
      content: [
        {
          toolResult: { toolUseId: 'tu-a', content: [{ text: 'A の結果' }], status: 'success' },
        },
        {
          toolResult: { toolUseId: 'tu-b', content: [{ text: 'B の結果' }], status: 'success' },
        },
      ],
    });
  });
});
