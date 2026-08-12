import regulations from './seed/regulations.json' with { type: 'json' };
import cases from './seed/cases.json' with { type: 'json' };
import type { ToolRegistry } from '../../web/src/agent/toolLoop.js';

export interface KeywordQuery {
  readonly keyword: string;
}

/**
 * 検索語を空白で割り、**すべての語**を含むものだけを返す。
 *
 * OR にしてはいけない。無関係な条文が引っかかり、答えられない質問に
 * それらしい根拠を付けて答えてしまう。これが最も避けたい失敗である
 * （2026-08-12 に踏んだ。new-demo スキル参照）。
 */
function matchesAll(haystack: string, keyword: string): boolean {
  const terms = keyword.split(/[\s　]+/).filter(Boolean);
  return terms.length > 0 && terms.every((t) => haystack.includes(t));
}

/**
 * 就業規則を引く。
 *
 * 戻り値は必ず文字列。toolResult.content は text しか受け付けず、
 * json を渡すと unsupported type で拒否される（実測。aws-facts.md 参照）。
 */
export function searchRegulations(input: KeywordQuery): string {
  const hits = regulations.filter((r) =>
    matchesAll(`${r.article} ${r.title} ${r.text}`, input.keyword),
  );
  if (hits.length === 0) {
    return `「${input.keyword}」に該当する規程は見つかりませんでした。`;
  }
  return hits.map((r) => `${r.article}（${r.title}）\n${r.text}`).join('\n\n');
}

/**
 * 過去の問い合わせ事例を引く。
 *
 * **二次へ回した事例は、その旨と回付先が読める形で返す。**
 * エージェントが「過去に同種が二次へ行っている」を根拠に拒めるかは、
 * ここが読めるかにかかっている。この案件の山場。
 */
export function searchPastCases(input: KeywordQuery): string {
  const hits = cases.filter((c) =>
    matchesAll(`${c.id} ${c.question} ${c.answer} ${c.routedTo}`, input.keyword),
  );
  if (hits.length === 0) {
    return `「${input.keyword}」に該当する過去事例は見つかりませんでした。`;
  }
  return hits
    .map((c) => {
      const head = `【${c.id}】${c.question}`;
      const route = c.escalated
        ? `\n対応: 二次エスカレーション（回付先: ${c.routedTo}）`
        : '\n対応: 一次で回答';
      return `${head}${route}\n${c.answer}`;
    })
    .join('\n\n');
}

/** demo.ts の tools 宣言と名前を合わせること。ここが食い違うとツールが呼ばれない。 */
export const tools: ToolRegistry = {
  search_regulations: (input) => searchRegulations(input as KeywordQuery),
  search_past_cases: (input) => searchPastCases(input as KeywordQuery),
};
