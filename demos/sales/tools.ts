import rows from './seed/sales.json' with { type: 'json' };
import type { ToolRegistry } from '../../web/src/agent/toolLoop.js';

export interface SalesQuery {
  /** 店舗名。省略時は絞らない。 */
  readonly store?: string;
  /** 店舗タイプ（都心型 / 郊外型）。省略時は絞らない。 */
  readonly type?: string;
}

const HEADER = 'store,type,month,sales,salesPrevYear';

/**
 * 売上データを CSV で返す。
 *
 * 分析型なので**指定がなければ絞らない**。エージェントが自分で切り口を決めて
 * Code Interpreter に渡せるよう、全件を素直に出す。
 *
 * 戻り値は必ず文字列。toolResult.content は text しか受け付けず、
 * json を渡すと unsupported type で拒否される（実測。aws-facts.md 参照）。
 */
export function getSales(input: SalesQuery): string {
  const hits = rows.filter(
    (r) => (!input.store || r.store === input.store) && (!input.type || r.type === input.type),
  );
  if (hits.length === 0) {
    const cond = [input.store, input.type].filter(Boolean).join(' / ');
    return `「${cond}」に該当する売上データは見つかりませんでした。`;
  }
  const lines = hits.map((r) => `${r.store},${r.type},${r.month},${r.sales},${r.salesPrevYear}`);
  return [HEADER, ...lines].join('\n');
}

/** demo.ts の tools 宣言と名前を合わせること。ここが食い違うとツールが呼ばれない。 */
export const tools: ToolRegistry = { get_sales: (input) => getSales(input as SalesQuery) };
