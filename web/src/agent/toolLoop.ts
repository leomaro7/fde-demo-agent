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
          // type が 3 種ある。ブラウザ側（inline_function）が実行するのは
          // 'tool_use' だけ。'mcp_tool_use' / 'server_tool_use'（Code Interpreter 等）は
          // Harness が既に実行済みなので、溜めない・実行しない・toolResult を返さない。
          // ここで pending に積まなければ、後続の toolUseInput / contentBlockStop は
          // p が見つからず何もしない（既存の分岐がそのまま効く）
          if (event.type === 'tool_use') {
            pending.set(event.contentBlockIndex, {
              toolUseId: event.toolUseId,
              name: event.name,
              raw: '',
            });
          }
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

    // ツールを呼ぶ前の前置き（「規程を確認します」等）を捨てない。
    // 画面表示と、モデルが自分の発言を履歴から見失わないようにするため toolUse より前に積む
    const assistantBlocks: HarnessContentBlock[] = text === '' ? [] : [{ text }];
    const resultBlocks: HarnessContentBlock[] = [];

    for (const p of completed) {
      const { input, parseError } = parseInput(p.raw);
      assistantBlocks.push({ toolUse: { toolUseId: p.toolUseId, name: p.name, input } });
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
      { role: 'assistant', content: assistantBlocks },
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
  } catch {
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
