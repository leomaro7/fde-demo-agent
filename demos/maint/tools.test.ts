import { describe, it, expect } from 'vitest';
import { searchMaintenanceRecords } from './tools.js';

describe('searchMaintenanceRecords', () => {
  // 1 問目: 「充填機で E-42 が出た。どうすればいい？」原因が 2 通りあり、見分けて答える。
  it('「E-42」で検索すると、一次対応 2 件と二次エスカレーション 1 件がすべて引ける', () => {
    const result = searchMaintenanceRecords({ keyword: 'E-42' });
    expect(result).toContain('M-2026-101');
    expect(result).toContain('M-2026-088');
    expect(result).toContain('M-2026-115');
  });

  it('「充填機 E-42」でも同じ 3 件が引ける（自然な言い換え）', () => {
    const result = searchMaintenanceRecords({ keyword: '充填機 E-42' });
    expect(result).toContain('M-2026-101');
    expect(result).toContain('M-2026-088');
  });

  it('E-42 の一次対応 2 件には、見分け方が両方とも読める形で出る', () => {
    const result = searchMaintenanceRecords({ keyword: 'E-42' });
    expect(result).toContain('ノズル周辺に白い粉状の付着物');
    expect(result).toContain('電源を入れ直すと一時的に復旧する場合');
  });

  it('E-42 の二次エスカレーション記録には対処法が書かれておらず、回付先が読める', () => {
    const result = searchMaintenanceRecords({ keyword: 'E-42' });
    expect(result).toContain('M-2026-115');
    expect(result).toContain('二次エスカレーション');
    expect(result).toContain('設備メーカー保守窓口');
  });

  // 2 問目: 「先月、コンベアのベルトずれで何回ラインが止まった？合計の停止時間は？」横断・集計。
  it('「コンベア ベルト」で検索すると、ベルトずれの記録が 4 件すべて引ける', () => {
    const result = searchMaintenanceRecords({ keyword: 'コンベア ベルト' });
    for (const id of ['M-2026-072', 'M-2026-093', 'M-2026-099', 'M-2026-104']) {
      expect(result).toContain(id);
    }
  });

  it('ベルトずれ 4 件のライン停止時間が読める（合計 265 分の元データ）', () => {
    const result = searchMaintenanceRecords({ keyword: 'コンベア ベルト' });
    expect(result).toContain('ライン停止時間: 30分');
    expect(result).toContain('ライン停止時間: 150分');
    expect(result).toContain('ライン停止時間: 40分');
    expect(result).toContain('ライン停止時間: 45分');
  });

  it('「ベルト」だけでも同じ 4 件が引ける（自然な言い換え）', () => {
    const result = searchMaintenanceRecords({ keyword: 'ベルト' });
    for (const id of ['M-2026-072', 'M-2026-093', 'M-2026-099', 'M-2026-104']) {
      expect(result).toContain(id);
    }
  });

  it('質問文そのままの「ベルトずれ」でも 4 件が引ける（質問文の語をそのまま渡す想定）', () => {
    const result = searchMaintenanceRecords({ keyword: 'ベルトずれ' });
    for (const id of ['M-2026-072', 'M-2026-093', 'M-2026-099', 'M-2026-104']) {
      expect(result).toContain(id);
    }
  });

  it('ベルトずれ 4 件は 3 拠点（関東第一・関東第二・東北）にまたがっている', () => {
    const result = searchMaintenanceRecords({ keyword: 'ベルトずれ' });
    expect(result).toContain('関東第一工場');
    expect(result).toContain('関東第二工場');
    expect(result).toContain('東北工場');
  });

  // 3 問目: 「〇〇の部品、まだ在庫ある？」拒否。在庫は別システムなので記録に存在しない。
  it('「在庫」で検索すると見つからず、部品在庫は含まれない旨が返る', () => {
    const result = searchMaintenanceRecords({ keyword: '在庫' });
    expect(result).toContain('見つかりませんでした');
    expect(result).toContain('部品の在庫・発注・納期');
  });

  it('部品名 + 「在庫」の組み合わせでも見つからない（ベルトは記録にある語だが在庫は無い）', () => {
    const result = searchMaintenanceRecords({ keyword: 'ベルト 在庫' });
    expect(result).toContain('見つかりませんでした');
  });

  it('「点検 予定」で検索しても見つからない（点検予定日は含まれない）', () => {
    const result = searchMaintenanceRecords({ keyword: '点検 予定' });
    expect(result).toContain('見つかりませんでした');
  });

  // 拒む条件を過剰適用しない: 一次対応の記録も普通に引ける
  it('「殺菌機」は一次対応の記録が引け、二次エスカレーションと書かれない', () => {
    const result = searchMaintenanceRecords({ keyword: '殺菌機' });
    expect(result).toContain('M-2026-061');
    expect(result).toContain('対応: 一次で対応');
    expect(result).not.toContain('二次エスカレーション');
  });

  it('「ラベラー」は 2 件とも一次対応で引ける', () => {
    const result = searchMaintenanceRecords({ keyword: 'ラベラー' });
    expect(result).toContain('M-2026-084');
    expect(result).toContain('M-2026-058');
    expect(result).not.toContain('二次エスカレーション');
  });

  // AND 検索（OR 誤りの検出）
  it('無関係な語の組み合わせでは空振りする（OR になっていないことの確認）', () => {
    const result = searchMaintenanceRecords({ keyword: 'コンベア 液面センサー' });
    expect(result).toContain('見つかりませんでした');
  });

  it('全角・半角スペース混在でも AND 検索できる', () => {
    const result = searchMaintenanceRecords({ keyword: 'コンベア　ベルト' });
    expect(result).toContain('M-2026-072');
  });

  it('文字列を返す（toolResult.content は text のみ受け付けるため）', () => {
    expect(typeof searchMaintenanceRecords({ keyword: 'E-42' })).toBe('string');
  });

  it('空白だけの検索語は見つからなかったと返す', () => {
    expect(searchMaintenanceRecords({ keyword: '   ' })).toContain('見つかりませんでした');
  });
});
