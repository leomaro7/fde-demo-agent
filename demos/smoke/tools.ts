import items from './seed/items.json' with { type: 'json' };

/**
 * キーワードで seed を引く。
 *
 * 戻り値は必ず文字列。toolResult.content は text しか受け付けず、
 * json を渡すと unsupported type で拒否される（実測。aws-facts.md 参照）。
 */
export function search(input: { keyword: string }): string {
  const hits = items.filter(
    (item) => item.keyword.includes(input.keyword) || item.text.includes(input.keyword),
  );
  if (hits.length === 0) {
    return `「${input.keyword}」に該当する規程は見つかりませんでした。`;
  }
  return hits.map((h) => `[${h.id}] ${h.text}`).join('\n');
}
