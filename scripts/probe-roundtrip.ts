/**
 * ツールを最後まで往復させて、モデルが**この基盤のツールループで動くか**を確かめる。
 *
 * `probe-harness.ts` は 1 ターン目の生イベントを見るためのもので、
 * **ツール結果を返した後まで見ない。** モデルを変えたときに知りたいのは
 * 「呼んでくるか」ではなく「結果を渡したら最後まで書くか」なので、こちらを使う。
 * 1 往復では足りない。**2 周目でもう一度検索するモデルがある**（実測）。
 *
 * ブラウザを開かずに済むぶん速い。ただし**画面の表示は確かめられない**ので、
 * 商談前の通し確認（RUNBOOK 7 章）の代わりにはならない。
 *
 * 使い方:
 *   HARNESS_ARN=... ACCESS_TOKEN=... npx tsx scripts/probe-roundtrip.ts <slug> "質問"
 *
 * アクセストークンは、パスワード認証から取れる（管理 API 経由）。
 *   aws cognito-idp admin-initiate-auth --region ap-northeast-1 \
 *     --user-pool-id <UserPoolId> --client-id <ClientId> \
 *     --auth-flow ADMIN_USER_PASSWORD_AUTH \
 *     --auth-parameters USERNAME=<user>,PASSWORD=<pass> \
 *     --query 'AuthenticationResult.AccessToken' --output text
 */
import { createFrameDecoder } from '../web/src/agent/eventstream.js';
import { parseFrame, type StreamEvent } from '../web/src/agent/streamParser.js';
import { pickDemo } from '../demos/index.js';

/** kind で絞り込む。filter だけでは型が狭まらない。 */
function only<K extends StreamEvent['kind']>(
  events: readonly StreamEvent[],
  kind: K,
): Extract<StreamEvent, { kind: K }>[] {
  return events.filter((e): e is Extract<StreamEvent, { kind: K }> => e.kind === kind);
}


const harnessArn = requireEnv('HARNESS_ARN');
const accessToken = requireEnv('ACCESS_TOKEN');
const [slug, prompt = 'こんにちは'] = process.argv.slice(2);
if (!slug) throw new Error('使い方: npx tsx scripts/probe-roundtrip.ts <slug> "質問"');

const { tools } = pickDemo(slug);
const url =
  'https://bedrock-agentcore.ap-northeast-1.amazonaws.com/harnesses/invoke' +
  `?harnessArn=${encodeURIComponent(harnessArn)}`;
// runtimeSessionId は英数字のみ 33〜100 文字（実測。aws-facts.md 参照）
const session = 'probe' + '0'.repeat(28) + Date.now().toString().slice(-5);

async function turn(messages: unknown[]): Promise<StreamEvent[]> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ runtimeSessionId: session, messages }),
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const decoder = createFrameDecoder();
  const reader = res.body.getReader();
  const events: StreamEvent[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const frame of decoder.push(value)) {
      const parsed = parseFrame(frame);
      if (parsed) events.push(parsed);
    }
  }
  return events;
}

function textOf(events: StreamEvent[]): string {
  return only(events, 'text').map((e) => e.text).join('');
}

const messages: unknown[] = [{ role: 'user', content: [{ text: prompt }] }];

// 画面の toolLoop と同じ上限。超えたら止める（言い換えを重ねて回り続けるのを防ぐ）
const MAX_ROUNDS = 6;
for (let round = 1; round <= MAX_ROUNDS; round++) {
  const events = await turn(messages);

  const failure = only(events, 'error')[0];
  if (failure) throw new Error(failure.message);

  const text = textOf(events);
  const stop = only(events, 'stop')[0];
  const use = only(events, 'toolUse')[0];
  console.log(`--- ${round} 周目（終了理由: ${stop?.reason ?? '無し'}）---`);
  if (text) console.log(text);

  if (!use) {
    if (round === 1) {
      // ツールを呼ばずに答えたなら、そのモデルはこの案件の指示文に従っていない
      console.log('**1 周目でツールを呼ばなかった。**');
      process.exit(1);
    }
    break;
  }

  const input = only(events, 'toolUseInput')
    .filter((e) => e.contentBlockIndex === use.contentBlockIndex)
    .map((e) => e.input)
    .join('');
  console.log(`[${use.name}] ${input}`);

  const parsedInput: unknown = JSON.parse(input);
  const result = tools[use.name]?.(parsedInput as never);
  if (result === undefined) throw new Error(`案件 ${slug} に ${use.name} の実装がありません`);

  messages.push(
    { role: 'assistant', content: [{ toolUse: { toolUseId: use.toolUseId, name: use.name, input: parsedInput } }] },
    {
      role: 'user',
      content: [{ toolResult: { toolUseId: use.toolUseId, content: [{ text: result }], status: 'success' } }],
    },
  );

  if (round === MAX_ROUNDS) console.log(`**${MAX_ROUNDS} 周しても終わらなかった。**`);
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`環境変数 ${name} が必要です`);
  return v;
}
