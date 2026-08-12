import { useState } from 'react';
import type { HarnessMessage } from '../agent/harnessClient.js';

/** 画面に出す 1 行。ツール呼び出しは会話には出さない（右のトレースに出す）。 */
function visibleText(message: HarnessMessage): string {
  return message.content.map((b) => ('text' in b ? b.text : '')).join('');
}

export function Conversation(props: {
  readonly messages: HarnessMessage[];
  readonly busy: boolean;
  readonly examples: readonly string[];
  readonly onSend: (text: string) => void;
}) {
  const [draft, setDraft] = useState('');

  const send = (text: string) => {
    if (!text.trim() || props.busy) return;
    setDraft('');
    props.onSend(text);
  };

  return (
    <section style={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0, flex: 1 }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '1rem' }}>
        {props.messages.map((m, i) => {
          const text = visibleText(m);
          if (!text) return null;
          return (
            <p key={i} style={{ margin: '0 0 1rem', whiteSpace: 'pre-wrap' }}>
              <strong>{m.role === 'user' ? 'あなた' : 'エージェント'}: </strong>
              {text}
            </p>
          );
        })}
        {props.busy && <p style={{ opacity: 0.6 }}>考えています…</p>}
      </div>

      <div style={{ padding: '0 1rem 0.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {props.examples.map((q) => (
          <button key={q} onClick={() => send(q)} disabled={props.busy} style={{ fontSize: '0.85rem' }}>
            {q}
          </button>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
        style={{ display: 'flex', gap: '0.5rem', padding: '1rem' }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="質問を入力"
          style={{ flex: 1, padding: '0.5rem' }}
        />
        <button type="submit" disabled={props.busy}>
          送信
        </button>
      </form>
    </section>
  );
}
