import { describe, it, expect } from 'vitest';
import { zipUploadRequest } from './deploy-web.js';

describe('zipUploadRequest', () => {
  it('署名付き URL に ZIP を PUT する curl の引数を作る', () => {
    const args = zipUploadRequest({ zipUploadUrl: 'https://s3/put?sig=1', zipPath: '/tmp/x/dist.zip' });
    expect(args).toEqual(['-X', 'PUT', '--upload-file', '/tmp/x/dist.zip', 'https://s3/put?sig=1']);
  });

  it('URL をシェルに展開させない形で渡す（署名に & が入るため）', () => {
    const args = zipUploadRequest({ zipUploadUrl: 'https://s3/put?a=1&b=2', zipPath: 'z.zip' });
    // 配列のまま execFile に渡す前提。1 要素として保たれていること
    expect(args.at(-1)).toBe('https://s3/put?a=1&b=2');
  });
});
