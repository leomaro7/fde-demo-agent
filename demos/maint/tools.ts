import records from './seed/records.json' with { type: 'json' };
import type { ToolRegistry } from '../../web/src/agent/toolLoop.js';

export interface KeywordQuery {
  readonly keyword: string;
}

/**
 * 検索語を空白で割り、**すべての語**を含むものだけを返す。
 *
 * OR にしてはいけない。無関係な記録が引っかかり、答えられない質問に
 * それらしい根拠を付けて答えてしまう（new-demo スキル参照）。
 */
function matchesAll(haystack: string, keyword: string): boolean {
  const terms = keyword.split(/[\s　]+/).filter(Boolean);
  return terms.length > 0 && terms.every((t) => haystack.includes(t));
}

/**
 * 設備トラブル対応記録をキーワードで引く。
 *
 * 部品の在庫・発注・納期・点検予定日はこの記録に一切含めていない。
 * 探しても見つからないので、空振りメッセージにその旨を書いて
 * 無駄な検索を減らす。
 *
 * 戻り値は必ず文字列。toolResult.content は text しか受け付けない
 * （実測。aws-facts.md 参照）。
 */
export function searchMaintenanceRecords(input: KeywordQuery): string {
  const hits = records.filter((r) =>
    matchesAll(`${r.id} ${r.equipment} ${r.errorCode} ${r.symptom} ${r.cause} ${r.action}`, input.keyword),
  );
  if (hits.length === 0) {
    return (
      `「${input.keyword}」に該当するトラブル対応記録は見つかりませんでした。\n` +
      `語を1語だけに減らして、あと1回だけ試してください（例: E-42 / ベルト / 充填機 / テンションローラー）。\n` +
      `部品の在庫・発注・納期はこの記録には含まれません（資材課に確認）。` +
      `点検予定日もこの記録には含まれません（保全課に確認）。検索しても見つかりません。` +
      `それでも見つからなければ、検索をやめて指示どおりに答えてください。`
    );
  }
  return hits
    .map((r) => {
      const head = `【${r.id}】${r.equipment}（発生日: ${r.occurredOn}${r.errorCode ? `, エラーコード: ${r.errorCode}` : ''}）`;
      const route = r.escalated
        ? `対応: 二次エスカレーション（回付先: ${r.escalatedTo}）`
        : '対応: 一次で対応';
      const causeAndAction = r.escalated
        ? `原因: ${r.cause}`
        : `原因: ${r.cause}\n対処法: ${r.action}`;
      return (
        `${head}\n症状: ${r.symptom}\n${causeAndAction}\n${route}\n` +
        `対応時間: ${r.durationMinutes}分 / ライン停止時間: ${r.lineStopMinutes}分`
      );
    })
    .join('\n\n');
}

/** demo.ts の tools 宣言と名前を合わせること。ここが食い違うとツールが呼ばれない。 */
export const tools: ToolRegistry = {
  search_maintenance_records: (input) => searchMaintenanceRecords(input as KeywordQuery),
};
