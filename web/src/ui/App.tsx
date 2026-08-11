import { useEffect, useState } from 'react';
import { readConfig } from '../config.js';
import { createPkcePair, randomUrlSafe } from '../auth/pkce.js';
import { buildAuthorizeUrl, exchangeCodeForToken } from '../auth/cognito.js';
import { invokeHarness, newSessionId, HarnessError, type HarnessMessage } from '../agent/harnessClient.js';
import { runTurn } from '../agent/toolLoop.js';
import { Conversation } from './Conversation.js';
import { demo } from '../../../demos/smoke/demo.js';
import { tools } from '../../../demos/smoke/tools.js';

const config = readConfig(import.meta.env as unknown as Record<string, string | undefined>);
const redirectUri = `${window.location.origin}/`;

export function App() {
  const [token, setToken] = useState<string | null>(null);
  const [messages, setMessages] = useState<HarnessMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId] = useState(newSessionId);

  useEffect(() => {
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      const verifier = sessionStorage.getItem('pkce_verifier');
      const expectedState = sessionStorage.getItem('oauth_state');

      if (code && verifier && expectedState) {
        // state を突き合わせないと、他所から仕込まれた認可コードを掴まされる（CSRF）。
        // 生成するだけで検証しないなら、そもそも付ける意味がない
        if (params.get('state') !== expectedState) {
          sessionStorage.removeItem('pkce_verifier');
          sessionStorage.removeItem('oauth_state');
          setError('ログインの検証に失敗しました。画面を読み込み直してください。');
          return;
        }
        try {
          setToken(
            await exchangeCodeForToken({
              domain: config.cognitoDomain,
              clientId: config.clientId,
              redirectUri,
              code,
              verifier,
            }),
          );
          sessionStorage.removeItem('pkce_verifier');
          sessionStorage.removeItem('oauth_state');
          window.history.replaceState({}, '', redirectUri);
        } catch (e) {
          setError((e as Error).message);
        }
        return;
      }

      const pair = await createPkcePair();
      const state = randomUrlSafe(16);
      sessionStorage.setItem('pkce_verifier', pair.verifier);
      sessionStorage.setItem('oauth_state', state);
      window.location.href = buildAuthorizeUrl({
        domain: config.cognitoDomain,
        clientId: config.clientId,
        redirectUri,
        challenge: pair.challenge,
        state,
      });
    })();
  }, []);

  const send = async (text: string) => {
    if (!token) return;
    setError(null);
    setBusy(true);
    const next: HarnessMessage[] = [...messages, { role: 'user', content: [{ text }] }];
    setMessages(next);
    try {
      setMessages(
        await runTurn({
          invoke: (ms) =>
            invokeHarness({
              harnessArn: config.harnessArn,
              accessToken: token,
              runtimeSessionId: sessionId,
              messages: ms,
              region: config.region,
            }),
          tools,
          messages: next,
        }),
      );
    } catch (e) {
      // 認可拒否も 500 で来る。商談中に黙って止まるのが最悪なので必ず出す
      setError(
        e instanceof HarnessError && e.denied
          ? 'このアカウントにはこのデモを見る権限がありません。'
          : `応答に失敗しました: ${(e as Error).message}`,
      );
    } finally {
      setBusy(false);
    }
  };

  if (!token) return <p style={{ padding: '2rem' }}>{error ?? 'ログインしています…'}</p>;

  return (
    <main style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{ padding: '0.75rem 1rem', background: demo.brand.primary, color: '#fff' }}>
        <strong>{demo.clientName}</strong> — デモ
      </header>
      {error && <p style={{ color: '#b91c1c', padding: '0 1rem' }}>{error}</p>}
      <div style={{ flex: 1, minHeight: 0 }}>
        <Conversation messages={messages} busy={busy} examples={demo.examples} onSend={send} />
      </div>
    </main>
  );
}
