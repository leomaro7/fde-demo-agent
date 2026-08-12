/**
 * Cognito Hosted UI の認可コードフロー（PKCE）。
 *
 * Hosted UI は https://<instance>.auth.<region>.amazoncognito.com（実測）。
 * コールバック URL はワイルドカード不可なので、redirectUri は
 * User Pool Client に登録したものと完全に一致させる（末尾のスラッシュも含む）。
 */

export function buildAuthorizeUrl(o: {
  readonly domain: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly challenge: string;
  readonly state: string;
}): string {
  const params = new URLSearchParams({
    client_id: o.clientId,
    response_type: 'code',
    scope: 'openid email',
    redirect_uri: o.redirectUri,
    code_challenge: o.challenge,
    code_challenge_method: 'S256',
    state: o.state,
  });
  return `${o.domain}/oauth2/authorize?${params.toString()}`;
}

export async function exchangeCodeForToken(o: {
  readonly domain: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly code: string;
  readonly verifier: string;
  readonly fetchImpl?: typeof fetch;
}): Promise<string> {
  const doFetch = o.fetchImpl ?? globalThis.fetch;
  const res = await doFetch(`${o.domain}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: o.clientId,
      code: o.code,
      redirect_uri: o.redirectUri,
      code_verifier: o.verifier,
    }).toString(),
  });

  if (!res.ok) {
    throw new Error(`トークンの交換に失敗しました (${res.status}): ${await res.text()}`);
  }

  // アクセストークンを使う。ID トークンには client_id クレームが無く、
  // Harness の allowedClients 検証に落ちて 500 になる（実測）
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error('応答に access_token がありません');
  return json.access_token;
}
