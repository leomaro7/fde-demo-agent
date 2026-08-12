import { describe, it, expect } from 'vitest';
import { search } from './tools.js';

describe('search', () => {
  it('キーワードに一致する項目を返す', () => {
    const result = search({ keyword: '出張' });
    expect(result).toContain('A-001');
    expect(result).toContain('規程 12 条');
  });

  it('一致しないときは見つからなかったと返す', () => {
    expect(search({ keyword: 'そんな制度はない' })).toContain('見つかりませんでした');
  });

  it('文字列を返す（toolResult.content は text のみ受け付けるため）', () => {
    expect(typeof search({ keyword: '経費' })).toBe('string');
  });

  it('「備品」で引くと A-002 が返る', () => {
    expect(search({ keyword: '備品' })).toContain('A-002');
  });

  it('「購入」で引くと A-002 が返る', () => {
    expect(search({ keyword: '購入' })).toContain('A-002');
  });

  it('半角スペース区切りの複数語（AND）で、両方を満たす項目が引ける', () => {
    const result = search({ keyword: '備品 購入' });
    expect(result).toContain('A-002');
  });

  it('いずれか一語しか満たさない項目は引けない（OR誤りの検出）。「精算」だけで A-001 が誤ってヒットしてはいけない', () => {
    const result = search({ keyword: '会食 立て替え 精算' });
    expect(result).not.toContain('A-001');
    expect(result).toContain('見つかりませんでした');
  });

  it('全角スペース区切りでも複数語の AND 検索ができる', () => {
    const result = search({ keyword: '備品　購入' });
    expect(result).toContain('A-002');
  });

  it('半角と全角スペースが混在していても AND 検索ができる', () => {
    const result = search({ keyword: '備品　購入 経費' });
    expect(result).toContain('A-002');
  });

  it('空白だけの検索語は、見つからなかったと返す', () => {
    expect(search({ keyword: '   ' })).toContain('見つかりませんでした');
  });

  it('全角空白だけの検索語も、見つからなかったと返す', () => {
    expect(search({ keyword: '　　' })).toContain('見つかりませんでした');
  });

  it('空文字の検索語は、見つからなかったと返す', () => {
    expect(search({ keyword: '' })).toContain('見つかりませんでした');
  });
});
