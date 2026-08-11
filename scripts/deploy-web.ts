/**
 * フロントをビルドして Amplify に手動デプロイする。
 *
 * 使い方:
 *   npx tsx scripts/deploy-web.ts <instance> <slug>
 *
 * リポジトリを接続していないので自動ビルドは走らない。ZIP を上げる。
 * 自前の S3 バケットは要らない（create-deployment が署名付き URL を返す）。
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toEnvLines } from './stack-outputs.js';

const REGION = 'ap-northeast-1';

/** 署名付き URL に & が入るので、シェルを介さず配列のまま execFile に渡す。 */
export function zipUploadRequest(o: { zipUploadUrl: string; zipPath: string }): string[] {
  return ['-X', 'PUT', '--upload-file', o.zipPath, o.zipUploadUrl];
}

function aws(args: string[]): string {
  return execFileSync('aws', [...args, '--region', REGION], { encoding: 'utf-8' });
}

function stackOutputs(stackName: string): Record<string, string> {
  const raw = aws(['cloudformation', 'describe-stacks', '--stack-name', stackName,
    '--query', 'Stacks[0].Outputs', '--output', 'json']);
  const entries = JSON.parse(raw) as { OutputKey: string; OutputValue: string }[];
  return Object.fromEntries(entries.map((e) => [e.OutputKey, e.OutputValue]));
}

export async function deployWeb(o: { instance: string; slug: string }): Promise<string> {
  const outputs = {
    ...stackOutputs(`FdeDemo-${o.instance}-Foundation`),
    ...stackOutputs(`FdeDemo-${o.instance}-${o.slug}`),
  };

  // ビルド設定はリポジトリの web/.env.local に書く。ビルド成果物だけを一時領域に置く
  console.log(`Instance '${o.instance}' の Slug '${o.slug}' で web/.env.local を上書きします`);
  writeFileSync('web/.env.local', toEnvLines(outputs) + '\n');
  execFileSync('npm', ['run', 'build:web'], { stdio: 'inherit' });

  const work = mkdtempSync(join(tmpdir(), 'fde-demo-'));
  const zipPath = join(work, 'dist.zip');
  execFileSync('zip', ['-qr', zipPath, '.'], { cwd: 'dist' });

  const created = JSON.parse(
    aws(['amplify', 'create-deployment', '--app-id', outputs.AmplifyAppId, '--branch-name', o.slug]),
  ) as { jobId: string; zipUploadUrl: string };

  execFileSync('curl', ['-fsS', ...zipUploadRequest({ zipUploadUrl: created.zipUploadUrl, zipPath })]);

  aws(['amplify', 'start-deployment', '--app-id', outputs.AmplifyAppId,
    '--branch-name', o.slug, '--job-id', created.jobId]);

  return outputs.DemoUrl;
}

if (process.argv[1]?.endsWith('deploy-web.ts')) {
  const [instance, slug] = process.argv.slice(2);
  if (!instance || !slug) throw new Error('使い方: npx tsx scripts/deploy-web.ts <instance> <slug>');
  deployWeb({ instance, slug }).then((url) => console.log(`デモの URL: ${url}`)).catch((err) => {
    console.error(`エラー: デプロイに失敗しました。\n${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
