import { describe, it, expect } from 'vitest';
import { searchMaintenanceRecords as search } from './tools.js';

describe('searchMaintenanceRecords', () => {
  it('記録番号と設備 ID つきで返す', () => {
    const out = search({ keyword: 'E-42' });
    expect(out).toContain('【M-2023-0412】');
    expect(out).toContain('FL-3');
    expect(out).toContain('関東第一工場');
  });

  it('空白区切りの複数語は、すべて含む記録だけを返す', () => {
    // OR にすると無関係な記録が根拠として引かれ、答えられない質問に答えてしまう
    expect(search({ keyword: '充填機 E-42' })).toContain('M-2024-0137');
    expect(search({ keyword: 'コンベア E-42' })).toContain('見つかりませんでした');
  });

  it('見つからないときは、次の一手まで返す', () => {
    // 助詞や動詞を含む語は AND で空振りする。次の一手を書いておかないと、
    // 語を変えて 2 回の上限を使い切り、答えられるはずの質問が拒否になる
    const out = search({ keyword: 'エラーコード E-42' });
    expect(out).toContain('見つかりませんでした');
    expect(out).toContain('1 語だけに減らして');
  });

  it('文字列を返す（toolResult.content は text しか受け付けないため）', () => {
    expect(typeof search({ keyword: 'コンベア' })).toBe('string');
  });
});

describe('品質保証部へ引き継いだ記録の返り方', () => {
  it('引き継いだ記録は、その旨と理由が分かる形で返る', () => {
    // これがこの案件の山場。エージェントが「保全の判断範囲ではない」を
    // 根拠に拒めるかは、ここが読める形で返っているかにかかっている
    const out = search({ keyword: '破片' });
    expect(out).toContain('【M-2025-0714】');
    expect(out).toContain('品質保証部へ引き継ぎ');
    expect(out).toContain('異物混入の可能性あり');
  });

  it('引き継いだ記録には復旧手順が入っていない', () => {
    // seed 側の二重の塞ぎ。指示文が破られても、答える材料が存在しない
    const out = search({ keyword: 'M-2025-0714' });
    expect(out).toContain('保全課では復旧作業を行っていない');
    expect(out).toContain('ロットは隔離');
  });

  it('現場で対処した記録には引き継ぎの文言を出さない', () => {
    const out = search({ keyword: 'コンベア ベルト' });
    expect(out).not.toContain('品質保証部へ引き継ぎ');
    expect(out).toContain('対応: 保全課');
  });
});

describe('エージェントが自然に打つ検索語で引けるか', () => {
  // 質問文の語をそのまま渡されると AND で空振りし、呼び出し回数の上限（2 回）を
  // 使い切って、答えられるはずの質問が拒否になる（2026-08-12 に踏んだ）
  it('1 問目: 充填機 / E-42 のどの組み合わせでも当たる', () => {
    for (const keyword of ['E-42', '充填機 E-42', '充填機', 'E-42 充填']) {
      expect(search({ keyword })).toContain('M-2023-0412');
    }
  });

  it('2 問目: コンベア / ベルト / ずれ のどの組み合わせでも当たる', () => {
    for (const keyword of ['コンベア ベルト', 'ベルト ずれ', 'コンベア ずれ', 'ベルト']) {
      expect(search({ keyword })).toContain('M-2023-0905');
    }
  });

  it('3 問目: 包装機 / 異音 / 破片 のどの組み合わせでも当たる', () => {
    for (const keyword of ['包装機 異音', '破片', '包装機 破片', 'プラスチック 破片']) {
      expect(search({ keyword })).toContain('M-2025-0714');
    }
  });
});

describe('3 問と seed の突き合わせ', () => {
  it('1 問目「充填機の E-42」は原因が 2 つあり、見分け方まで書いてある', () => {
    const out = search({ keyword: '充填機 E-42' });
    expect(out).toContain('M-2023-0412'); // ノズル詰まり
    expect(out).toContain('M-2024-0137'); // 液面センサの汚れ
    expect(out).toContain('手動吐出');
  });

  it('2 問目「ベルトのずれ」は 3 拠点にまたがり、2 件が同じ原因', () => {
    const out = search({ keyword: 'ベルト ずれ' });
    for (const id of ['M-2023-0905', 'M-2024-0621', 'M-2025-0208']) {
      expect(out).toContain(id);
    }
    expect(out).toContain('関東第一工場');
    expect(out).toContain('東北工場');
    expect(out).toContain('関東第二工場');
    // 属人化していた知見が記録から出てくる。ここが商談の山場
    expect(out.match(/テールプーリの軸受/g)?.length).toBeGreaterThanOrEqual(2);
    // 停止時間が記録に入っている。部長の「1 時間あたり数十万円」に接続できる
    expect(out).toContain('4回');
    expect(out).toContain('50分');
    expect(out).toContain('90分');
  });

  it('3 問目「包装機の破片」は品質保証部へ引き継いだ記録が根拠になる', () => {
    const out = search({ keyword: '包装機 異音' });
    expect(out).toContain('M-2025-0714');
    expect(out).toContain('品質保証部へ引き継ぎ');
  });
});

describe('意図的な空白', () => {
  it('部品の在庫は記録に無い（在庫システムは別）', () => {
    for (const keyword of ['在庫', '発注', '納期']) {
      expect(search({ keyword })).toContain('見つかりませんでした');
    }
  });

  it('記録が無いのに拒むべき問いがある（商談のアドリブ用）', () => {
    // 「充填機のノズル部品が外れて見当たらない」は記録が引けない。
    // 記録が無い状態から、質問文の事実だけで拒めるかを見せる場面になる
    for (const keyword of ['ノズル 欠損', 'ねじ 欠損', '充填機 破片']) {
      expect(search({ keyword })).toContain('見つかりませんでした');
    }
  });

  it('異音だけでは拒む根拠にならない（現場で対処した記録もある）', () => {
    // 「異音」で一律に拒むと、答えられる質問まで品質保証部に回ってしまう
    const out = search({ keyword: '異音' });
    expect(out).toContain('M-2023-1215'); // 減速機のグリース切れ。保全課で対処
    expect(out).toContain('M-2025-0714'); // 破片あり。品質保証部へ
  });
});
