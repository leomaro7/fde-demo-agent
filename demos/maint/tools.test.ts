import { describe, it, expect } from 'vitest';
import { searchMaintenanceRecords } from './tools.js';

describe('searchMaintenanceRecords', () => {
  it('記録番号つきで返す', () => {
    const out = searchMaintenanceRecords({ keyword: 'E-42' });
    expect(out).toContain('M-2023-0412');
    expect(out).toContain('M-2024-0137');
  });

  it('空白区切りの複数語は、すべて含む記録だけを返す', () => {
    // OR にすると無関係な記録が根拠として引かれ、答えられない質問に答えてしまう
    expect(searchMaintenanceRecords({ keyword: '充填機 E-42' })).toContain('M-2023-0412');
    expect(searchMaintenanceRecords({ keyword: '充填機 E-09' })).not.toContain('M-2023-0412');
  });

  it('見つからないときは次の一手つきでそう返す', () => {
    const out = searchMaintenanceRecords({ keyword: '宇宙旅行' });
    expect(out).toContain('見つかりませんでした');
    expect(out).toContain('あと 1 回');
    expect(out).toContain('在庫・発注・点検予定');
  });

  it('文字列を返す（toolResult.content は text しか受け付けないため）', () => {
    expect(typeof searchMaintenanceRecords({ keyword: 'E-42' })).toBe('string');
  });

  it('対応部署が読める形で返る（設備メーカー案件の見分け方の根拠）', () => {
    const out = searchMaintenanceRecords({ keyword: '冷却機 冷媒' });
    expect(out).toContain('M-2024-0815');
    expect(out).toContain('対応: 設備メーカー');
  });
});

describe('意図的な空白（在庫・点検・発注はこの記録に無い）', () => {
  // ここが引けてしまうと、答えを拒む場面（このデモの山場）が消える。
  // OUT_OF_SCOPE がキーワードの時点で遮断するので、通常の「見つかりませんでした」
  // ではなく、宛先つきの案内文が返る（語を変えた再検索で無関係な記録を
  // 引いてしまう事故を防ぐため。demo-quality の指摘）。
  it('在庫は検索させず、資材課への案内を返す', () => {
    const out = searchMaintenanceRecords({ keyword: '在庫' });
    expect(out).not.toContain('見つかりませんでした');
    expect(out).toContain('分かりません');
    expect(out).toContain('資材課');
  });

  it('部品 在庫 のように他語と組み合わせても遮断される（記録が混ざらない）', () => {
    const out = searchMaintenanceRecords({ keyword: '充填ポンプ 部品 在庫' });
    expect(out).toContain('資材課');
    expect(out).not.toContain('M-'); // どの記録番号も出てこない
  });

  it('点検（点検予定・点検 予定 のような空白入りでも）は保全課の点検計画表への案内を返す', () => {
    expect(searchMaintenanceRecords({ keyword: '点検' })).toContain('保全課の点検計画表');
    expect(searchMaintenanceRecords({ keyword: '点検 予定' })).toContain('保全課の点検計画表');
    expect(searchMaintenanceRecords({ keyword: '次回点検' })).toContain('保全課の点検計画表');
  });

  it('発注は検索させず、資材課への案内を返す', () => {
    expect(searchMaintenanceRecords({ keyword: '発注' })).toContain('資材課');
  });
});

describe('拒む条件を過剰適用しない（在庫・点検以外の質問は普通に答えられる）', () => {
  it('充填機まわりの質問は在庫語を含まなければ普通に引ける', () => {
    const out = searchMaintenanceRecords({ keyword: '充填機 トルク' });
    expect(out).toContain('M-2024-0308');
  });

  it('ラベラーやシーラーなど在庫と無関係な設備も引ける', () => {
    expect(searchMaintenanceRecords({ keyword: 'ラベラー 斜め' })).toContain('M-2025-0330');
    expect(searchMaintenanceRecords({ keyword: 'シーラー E-08' })).toContain('M-2024-1015');
  });
});

describe('エージェントが自然に打つ検索語で引けるか', () => {
  // demo-quality の指摘対象。質問文の語をそのまま渡されると AND で空振りし、
  // 呼び出し回数の上限（2 回）を使い切って、答えられるはずの質問が拒否になる

  it('1問目「充填機でE-42が出た。どうすればいい?」の自然な語で引ける', () => {
    expect(searchMaintenanceRecords({ keyword: 'E-42' })).toContain('M-2023-0412');
    expect(searchMaintenanceRecords({ keyword: '充填機 E-42' })).toContain('M-2023-0412');
    expect(searchMaintenanceRecords({ keyword: 'E42' })).toContain('見つかりませんでした'); // ハイフン抜けは空振りする前提
  });

  it('2問目「コンベアのベルトがずれる」の自然な語で、原因違いの複数件が引ける', () => {
    const byBelt = searchMaintenanceRecords({ keyword: 'ベルト ずれ' });
    expect(byBelt).toContain('M-2023-0905'); // 軸受摩耗（多数派・恒久対策）
    expect(byBelt).toContain('M-2024-0621'); // 軸受摩耗（再発・応急処置を4回繰り返した記録）
    expect(byBelt).toContain('M-2025-0208'); // シュート位置ずれ（別原因）
    expect(byBelt).toContain('90分');
    expect(byBelt).toContain('4回');
    expect(byBelt).toContain('約50分'); // 損失額計算に使う生の数字（結論は書かせない）

    const byConveyor = searchMaintenanceRecords({ keyword: 'コンベア ベルト' });
    expect(byConveyor).toContain('M-2023-0905');

    // 異音のみで「ずれ」を伴わない記録は、この語では混ざらない
    expect(byBelt).not.toContain('M-2023-1215');
  });

  it('3問目「充填ポンプの部品、まだ在庫ある?」は検索させず資材課へ回す（記録は混ざらない）', () => {
    const out = searchMaintenanceRecords({ keyword: '充填ポンプ 部品 在庫' });
    expect(out).toContain('資材課');
    expect(out).not.toContain('M-2024-0503'); // 交換周期に触れる無関係な記録が根拠にならないこと
  });
});
