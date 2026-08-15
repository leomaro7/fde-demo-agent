/**
 * 案件で選べるモデル。
 *
 * **`demo.ts` に ID を直書きしない。** 長い不透明な文字列で、打ち間違えても
 * `cdk deploy` は通り、**Harness の作成が非同期に失敗する**（実測。aws-facts.md）。
 * 気づくのは数分後になる。
 *
 * ここに無いモデルを使いたくなったら、**推論プロファイルを引いてから足す**。
 * 素の ID（`anthropic.claude-sonnet-5`）ではなくプロファイル ID を書くこと。
 * 3 つとも `inferenceTypesSupported` が `INFERENCE_PROFILE` だけで、素の ID は通らない。
 *
 *   aws bedrock list-inference-profiles --region ap-northeast-1 \
 *     --query "inferenceProfileSummaries[].[inferenceProfileId,status]" --output text
 *
 * **`jp.` があるモデルと無いモデルがある。規則性は無い**（2026-08-15 実測）。
 * `global.` は推論の経路が日本国内に限定されない。ダミーデータしか扱わないので
 * 支障は無いが、商談で聞かれることがある。
 */
export const MODELS = {
  /** 既定。 */
  sonnet5: 'global.anthropic.claude-sonnet-5',

  /** ストリームの形は Claude と同一であることを実測済み（2026-08-15）。 */
  gpt56terra: 'global.openai.gpt-5.6-terra',

  /**
   * **ツールを 1 往復するところまで実測済み**（2026-08-15）。
   * 3 つの中で唯一 `jp.` があり、推論が日本国内に閉じる。
   * データの所在をクライアントに聞かれる案件では、ここが効くことがある。
   */
  nova2lite: 'jp.amazon.nova-2-lite-v1:0',

  /** `jp.` で動く Claude の中では最新。実測で通っている（2026-08-15）。 */
  sonnet46: 'jp.anthropic.claude-sonnet-4-6',
} as const;

export type ModelId = (typeof MODELS)[keyof typeof MODELS];

/**
 * **モデルを変えたら、必ず動かして確かめる。**
 *
 * 使えるかどうかは ID の正しさだけでは決まらない。**アカウントが規約に同意して
 * いないモデルは `AccessDeniedException` になる**（実測。2026-08-15 の時点で
 * このアカウントは Sonnet 5 と GPT-5.6 Terra が未同意だった）。
 * 同意はマーケットプレイスの契約なので、画面から人が行う。
 *
 * 先に確かめる（`AVAILABLE` なら通る。ID は**プロファイルではなく素のほう**）:
 *
 *   aws bedrock get-foundation-model-availability --region ap-northeast-1 \
 *     --model-id anthropic.claude-sonnet-5 \
 *     --query 'agreementAvailability.status' --output text
 *
 * そのうえで 1 往復させる（ブラウザを開かずに済む）:
 *
 *   npx tsx scripts/probe-roundtrip.ts <slug> "質問"
 */
