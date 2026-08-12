import { describe, it, expect } from 'vitest';
import { buildAuthorizeUrl, exchangeCodeForToken } from './cognito.js';

const base = {
  domain: 'https://example.auth.ap-northeast-1.amazoncognito.com',
  clientId: 'client-abc',
  redirectUri: 'http://localhost:5173/',
};

describe('buildAuthorizeUrl', () => {
  it('認可コードフローと PKCE の指定を載せる', () => {
    const url = new URL(buildAuthorizeUrl({ ...base, challenge: 'ch', state: 'st' }));
    expect(url.origin + url.pathname).toBe(`${base.domain}/oauth2/authorize`);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('client-abc');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:5173/');
    expect(url.searchParams.get('code_challenge')).toBe('ch');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe('st');
  });
});

describe('exchangeCodeForToken', () => {
  it('フォーム形式で POST し、アクセストークンを返す', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ access_token: 'at-1', id_token: 'it-1' }), { status: 200 });
    }) as unknown as typeof fetch;

    const token = await exchangeCodeForToken({ ...base, code: 'c1', verifier: 'v1', fetchImpl });

    expect(token).toBe('at-1');
    expect(seen!.url).toBe(`${base.domain}/oauth2/token`);
    expect((seen!.init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/x-www-form-urlencoded',
    );
    const body = new URLSearchParams(seen!.init.body as string);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('c1');
    expect(body.get('code_verifier')).toBe('v1');
  });

  it('ID トークンではなくアクセストークンを返す', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ access_token: 'at-1', id_token: 'it-1' }), {
        status: 200,
      })) as unknown as typeof fetch;
    // ID トークンには client_id クレームが無く、Harness の allowedClients 検証に落ちて 500 になる
    await expect(exchangeCodeForToken({ ...base, code: 'c', verifier: 'v', fetchImpl })).resolves.toBe('at-1');
  });

  it('交換に失敗したら投げる', async () => {
    const fetchImpl = (async () =>
      new Response('invalid_grant', { status: 400 })) as unknown as typeof fetch;
    await expect(exchangeCodeForToken({ ...base, code: 'c', verifier: 'v', fetchImpl })).rejects.toThrow(
      /invalid_grant/,
    );
  });
});
