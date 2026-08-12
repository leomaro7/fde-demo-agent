/**
 * ビルド時に web/.env.local を読むための純粋関数群。
 *
 * vite.config.ts に直接書くとテストしにくいので、解析と検証だけをここに切り出す。
 * シェルに残った process.env の VITE_* を絶対に見ないこと（このファイルが
 * 存在する理由そのもの）。process.env に触れるのは vite.config.ts 側のファイル
 * 読み込みだけにする。
 */
import { parseEnv } from 'node:util';

export const REQUIRED_KEYS = [
  'VITE_HARNESS_ARN',
  'VITE_COGNITO_DOMAIN',
  'VITE_CLIENT_ID',
  'VITE_DEMO_SLUG',
] as const;

/** .env 形式のテキストを解析する。 */
export function parseEnvText(text: string): Record<string, string> {
  // parseEnv の戻り値型は NodeJS.Dict<string>（値が undefined になり得る型）。
  // 実際には解析できたキーの値が undefined になることはないため、ここで断言する
  return parseEnv(text) as Record<string, string>;
}

/** 必須キーが揃っているか検証する。足りなければ、何が足りないかを言って投げる。 */
export function requireBuildEnv(parsed: Record<string, string>): Record<string, string> {
  const missing = REQUIRED_KEYS.filter((k) => !parsed[k]);
  if (missing.length > 0) {
    throw new Error(
      `web/.env.local に必須の値が足りません: ${missing.join(', ')}。scripts/deploy-web.ts か scripts/stack-outputs.ts で作れます。`,
    );
  }
  // 余計なキー（前身プロジェクトの process.env に残っていた VITE_AWS_REGION 等）が
  // 混ざっていても、ビルドに埋め込むのは必須キーだけにする
  return Object.fromEntries(REQUIRED_KEYS.map((k) => [k, parsed[k]]));
}
