import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { parseEnvText, requireBuildEnv } from './buildEnv.js';

// ESM には __dirname が無い。import.meta.url から求める
const here = dirname(fileURLToPath(import.meta.url));
const envPath = join(here, '.env.local');

function readEnvFile(path: string): string {
  try {
    return readFileSync(path, 'utf-8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `${path} が見つかりません。scripts/deploy-web.ts か scripts/stack-outputs.ts で作ってください。`,
      );
    }
    throw e;
  }
}

// web/.env.local だけを見て設定を作る。ここで揃わなければビルドごと落とす。
// 黙って古い値や空の値のままビルドが通るのが最悪（別クライアントの Harness を
// 指したまま商談に持っていく事故になる）
const buildEnv = requireBuildEnv(parseEnvText(readEnvFile(envPath)));

/**
 * 配信する案件だけをビルドに含める。
 *
 * 登録表（demos/index.ts）を画面から直接 import すると、Vite が全案件を
 * バンドルに巻き込み、**クライアントのブラウザに他社のデモデータが配られる**。
 * 実際にそうなっていた（hr の配信物に sales と smoke の seed が入っていた）。
 * 要件書 4.1「他案件の画面に入れない」に反する。
 *
 * ここで slug から実体へ別名解決することで、選ばれた案件だけが依存グラフに載る。
 * 登録表は CDK 側（全案件のスタックを作る）とテストが使う。
 */
const demoDir = resolve(here, '..', 'demos', buildEnv.VITE_DEMO_SLUG);

export default defineConfig({
  root: here,
  plugins: [react()],
  resolve: {
    alias: {
      '#demo': resolve(demoDir, 'demo.ts'),
      '#demo-tools': resolve(demoDir, 'tools.ts'),
    },
  },
  build: { outDir: '../dist', emptyOutDir: true },
  server: { port: 5173 },
  // Vite は既定で .env ファイルに加えて process.env の VITE_* も import.meta.env に
  // 取り込み、しかも process.env を優先する。開発者のシェルに前身プロジェクトの
  // VITE_* が残っていると、上の web/.env.local を読んだ値が黙って上書きされる
  // （実際に起きた事故）。envPrefix を実在しない接頭辞にして Vite 自身の自動注入を
  // 止め、下の define だけを唯一の入り口にする
  envPrefix: '__fde_demo_do_not_use_vite_auto_env__',
  define: {
    'import.meta.env.VITE_HARNESS_ARN': JSON.stringify(buildEnv.VITE_HARNESS_ARN),
    'import.meta.env.VITE_COGNITO_DOMAIN': JSON.stringify(buildEnv.VITE_COGNITO_DOMAIN),
    'import.meta.env.VITE_CLIENT_ID': JSON.stringify(buildEnv.VITE_CLIENT_ID),
  },
});
