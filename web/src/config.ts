export interface WebConfig {
  readonly harnessArn: string;
  readonly cognitoDomain: string;
  readonly clientId: string;
  /** どの案件を配信するか。demos/index.ts の鍵と一致する。 */
  readonly demoSlug: string;
  readonly region: string;
}

/**
 * ビルド時に渡された設定を読む。
 *
 * 足りなければ起動時に投げる。空白の画面だけ出て原因が分からないのが、
 * 商談前の確認では最悪のため。
 */
export function readConfig(env: Record<string, string | undefined>): WebConfig {
  const required = ['VITE_HARNESS_ARN', 'VITE_COGNITO_DOMAIN', 'VITE_CLIENT_ID', 'VITE_DEMO_SLUG'] as const;
  const missing = required.filter((k) => !env[k]);
  if (missing.length > 0) {
    throw new Error(`設定が足りません: ${missing.join(', ')}。scripts/stack-outputs.ts で作れます。`);
  }
  return {
    harnessArn: env.VITE_HARNESS_ARN!,
    cognitoDomain: env.VITE_COGNITO_DOMAIN!,
    clientId: env.VITE_CLIENT_ID!,
    demoSlug: env.VITE_DEMO_SLUG!,
    region: env.VITE_REGION ?? 'ap-northeast-1',
  };
}
