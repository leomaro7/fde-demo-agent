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
});
