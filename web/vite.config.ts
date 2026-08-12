import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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

export default defineConfig({
  root: here,
  plugins: [react()],
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
