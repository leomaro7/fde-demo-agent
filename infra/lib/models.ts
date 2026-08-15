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
  /**
   * 既定。**通しで動かして確かめてあるのはこれだけ。**
   *
   * このデモはツール呼び出し（return-of-control）に依存しており、
   * `web/src/agent/streamParser.ts` は Claude のストリームを実測して作ってある。
   */
  sonnet5: 'global.anthropic.claude-sonnet-5',

  /** **未検証。** ツール呼び出しのイベント形状が同じかを確かめていない。 */
  gpt56terra: 'global.openai.gpt-5.6-terra',

  /**
   * **未検証。** 3 つの中で唯一 `jp.` があり、推論が日本国内に閉じる。
   * データの所在をクライアントに聞かれる案件では、ここが効くことがある。
   */
  nova2lite: 'jp.amazon.nova-2-lite-v1:0',
} as const;

export type ModelId = (typeof MODELS)[keyof typeof MODELS];
