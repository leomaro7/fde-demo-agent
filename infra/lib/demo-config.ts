import type { HarnessToolSpec } from './harness.js';

export interface DemoConfig {
  /** URL とリソース名に使う。英数字とハイフン。 */
  readonly slug: string;
  /** 画面に出すクライアント名。 */
  readonly clientName: string;
  readonly brand: { readonly primary: string };
  readonly harness: {
    readonly modelId: string;
    /**
     * 必ず 4 点を含める（要件書 4.2）。
     * 1. 調べる順序  2. 根拠の示し方  3. 答えてはいけない条件
     * 4. 探すのをやめる条件（何回で諦め、何と答えるか）
     *
     * 4 が抜けると、エージェントは語を変えて検索し続け、ツール呼び出しの上限に
     * 達して「答えを拒む場面」に到達しない。実際に踏んだ（DECISIONS 2026-08-12）。
     */
    readonly systemPrompt: string;
    readonly tools: readonly HarnessToolSpec[];
  };
  /** 商談で見せる 3 問。3 つ目は「答えられない質問」を置く（要件書 4.2）。 */
  readonly examples: readonly [string, string, string];
}
