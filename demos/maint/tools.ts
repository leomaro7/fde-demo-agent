import records from './seed/records.json' with { type: 'json' };
import type { ToolRegistry } from '../../web/src/agent/toolLoop.js';

export interface KeywordQuery {
  readonly keyword: string;
}

/**
 * 検索語を空白で割り、**すべての語**を含むものだけを返す。
 *
 * OR にしてはいけない。無関係な記録が引っかかり、答えられない質問に
 * それらしい根拠を付けて答えてしまう。これが最も避けたい失敗である
 * （2026-08-12 に踏んだ。new-demo スキル参照）。
 */
function matchesAll(haystack: string, keyword: string): boolean {
  const terms = keyword.split(/[\s　]+/).filter(Boolean);
  return terms.length > 0 && terms.every((t) => haystack.includes(t));
}

/**
 * 過去のトラブル対応記録を引く。
 *
 * **品質保証部へ引き継いだ記録は、その旨が読める形で返す。**
 * この案件が拒めるかは、ここが読めるかにかかっている。
 *
 * 引き継いだ記録には**復旧手順そのものを書いていない**（seed 側）。
 * 指示文が破られても、答える材料が存在しない。二重に塞いである。
 *
 * 戻り値は必ず文字列。toolResult.content は text しか受け付けず、
 * json を渡すと unsupported type で拒否される（実測。aws-facts.md 参照）。
 */
export function searchMaintenanceRecords(input: KeywordQuery): string {
  const hits = records.filter((r) =>
    matchesAll(
      `${r.id} ${r.equipment} ${r.equipmentId} ${r.plant} ${r.errorCode} ${r.symptom} ${r.cause} ${r.action} ${r.note}`,
      input.keyword,
    ),
  );
  if (hits.length === 0) {
    // 次の一手をここに書く。指示文より落ちにくく、検索回数を増やさずに軌道修正できる。
    // 助詞や動詞を含む語（「エラーコード E-42」など）は AND で空振りし、
    // 2 回の上限を使い切って、答えられるはずの質問が拒否になる
    return (
      `「${input.keyword}」に該当する対応記録は見つかりませんでした。` +
      `語を 1 語だけに減らして、あと 1 回だけ試してください（例: E-42 / ベルト / 破片）。` +
      `それでも見つからなければ、検索をやめて指示どおりに答えてください。`
    );
  }
  return hits
    .map((r) => {
      const code = r.errorCode ? ` / ${r.errorCode}` : '';
      const route = r.qualityHold
        ? `対応: ${r.handledBy}へ引き継ぎ（異物混入の可能性あり。保全課では復旧していない）`
        : `対応: ${r.handledBy}`;
      return [
        `【${r.id}】${r.equipment} ${r.equipmentId} / ${r.plant}${code}`,
        `症状: ${r.symptom}`,
        `原因: ${r.cause}`,
        `処置: ${r.action}`,
        route,
        `補足: ${r.note}`,
      ].join('\n');
    })
    .join('\n\n');
}

/** demo.ts の tools 宣言と名前を合わせること。ここが食い違うとツールが呼ばれない。 */
export const tools: ToolRegistry = {
  search_maintenance_records: (input) => searchMaintenanceRecords(input as KeywordQuery),
};
