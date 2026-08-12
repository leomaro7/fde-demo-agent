import items from './seed/items.json' with { type: 'json' };
import type { ToolRegistry } from '../../web/src/agent/toolLoop.js';

/**
 * キーワードで seed を引く。
 *
 * 戻り値は必ず文字列。toolResult.content は text しか受け付けず、
 * json を渡すと unsupported type で拒否される（実測。aws-facts.md 参照）。
 */
export function search(input: { keyword: string }): string {
  // 半角・全角スペースの両方で区切り、空語は捨てる。
  const words = input.keyword.split(/[ 　]+/).filter((w) => w.length > 0);

  // 語が 1 つも無い（空文字・空白のみ）場合は該当なし扱いにする。
  // すべての語を含む項目だけを返す（AND）。OR にすると「精算」のような
  // 汎用語 1 語だけで無関係な項目（A-001 など）が誤ってヒットしてしまう。
  const hits =
    words.length === 0
      ? []
      : items.filter((item) =>
          words.every((w) => item.keyword.includes(w) || item.text.includes(w)),
        );
  if (hits.length === 0) {
    return `「${input.keyword}」に該当する規程は見つかりませんでした。`;
  }
  return hits.map((h) => `[${h.id}] ${h.text}`).join('\n');
}

/** demo.ts の tools 宣言と名前を合わせること。ここが食い違うとツールが呼ばれない。 */
export const tools: ToolRegistry = { search: (input) => search(input as { keyword: string }) };
