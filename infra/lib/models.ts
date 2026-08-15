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
 * `global.` でも東京は経路に入るが、**東京に固定はされない**（リージョン指定なしの
 * ARN も並ぶ）。`jp.` は `ap-northeast-1` と `ap-northeast-3` だけ。
 * ダミーデータしか扱わないので支障は無いが、商談で聞かれることがある。
 */
export const MODELS = {
  /** 既定。**ツールを最後まで往復するところまで実測済み**（2026-08-15）。 */
  sonnet5: 'global.anthropic.claude-sonnet-5',

/**
   * **ツールを最後まで往復するところまで実測済み**（2026-08-15）。
   * 初回の呼び出しは `AccessDenied` になり、購読が済んだ後に通った。
   * `toolUse` に `type` が入らない点だけ Claude と違う。
   */
  gpt56terra: 'global.openai.gpt-5.6-terra',

  /**
   * **ツールを最後まで往復するところまで実測済み**（2026-08-15）。
   * `jp.` があり、経路が `ap-northeast-1` と `ap-northeast-3` に限られる。
   * データの所在をクライアントに聞かれる案件では、ここが効くことがある。
   */
  nova2lite: 'jp.amazon.nova-2-lite-v1:0',

  /** `jp.` で動く Claude の中では最新。実測で通っている（2026-08-15）。 */
  sonnet46: 'jp.anthropic.claude-sonnet-4-6',
} as const;

export type ModelId = (typeof MODELS)[keyof typeof MODELS];

/**
 * **モデルを変えたら、必ず動かして確かめる。ID を引いただけでは分からない。**
 *
 * 使えないときは `AccessDeniedException` になるが、**原因は 2 つあって文言は同じ**。
 * 実行ロールの権限不足か、アカウントにそのモデルの契約が無いか。
 * 切り分けと直し方は `aws-facts.md`（自分の資格情報で直接呼んでみる）。
 *
 * ブラウザを開かずに 1 往復させる:
 *
 *   npx tsx scripts/probe-roundtrip.ts <slug> "質問"
 */
