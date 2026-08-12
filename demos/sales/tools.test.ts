import { describe, it, expect } from 'vitest';
import { getSales } from './tools.js';

describe('getSales', () => {
  it('指定がなければ全件を返す（分析型は絞らずに全部渡す）', () => {
    const csv = getSales({});
    // ヘッダ 1 行 + 12 店舗 × 12 か月
    expect(csv.trim().split('\n')).toHaveLength(1 + 144);
  });

  it('CSV のヘッダに分析に要る列が揃っている', () => {
    expect(getSales({}).split('\n')[0]).toBe('store,type,month,sales,salesPrevYear');
  });

  it('店舗タイプで絞れる', () => {
    const csv = getSales({ type: '郊外型' });
    expect(csv.trim().split('\n')).toHaveLength(1 + 4 * 12);
    expect(csv).not.toContain('都心型');
  });

  it('店舗名で絞れる', () => {
    const csv = getSales({ store: 'つくば店' });
    expect(csv.trim().split('\n')).toHaveLength(1 + 12);
  });

  it('該当しない指定なら、見つからなかったと返す', () => {
    expect(getSales({ store: 'そんな店はない' })).toContain('見つかりませんでした');
  });

  it('文字列を返す（toolResult.content は text しか受け付けないため）', () => {
    expect(typeof getSales({})).toBe('string');
  });

  /** CSV の行から下期だけを取り出して前年比を出す。 */
  function h2Ratio(csv: string): number {
    const rows = csv.trim().split('\n').slice(1).filter((r) => Number(r.split(',')[2].slice(5)) >= 7);
    const sales = rows.reduce((a, r) => a + Number(r.split(',')[3]), 0);
    const prev = rows.reduce((a, r) => a + Number(r.split(',')[4]), 0);
    return sales / prev;
  }

  it('仕込んだ傾向がデータに入っている（郊外型の下期が前年割れ）', () => {
    // この案件の山場。データが平坦だとエージェントに発見させるものが無くなる
    expect(h2Ratio(getSales({ type: '郊外型' }))).toBeLessThan(0.92);
  });

  it('前橋店だけ下期を持ちこたえている（二段目の発見）', () => {
    // 「郊外型が全部だめ」ではなく「4 店のうち 3 店」。商談で 2 段目の発見になる
    expect(h2Ratio(getSales({ store: '前橋店' }))).toBeGreaterThan(0.94);
    for (const store of ['つくば店', '郡山店', '甲府店']) {
      expect(h2Ratio(getSales({ store }))).toBeLessThan(0.88);
    }
  });

  it('同じタイプでも店舗ごとに数字がばらついている（作ったデータに見えないこと）', () => {
    // 前年比が小数第 1 位まで全店一致していると「これ作ったデータですよね」で
    // 説得力が飛ぶ。ばらつきがあることをテストで固定する
    const ratios = ['銀座店', '新宿店', '渋谷店', '池袋店'].map((store) =>
      Number(h2Ratio(getSales({ store })).toFixed(3)),
    );
    expect(new Set(ratios).size).toBe(ratios.length);
  });

  it('過去の確定値である（未来の月に実績が入っていない）', () => {
    // 8 月の商談で 12 月の実績が出てくると「もう出ているんですか」で話が止まる
    const months = getSales({}).trim().split('\n').slice(1).map((r) => r.split(',')[2]);
    expect(new Set(months).size).toBe(12);
    expect([...new Set(months)].every((m) => m.startsWith('2025-'))).toBe(true);
  });

  it('部分一致で引ける（語尾を落とした指定でも 0 件にならない）', () => {
    expect(getSales({ type: '郊外' }).trim().split('\n')).toHaveLength(1 + 4 * 12);
    expect(getSales({ store: 'つくば' }).trim().split('\n')).toHaveLength(1 + 12);
  });

  it('都心型は前年を上回っている（郊外型だけが落ちていると分かる形）', () => {
    const rows = getSales({ type: '都心型' }).trim().split('\n').slice(1);
    const sales = rows.reduce((a, r) => a + Number(r.split(',')[3]), 0);
    const prev = rows.reduce((a, r) => a + Number(r.split(',')[4]), 0);
    expect(sales / prev).toBeGreaterThan(1.0);
  });
});
