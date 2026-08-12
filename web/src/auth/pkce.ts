/**
 * PKCE（RFC 7636）。User Pool Client は generateSecret: false の公開クライアントなので、
 * 認可コードを横取りされても交換できないようにこれを使う。
 */

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomUrlSafe(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export async function challengeFromVerifier(verifier: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

export async function createPkcePair(): Promise<{ verifier: string; challenge: string }> {
  // 32 バイト → base64url で 43 文字。RFC 7636 の下限ちょうど
  const verifier = randomUrlSafe(32);
  return { verifier, challenge: await challengeFromVerifier(verifier) };
}
