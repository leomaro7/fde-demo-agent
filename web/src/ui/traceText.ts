import type { StreamEvent } from '../agent/streamParser.js';

export interface TraceLine {
  readonly label: string;
  readonly detail: string;
}

/**
 * ツール入力から画面に出す文字列を作る。
 *
 * Code Interpreter の入力には生成コードとデータ全体が入る。そのまま出すと
 * 画面が JSON で埋まるので、コード本体だけを抜き、長さも抑える（前身での失敗）。
 */
export function extractCode(input: unknown, maxLength = 400): string {
  const source =
    input && typeof input === 'object' && 'code' in input && typeof (input as { code: unknown }).code === 'string'
      ? (input as { code: string }).code
      : JSON.stringify(input ?? {});
  return source.length > maxLength ? `${source.slice(0, maxLength)}…` : source;
}

const WHO: Record<string, string> = {
  tool_use: 'ブラウザ',
  mcp_tool_use: 'Harness (MCP)',
  server_tool_use: 'Harness',
};

export function toTraceLines(events: readonly StreamEvent[]): TraceLine[] {
  const pending = new Map<number, { name: string; type: string; raw: string }>();
  // toolUseId からツール名を引けるようにしておく。ブラウザ側と Harness 側のツールが
  // 同じストリームに混ざるため、これが無いと「結果」行がどのツールのものか分からない。
  const toolNameById = new Map<string, string>();
  const lines: TraceLine[] = [];

  for (const e of events) {
    switch (e.kind) {
      case 'toolUse':
        pending.set(e.contentBlockIndex, { name: e.name, type: e.type, raw: '' });
        toolNameById.set(e.toolUseId, e.name);
        break;
      case 'toolUseInput': {
        const p = pending.get(e.contentBlockIndex);
        if (p) p.raw += e.input;
        break;
      }
      case 'contentBlockStop': {
        const p = pending.get(e.contentBlockIndex);
        if (!p) break;
        pending.delete(e.contentBlockIndex);
        lines.push({
          label: `${p.name}（${WHO[p.type] ?? p.type} が実行）`,
          detail: extractCode(safeParse(p.raw)),
        });
        break;
      }
      case 'toolResult': {
        // 対応するツール名が見つからない場合も落とさず、従来どおり「結果」とだけ出す
        const name = toolNameById.get(e.toolUseId);
        lines.push({ label: name ? `結果（${name}）` : '結果', detail: e.status });
        break;
      }
    }
  }
  return lines;
}

function safeParse(raw: string): unknown {
  try {
    return raw === '' ? {} : JSON.parse(raw);
  } catch {
    return raw;
  }
}
