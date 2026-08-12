/**
 * 土台スタックと案件スタックの CFn 出力を、Vite が読む環境変数の形にして出す。
 *
 * 使い方:
 *   npx tsx scripts/stack-outputs.ts <instance> <slug> > web/.env.local
 *
 * 人が値をコピーすると必ず間違える。実物から引く。
 */
import { execFileSync } from 'node:child_process';

const REQUIRED = {
  HarnessArn: 'VITE_HARNESS_ARN',
  ClientId: 'VITE_CLIENT_ID',
  HostedUiDomain: 'VITE_COGNITO_DOMAIN',
} as const;

export function toEnvLines(outputs: Record<string, string>, slug: string): string {
  const missing = Object.keys(REQUIRED).filter((k) => !outputs[k]);
  if (missing.length > 0) {
    throw new Error(`スタックの出力が足りません: ${missing.join(', ')}`);
  }
  if (!slug) throw new Error('slug が指定されていません');
  return [
    ...Object.entries(REQUIRED).map(([key, envName]) => `${envName}=${outputs[key]}`),
    // どの案件を配信するかはスタックの出力ではなく、実行時の引数で決まる
    `VITE_DEMO_SLUG=${slug}`,
  ].join('\n');
}

function stackOutputs(stackName: string): Record<string, string> {
  const raw = execFileSync(
    'aws',
    [
      'cloudformation', 'describe-stacks',
      '--stack-name', stackName,
      '--region', 'ap-northeast-1',
      '--query', 'Stacks[0].Outputs',
      '--output', 'json',
    ],
    { encoding: 'utf-8' },
  );
  const entries = JSON.parse(raw) as { OutputKey: string; OutputValue: string }[];
  return Object.fromEntries(entries.map((e) => [e.OutputKey, e.OutputValue]));
}

// このファイルを直接実行したときだけ AWS を叩く（テストからの import では叩かない）
if (process.argv[1]?.endsWith('stack-outputs.ts')) {
  const [instance, slug] = process.argv.slice(2);
  if (!instance || !slug) {
    throw new Error('使い方: npx tsx scripts/stack-outputs.ts <instance> <slug>');
  }
  const outputs = {
    ...stackOutputs(`FdeDemo-${instance}-Foundation`),
    ...stackOutputs(`FdeDemo-${instance}-${slug}`),
  };
  console.log(toEnvLines(outputs, slug));
}
