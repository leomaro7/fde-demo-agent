/**
 * InvokeHarness を叩いて、生イベントと解釈結果の両方を出す。
 *
 * 設計書 5 章の未確認 1（ストリーム形状）を潰すためのもの。
 * 型定義と公式実装からの推定が実際と合っているかを確かめる。
 *
 * 仕様が変わったとき同じ確認を最短で回せるよう、確認後も残す。
 *
 * 使い方:
 *   HARNESS_ARN=... ACCESS_TOKEN=... npx tsx scripts/probe-harness.ts "出張の精算は"
 */
import { createFrameDecoder } from '../web/src/agent/eventstream.js';
import { parseFrame } from '../web/src/agent/streamParser.js';

const harnessArn = requireEnv('HARNESS_ARN');
const accessToken = requireEnv('ACCESS_TOKEN');
const region = 'ap-northeast-1';
const prompt = process.argv[2] ?? 'こんにちは';

// runtimeSessionId は英数字のみ 33〜100 文字（実測。aws-facts.md 参照）
const sessionId = 'probe' + '0'.repeat(28) + Date.now().toString().slice(-5);

const url =
  `https://bedrock-agentcore.${region}.amazonaws.com/harnesses/invoke` +
  `?harnessArn=${encodeURIComponent(harnessArn)}`;

const res = await fetch(url, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    runtimeSessionId: sessionId,
    messages: [{ role: 'user', content: [{ text: prompt }] }],
  }),
});

console.log('status:', res.status, res.statusText);
console.log('content-type:', res.headers.get('content-type'));
if (!res.ok || !res.body) {
  console.log('body:', await res.text());
  process.exit(1);
}

const decoder = createFrameDecoder();
const reader = res.body.getReader();
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  for (const frame of decoder.push(value)) {
    console.log('--- frame ---');
    console.log('headers:', frame.headers);
    console.log('payload:', new TextDecoder().decode(frame.payload));
    console.log('parsed :', parseFrame(frame));
  }
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`環境変数 ${name} が必要です`);
  return v;
}
