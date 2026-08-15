import { Stack, aws_iam as iam } from 'aws-cdk-lib';
import type { Construct } from 'constructs';

/**
 * Harness の実行ロール。
 *
 * 信頼ポリシーと権限は @aws/agentcore-cdk@0.1.0-alpha.46 の AgentCoreHarnessRole から
 * 写した（依存はしない。中身を読んだだけ）。混乱した代理問題を避けるため
 * aws:SourceAccount と aws:SourceArn で絞る。
 *
 * ロール名は指定しない（設計原則 5.2）。
 */
export function harnessExecutionRole(scope: Construct, id: string): iam.Role {
  const stack = Stack.of(scope);
  const { partition, account, region } = stack;

  const role = new iam.Role(scope, id, {
    assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com', {
      conditions: {
        StringEquals: { 'aws:SourceAccount': account },
        ArnLike: { 'aws:SourceArn': `arn:${partition}:bedrock-agentcore:${region}:${account}:*` },
      },
    }),
  });

  role.addToPolicy(
    new iam.PolicyStatement({
      sid: 'BedrockModelInvocation',
      actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
      resources: [
        `arn:${partition}:bedrock:*::foundation-model/*`,
        `arn:${partition}:bedrock:${region}:${account}:*`,
      ],
    }),
  );

  /**
   * **Marketplace 経由で提供されるモデルには、これが要る。**
   *
   * 無いと `InvokeHarness` のストリームの中で AccessDeniedException になる。
   * 本文は「IAM user or service role is not authorized」なので**アカウントの
   * 規約未同意にも読めるが、塞いでいるのはこのロール**（2026-08-15 に踏んだ。
   * 同じモデルを自分の資格情報で `bedrock-runtime converse` すると通る）。
   *
   * **`*` 以外は書けない。** `ViewSubscriptions` は Service Reference に
   * `Resources` も `ActionConditionKeys` も持たない（＝リソースレベルの指定も
   * `ProductId` による絞り込みも存在しない）。AWS 管理ポリシーの
   * `AmazonBedrockFullAccess` も同じく `Resource: "*"` で書いている。
   *
   * **`Subscribe` は足さない。** 購読は課金の発生する契約行為で、実行ロールに要らない。
   * `ViewSubscriptions` だけで通ることは実測済み。
   */
  role.addToPolicy(
    new iam.PolicyStatement({
      sid: 'MarketplaceSubscriptionCheck',
      actions: ['aws-marketplace:ViewSubscriptions'],
      resources: ['*'],
    }),
  );

  role.addToPolicy(
    new iam.PolicyStatement({
      sid: 'XRayTracingAccess',
      actions: [
        'xray:PutTraceSegments',
        'xray:PutTelemetryRecords',
        'xray:GetSamplingRules',
        'xray:GetSamplingTargets',
      ],
      resources: ['*'],
    }),
  );

  role.addToPolicy(
    new iam.PolicyStatement({
      sid: 'CloudWatchLogsGroup',
      actions: ['logs:CreateLogGroup', 'logs:DescribeLogStreams'],
      resources: [`arn:${partition}:logs:${region}:${account}:log-group:/aws/bedrock-agentcore/runtimes/*`],
    }),
  );

  role.addToPolicy(
    new iam.PolicyStatement({
      sid: 'CloudWatchLogsDescribe',
      actions: ['logs:DescribeLogGroups'],
      resources: [`arn:${partition}:logs:${region}:${account}:log-group:*`],
    }),
  );

  role.addToPolicy(
    new iam.PolicyStatement({
      sid: 'CloudWatchLogsStream',
      actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
      resources: [
        `arn:${partition}:logs:${region}:${account}:log-group:/aws/bedrock-agentcore/runtimes/*:log-stream:*`,
      ],
    }),
  );

  role.addToPolicy(
    new iam.PolicyStatement({
      sid: 'CloudWatchMetrics',
      actions: ['cloudwatch:PutMetricData'],
      resources: ['*'],
      conditions: { StringEquals: { 'cloudwatch:namespace': 'bedrock-agentcore' } },
    }),
  );

  role.addToPolicy(
    new iam.PolicyStatement({
      sid: 'WorkloadAccessToken',
      actions: [
        'bedrock-agentcore:GetWorkloadAccessToken',
        'bedrock-agentcore:GetWorkloadAccessTokenForJWT',
      ],
      resources: [
        `arn:${partition}:bedrock-agentcore:${region}:${account}:workload-identity-directory/default`,
        `arn:${partition}:bedrock-agentcore:${region}:${account}:workload-identity-directory/default/workload-identity/harness_*`,
      ],
    }),
  );

  return role;
}
