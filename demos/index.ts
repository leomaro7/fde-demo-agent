import type { DemoConfig } from '../infra/lib/demo-config.js';
import type { ToolRegistry } from '../web/src/agent/toolLoop.js';

import { demo as smokeDemo } from './smoke/demo.js';
import { tools as smokeTools } from './smoke/tools.js';
import { demo as salesDemo } from './sales/demo.js';
import { tools as salesTools } from './sales/tools.js';
import { demo as hrDemo } from './hr/demo.js';
import { tools as hrTools } from './hr/tools.js';

export interface DemoEntry {
  readonly demo: DemoConfig;
  readonly tools: ToolRegistry;
}

/**
 * 案件の登録表。**新しい案件を作ったらここに 1 行足す。**
 *
 * これが無かったころは `web/src/ui/App.tsx` が案件を直接 import しており、
 * 案件を切り替えるたびにソースを書き換えてビルドし直す必要があった。
 * 3 件が並走する状況では、**間違った案件を配信する事故が起きやすい**。
 *
 * `infra/bin/app.ts`（CDK 側）もここを使うので、両側の食い違いも起きない。
 */
export const demos: Record<string, DemoEntry> = {
  smoke: { demo: smokeDemo, tools: smokeTools },
  sales: { demo: salesDemo, tools: salesTools },
  hr: { demo: hrDemo, tools: hrTools },
};

/** slug で案件を引く。知らない slug なら、選べるものを挙げて投げる。 */
export function pickDemo(slug: string): DemoEntry {
  const entry = demos[slug];
  if (!entry) {
    throw new Error(
      `案件 "${slug}" は登録されていません。選べるのは: ${Object.keys(demos).join(', ')}。` +
        `demos/index.ts に足してください。`,
    );
  }
  return entry;
}
