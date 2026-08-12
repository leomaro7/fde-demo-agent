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

  it('仕込んだ傾向がデータに入っている（郊外型の下期が前年割れ）', () => {
    // この案件の山場。データが平坦だとエージェントに発見させるものが無くなる
    const rows = getSales({ type: '郊外型' }).trim().split('\n').slice(1);
    const h2 = rows.filter((r) => Number(r.split(',')[2].slice(5)) >= 7);
    const sales = h2.reduce((a, r) => a + Number(r.split(',')[3]), 0);
    const prev = h2.reduce((a, r) => a + Number(r.split(',')[4]), 0);
    expect(sales / prev).toBeLessThan(0.92);
  });

  it('都心型は前年を上回っている（郊外型だけが落ちていると分かる形）', () => {
    const rows = getSales({ type: '都心型' }).trim().split('\n').slice(1);
    const sales = rows.reduce((a, r) => a + Number(r.split(',')[3]), 0);
    const prev = rows.reduce((a, r) => a + Number(r.split(',')[4]), 0);
    expect(sales / prev).toBeGreaterThan(1.0);
  });
});
