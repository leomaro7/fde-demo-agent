import { useEffect, useState } from 'react';
import { readConfig, type WebConfig } from '../config.js';
import { createPkcePair, randomUrlSafe } from '../auth/pkce.js';
import { buildAuthorizeUrl, exchangeCodeForToken } from '../auth/cognito.js';
import { decideLoginAction } from '../auth/loginFlow.js';
import { invokeHarness, newSessionId, HarnessError, type HarnessMessage } from '../agent/harnessClient.js';
import { runTurn } from '../agent/toolLoop.js';
import { Conversation } from './Conversation.js';
import { TraceView } from './TraceView.js';
import { toTraceLines } from './traceText.js';
import type { StreamEvent } from '../agent/streamParser.js';
import { pickDemo } from '../../../demos/index.js';
import type { DemoConfig } from '../../../infra/lib/demo-config.js';
import type { ToolRegistry } from '../agent/toolLoop.js';

// モジュールのトップレベルで投げると、React が描画を始める前に例外が飛び、
// createRoot(...).render() にも到達せず画面が真っ白になる。
// ここでは投げず、結果を持ち回って App の中で画面に出す。
let config: WebConfig | null = null;
let configError: string | null = null;
try {
  // オブジェクトごと渡すと Vite の define による静的置換が効かない。
  // vite.config.ts が import.meta.env.VITE_* を 1 つずつ define しているため、
  // ここでも 1 つずつプロパティ参照する形で渡す
  config = readConfig({
    VITE_HARNESS_ARN: import.meta.env.VITE_HARNESS_ARN,
    VITE_COGNITO_DOMAIN: import.meta.env.VITE_COGNITO_DOMAIN,
    VITE_CLIENT_ID: import.meta.env.VITE_CLIENT_ID,
    VITE_DEMO_SLUG: import.meta.env.VITE_DEMO_SLUG,
  });
} catch (e) {
  configError = (e as Error).message;
}

// 案件も同じ形で取り出す。登録されていない slug のときに投げるので、
// ここも画面に出せるよう持ち回る（描画前に投げると画面が真っ白になる）
let demo: DemoConfig | null = null;
let tools: ToolRegistry = {};
if (config) {
  try {
    const entry = pickDemo(config.demoSlug);
    demo = entry.demo;
    tools = entry.tools;
  } catch (e) {
    configError = (e as Error).message;
  }
}
const redirectUri = `${window.location.origin}/`;

function clearLoginState() {
  sessionStorage.removeItem('pkce_verifier');
  sessionStorage.removeItem('oauth_state');
  window.history.replaceState({}, '', redirectUri);
}

export function App() {
  const [token, setToken] = useState<string | null>(null);
  const [messages, setMessages] = useState<HarnessMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(configError);
  const [sessionId] = useState(newSessionId);
  const [events, setEvents] = useState<StreamEvent[]>([]);

  useEffect(() => {
    if (!config) return; // 設定不足はすでに configError として画面に出ている
    const cfg = config;

    void (async () => {
      const action = decideLoginAction({
        search: window.location.search,
        verifier: sessionStorage.getItem('pkce_verifier'),
        expectedState: sessionStorage.getItem('oauth_state'),
      });

      if (action.kind === 'fail') {
        // 途中状態を残すと、再読み込み時に使用済みの code で交換を再試行して
        // また失敗する。次にやり直せるよう必ず後始末してから出す
        clearLoginState();
        setError(action.message);
        return;
      }

      if (action.kind === 'exchange') {
        try {
          setToken(
            await exchangeCodeForToken({
              domain: cfg.cognitoDomain,
              clientId: cfg.clientId,
              redirectUri,
              code: action.code,
              verifier: action.verifier,
            }),
          );
          clearLoginState();
        } catch (e) {
          // 失敗しても state 不一致の分岐と同じく必ず後始末する
          clearLoginState();
          setError((e as Error).message);
        }
        return;
      }

      // action.kind === 'redirect'
      try {
        const pair = await createPkcePair();
        const state = randomUrlSafe(16);
        sessionStorage.setItem('pkce_verifier', pair.verifier);
        sessionStorage.setItem('oauth_state', state);
        window.location.href = buildAuthorizeUrl({
          domain: cfg.cognitoDomain,
          clientId: cfg.clientId,
          redirectUri,
          challenge: pair.challenge,
          state,
        });
      } catch (e) {
        // crypto.subtle や sessionStorage が使えない環境（Safari のプライベート
        // ウィンドウ等）で未捕捉の rejection になると、画面は「ログインしています…」
        // のまま無反応になる
        setError(`ログインを開始できませんでした: ${(e as Error).message}`);
      }
    })();
  }, []);

  const send = async (text: string) => {
    // token は設定が揃っているときのログイン成功後にしか立たないため、ここでは常に非 null
    if (!token || !config) return;
    const cfg = config;
    setError(null);
    setBusy(true);
    setEvents([]);
    const next: HarnessMessage[] = [...messages, { role: 'user', content: [{ text }] }];
    setMessages(next);
    try {
      setMessages(
        await runTurn({
          invoke: (ms) =>
            invokeHarness({
              harnessArn: cfg.harnessArn,
              accessToken: token,
              runtimeSessionId: sessionId,
              messages: ms,
              region: cfg.region,
            }),
          tools,
          messages: next,
          onEvent: (e) => setEvents((prev) => [...prev, e]),
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

  if (!config || !demo) return <p style={{ padding: '2rem' }}>{error ?? '設定を読み込んでいます…'}</p>;
  if (!token) return <p style={{ padding: '2rem' }}>{error ?? 'ログインしています…'}</p>;

  return (
    <main style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{ padding: '0.75rem 1rem', background: demo.brand.primary, color: '#fff' }}>
        <strong>{demo.clientName}</strong> — デモ
      </header>
      {error && <p style={{ color: '#b91c1c', padding: '0 1rem' }}>{error}</p>}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <Conversation messages={messages} busy={busy} examples={demo.examples} onSend={send} />
        <TraceView lines={toTraceLines(events, Object.keys(tools))} />
      </div>
    </main>
  );
}
