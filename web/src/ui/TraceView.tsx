import type { TraceLine } from './traceText.js';

export function TraceView(props: { readonly lines: readonly TraceLine[] }) {
  return (
    <aside
      style={{
        width: '22rem',
        borderLeft: '1px solid #e5e7eb',
        overflowY: 'auto',
        padding: '1rem',
        fontSize: '0.85rem',
      }}
    >
      <h2 style={{ fontSize: '0.9rem', margin: '0 0 0.75rem' }}>実行トレース</h2>
      {props.lines.length === 0 && <p style={{ opacity: 0.6 }}>まだ何も調べていません</p>}
      {props.lines.map((line, i) => (
        <div key={i} style={{ marginBottom: '0.75rem' }}>
          <div style={{ fontWeight: 600 }}>{line.label}</div>
          <pre style={{ margin: '0.25rem 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {line.detail}
          </pre>
        </div>
      ))}
    </aside>
  );
}
