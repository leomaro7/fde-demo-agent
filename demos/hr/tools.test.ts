import { describe, it, expect } from 'vitest';
import { searchRegulations, searchPastCases } from './tools.js';

describe('searchRegulations', () => {
  it('条文を条番号つきで返す', () => {
    const out = searchRegulations({ keyword: '慶弔' });
    expect(out).toContain('就業規則 第12条');
    expect(out).toContain('勤続6か月以上');
  });

  it('空白区切りの複数語は、すべて含む条文だけを返す', () => {
    // OR にすると無関係な条文が根拠として引かれ、答えられない質問に答えてしまう
    expect(searchRegulations({ keyword: '在宅 介護' })).toContain('第18条');
    expect(searchRegulations({ keyword: '在宅 資格' })).toContain('見つかりませんでした');
  });

  it('見つからないときはそう返す', () => {
    expect(searchRegulations({ keyword: '宇宙旅行' })).toContain('見つかりませんでした');
  });

  it('文字列を返す（toolResult.content は text しか受け付けないため）', () => {
    expect(typeof searchRegulations({ keyword: '休暇' })).toBe('string');
  });
});

describe('searchPastCases', () => {
  it('事例番号つきで返す', () => {
    expect(searchPastCases({ keyword: '慶弔' })).toContain('CASE-2025-0203');
  });

  it('二次へ回した事例は、その旨と回付先が分かる形で返る', () => {
    // これがこのデモの山場。エージェントが「過去に同種が二次へ行っている」を
    // 根拠に拒めるかは、ここが読める形で返っているかにかかっている
    const out = searchPastCases({ keyword: '競合 貸与' });
    expect(out).toContain('CASE-2025-0731');
    expect(out).toContain('二次エスカレーション');
    expect(out).toContain('法務部および情報システム部');
  });

  it('一次で解決した事例には回付先を出さない', () => {
    const out = searchPastCases({ keyword: '介護 在宅' });
    expect(out).toContain('CASE-2025-0518');
    expect(out).not.toContain('二次エスカレーション');
  });

  it('見つからないときはそう返す', () => {
    expect(searchPastCases({ keyword: '宇宙旅行' })).toContain('見つかりませんでした');
  });
});

describe('エージェントが自然に打つ検索語で引けるか', () => {
  // demo-quality の指摘。質問文の語をそのまま渡されると AND で空振りし、
  // 呼び出し回数の上限（2 回）を使い切って、答えられるはずの質問が拒否になる
  it('1 問目: 「入社」を含む語でも第12条に当たる', () => {
    expect(searchRegulations({ keyword: '入社 慶弔休暇' })).toContain('第12条');
    expect(searchRegulations({ keyword: '慶弔休暇' })).toContain('第12条');
  });

  it('2 問目: 「週3日」を含む語でも第18条に当たる', () => {
    expect(searchRegulations({ keyword: '在宅勤務 週3日' })).toContain('第18条');
    expect(searchRegulations({ keyword: '介護 在宅勤務' })).toContain('第18条');
  });

  it('3 問目: 退職・貸与・競合のどの語からでも二次の事例に当たる', () => {
    for (const keyword of ['退職 競合他社', '貸与 データ', '競合他社', '貸与PC']) {
      expect(searchPastCases({ keyword })).toContain('CASE-2025-0731');
    }
  });
});

describe('3 問と seed の突き合わせ', () => {
  it('1 問目「入社半年の慶弔休暇」は規程から答えられる', () => {
    expect(searchRegulations({ keyword: '慶弔休暇' })).toContain('勤続6か月以上');
  });

  it('2 問目「介護で在宅週3日」は規程と過去事例の両方から答えられる', () => {
    expect(searchRegulations({ keyword: '在宅勤務' })).toContain('人事総務部の承認');
    expect(searchPastCases({ keyword: '在宅' })).toContain('CASE-2025-0518');
  });

  it('3 問目「退職者の貸与PCデータ」は過去に二次へ回っている（＝拒む根拠がある）', () => {
    const out = searchPastCases({ keyword: '貸与' });
    expect(out).toContain('CASE-2025-0731');
    expect(out).toContain('二次エスカレーション');
  });
});
