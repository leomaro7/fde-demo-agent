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
 * 在庫・発注・点検予定は、この記録に一切含まれていない話題。
 *
 * **指示文の「検索するな」だけには頼らない。** 語を 1 語に減らして再検索した結果
 * 無関係な記録（例: 交換周期の記述がある記録）が引けてしまうと、それらしい根拠を
 * 付けて誤った話題に答えてしまう。ここでキーワードの時点で遮断し、検索させない。
 */
/**
 * 判定は空白区切りのトークンではなく生の keyword に対する部分一致で行う。
 * 「点検 予定」のように語がスペースで分かれて渡されても、'点検' という 1 語の
 * 部分一致で拾える。seed に「点検」を含む記録が 1 件も無いことは
 * tools.test.ts で確認済みなので、答えられる質問を誤って塞ぐことはない。
 */
const OUT_OF_SCOPE: ReadonlyArray<{ readonly terms: readonly string[]; readonly text: string }> = [
  {
    terms: ['在庫', '発注', '納期', '入荷', '調達'],
    text:
      'この記録には過去のトラブル対応の内容しか入っておらず、部品の在庫・発注・納期は含まれていません。' +
      '検索し直さないでください。「部品の在庫は、このシステムでは分かりません。」と伝え、資材課に確認するよう案内してください。',
  },
  {
    terms: ['点検'],
    text:
      'この記録には過去のトラブル対応の内容しか入っておらず、点検の予定は含まれていません。' +
      '検索し直さないでください。「点検の予定は、このシステムでは分かりません。」と伝え、保全課の点検計画表を確認するよう案内してください。',
  },
];

/**
 * 過去のトラブル対応記録を引く。
 *
 * 在庫・発注・点検予定はこの記録に含まれない。指示文でも探させないが、
 * seed 側にもその手のフィールドを一切持たせていないため、二重に塞いである。
 * さらにキーワードの時点でも遮断する（上の OUT_OF_SCOPE）。三重に塞いである。
 *
 * 戻り値は必ず文字列。toolResult.content は text しか受け付けず、
 * json を渡すと unsupported type で拒否される（実測。aws-facts.md 参照）。
 */
export function searchMaintenanceRecords(input: KeywordQuery): string {
  const blocked = OUT_OF_SCOPE.find((s) => s.terms.some((t) => input.keyword.includes(t)));
  if (blocked) return blocked.text;

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
      `語を 1 語だけに減らして、あと 1 回だけ試してください（例: E-42 / ベルト / ずれ）。` +
      `それでも見つからなければ、検索をやめて指示どおりに答えてください。` +
      `なお在庫・発注・点検予定の話題なら、語を変えて探し直さず、指示どおりの宛先を案内してください。`
    );
  }
  return hits
    .map((r) => {
      const code = r.errorCode ? ` / ${r.errorCode}` : '';
      const route = r.handledBy === '設備メーカー' ? `対応: 設備メーカー（保全課では対応していない）` : `対応: 保全課`;
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
