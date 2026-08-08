# 土台スタックと案件スタック 実装計画

> **エージェント作業者へ:** 必須サブスキル — この計画は
> `superpowers:subagent-driven-development`（推奨）または `superpowers:executing-plans` で
> タスク単位に実行すること。ステップはチェックボックス（`- [ ]`）で追跡する。

**ゴール:** `cdk deploy` 一発で土台と案件がデプロイされ、Cognito で保護された Harness が
`READY` になり、ブラウザの Bearer トークンで `InvokeHarness` を叩けるところまで作る。

**アーキテクチャ:** 土台スタック（Cognito User Pool + Hosted UI ドメイン + Amplify App +
Harness 実行ロール）を 1 つ置き、案件ごとに案件スタック（Harness + User Pool Client +
User Pool Group + Amplify Branch）を積む。Harness は `AWS::BedrockAgentCore::Harness` を
`aws-cdk-lib` の `CfnHarness`（L1）で作る。案件間の分離は Harness の `CustomJWTAuthorizer` が
`cognito:groups` を検証して行う。

**技術スタック:** TypeScript / aws-cdk-lib v2 / vitest / `@aws-sdk/client-bedrock-agentcore`（型のみ）

**設計書:** [../specs/2026-08-08-what-to-build-design.md](../specs/2026-08-08-what-to-build-design.md)

## この計画の範囲

設計書 7 章の**手順 1〜3 とパーサの TDD**。加えて未確認 1〜5 の**実測**まで。

**含まない** — フロントの画面（手順 4〜6）と手順書（手順 7）。別計画にする。
設計書 4.8 が TDD の対象に挙げたもののうち、**`toolLoop` と
「Code Interpreter 入力からのコード抜き出し」もそちら**（どちらも画面側の部品）。
理由は未確認 4（CFn 経由の案件デプロイ所要時間）が方針を覆しうるため。
ここが `217〜256 秒` から大幅に悪化するなら「案件だけ SDK スクリプト」が再浮上し、
フロントの計画を先に書いた分が無駄になる。**先に潰す。**

## Global Constraints

これは全タスクの要件に含まれる。**例外なく守る。**

- **リージョンは `ap-northeast-1`。** 他リージョンは対象外
- **`instance` は必須。** CDK context `-c instance=<name>` で渡す。未指定なら synth で落とす
- **アカウント ID を利用者に見える名前に入れない**（Cognito ドメイン、Amplify アプリ名）
- **IAM ロール名は指定しない。** CDK の自動命名に任せる
- **`Memory` を省略しない。** 省略するとサービスが managed memory を勝手に用意する。
  メモリ無しは `{ Disabled: {} }` を明示する
- **`SystemPrompt` は `[{ Text: "..." }]` の配列。** 文字列ではない。`Text` は `minLength: 1`
- **`harnessName` は英数字とアンダースコアのみ・先頭は文字・40 文字以内。** ハイフン不可
- **`Environment` は省略する。** VPC を使わないため（`NetworkConfiguration` は createOnly）
- **一時ファイルを使わない。** 設定はリポジトリに置く（`/tmp` に書かない）
- **`aws-facts.md` に無い AWS 仕様を推測で書かない。** `--generate-cli-skeleton` で確かめる
- **コミットは Conventional Commits。** 本文には何をしたかより**なぜそうしたか**を書く。
  `Co-Authored-By` トレーラーは付けない（リポジトリの既存コミットに無い）

---

## ファイル構成

| ファイル | 責務 |
|---|---|
| `package.json` / `tsconfig.json` / `cdk.json` / `.gitignore` | ビルドと実行の設定 |
| `infra/lib/naming.ts` | `harnessName` の組み立てと検証。**純粋関数** |
| `infra/lib/harness-execution-role.ts` | Harness 実行ロール。信頼ポリシーと権限 |
| `infra/lib/foundation-stack.ts` | User Pool / ドメイン / Amplify App / 実行ロール / Export |
| `infra/lib/harness.ts` | `AWS::BedrockAgentCore::Harness`（`CfnHarness`）を案件向けに包む |
| `infra/lib/demo-config.ts` | 案件設定の型。CDK とフロントの両方が import する |
| `infra/lib/demo-stack.ts` | Harness / User Pool Client / Group / Amplify Branch |
| `infra/bin/app.ts` | スタックの組み立て。`instance` の受け取り |
| `demos/smoke/demo.ts` | **土台検証専用**の案件。商談用ではない |
| `web/src/agent/eventstream.ts` | バイト列 → フレーム。**純粋関数** |
| `web/src/agent/streamParser.ts` | フレーム → イベント。**純粋関数** |
| `scripts/probe-harness.ts` | 実測用。`InvokeHarness` を叩いて生イベントを出す |

---

## Task 1: プロジェクト基盤と `harnessName` の検証

**Files:**
- Create: `package.json`, `tsconfig.json`, `cdk.json`, `.gitignore`
- Create: `infra/lib/naming.ts`
- Test: `infra/lib/naming.test.ts`

**Interfaces:**
- Consumes: なし（最初のタスク）
- Produces: `toHarnessName(instance: string, slug: string): string` — 例外を投げるか、
  検証済みの名前を返す

- [ ] **Step 1: `package.json` を作る**

```json
{
  "name": "fde-demo-agent",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "synth": "cdk synth",
    "deploy": "cdk deploy"
  },
  "devDependencies": {
    "aws-cdk": "^2",
    "aws-cdk-lib": "^2",
    "constructs": "^10",
    "typescript": "^5",
    "vitest": "^3",
    "@types/node": "^22"
  }
}
```

- [ ] **Step 2: `tsconfig.json` を作る**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"],
    "noEmit": true
  },
  "include": ["infra/**/*.ts", "web/**/*.ts", "demos/**/*.ts", "scripts/**/*.ts"]
}
```

- [ ] **Step 3: `cdk.json` を作る**

```json
{
  "app": "npx tsx infra/bin/app.ts",
  "watch": { "exclude": ["**/*.test.ts", "node_modules/**"] },
  "context": {
    "@aws-cdk/core:newStyleStackSynthesis": true
  }
}
```

`tsx` を devDependencies に足す:

```bash
npm pkg set devDependencies.tsx="^4"
```

- [ ] **Step 4: `.gitignore` を作る**

```
node_modules/
cdk.out/
.env
.env.*
*.tgz
```

- [ ] **Step 5: 依存を入れる**

Run: `npm install`
Expected: `node_modules/` ができ、エラーなく終わる

- [ ] **Step 6: 失敗するテストを書く**

`infra/lib/naming.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { toHarnessName } from './naming.js';

describe('toHarnessName', () => {
  it('instance と slug を _ で繋ぐ', () => {
    expect(toHarnessName('dev', 'sales')).toBe('dev_sales');
  });

  it('ハイフンをアンダースコアに置き換える', () => {
    expect(toHarnessName('dev-1', 'sales-north')).toBe('dev_1_sales_north');
  });

  it('40 文字を超えたら投げる（切り詰めない）', () => {
    expect(() => toHarnessName('a'.repeat(20), 'b'.repeat(20)))
      .toThrow(/40 文字/);
  });

  it('先頭が数字なら投げる', () => {
    expect(() => toHarnessName('1dev', 'sales')).toThrow(/使えない文字/);
  });

  it('英数字とアンダースコア以外が残るなら投げる', () => {
    expect(() => toHarnessName('dev', 'sales.north')).toThrow(/使えない文字/);
  });
});
```

- [ ] **Step 7: テストを流して失敗を確認する**

Run: `npx vitest run infra/lib/naming.test.ts`
Expected: FAIL. `Failed to resolve import "./naming.js"` のような解決エラー

- [ ] **Step 8: 最小の実装を書く**

`infra/lib/naming.ts`:

```ts
/**
 * Harness の物理名を組み立てる。
 *
 * 制約（実測。aws-facts.md 参照）: 英数字とアンダースコアのみ、先頭は文字、40 文字以内。
 * ハイフンは使えない。
 *
 * ハイフンだけは `_` に置き換える（slug にハイフンを使うのが自然なため）。
 * それ以外の違反は変換せず投げる。黙って切り詰めると別の案件と名前が衝突しうる。
 */
export function toHarnessName(instance: string, slug: string): string {
  const name = `${instance}_${slug}`.replace(/-/g, '_');

  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(
      `harnessName に使えない文字が含まれています: "${name}"。` +
        `英数字とアンダースコアのみ、先頭は文字である必要があります。`,
    );
  }
  if (name.length > 40) {
    throw new Error(
      `harnessName が 40 文字を超えています: "${name}"（${name.length} 文字）。` +
        `instance か slug を短くしてください。`,
    );
  }
  return name;
}
```

- [ ] **Step 9: テストを流して通ることを確認する**

Run: `npx vitest run infra/lib/naming.test.ts`
Expected: PASS。5 件すべて緑

- [ ] **Step 10: コミット**

```bash
git add package.json package-lock.json tsconfig.json cdk.json .gitignore infra/lib/naming.ts infra/lib/naming.test.ts
git commit -m "$(cat <<'EOF'
feat: プロジェクト基盤と harnessName の検証を追加

harnessName は英数字とアンダースコアのみ・40 文字以内という実測済みの制約がある。
ハイフンだけは _ に置き換える。slug にハイフンを使うのが自然なため。

それ以外の違反は変換せず投げる。黙って切り詰めると、別々の案件が同じ名前に
落ちて衝突しうる。CreateHarness は createOnly なので、衝突に気づくのは
デプロイ時になる。synth で落とすほうが安い。
EOF
)"
```

---

## Task 2: Harness 実行ロールと土台スタック

**Files:**
- Create: `infra/lib/harness-execution-role.ts`
- Create: `infra/lib/foundation-stack.ts`
- Test: `infra/lib/foundation-stack.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `harnessExecutionRole(scope: Construct, id: string): iam.Role`
  - `class FoundationStack extends Stack`、コンストラクタ props は
    `FoundationStackProps { instance: string } & StackProps`
  - Export 名: `${stackName}-UserPoolId` / `-DiscoveryUrl` / `-AmplifyAppId` / `-ExecutionRoleArn`

- [ ] **Step 1: 実行ロールを書く**

`infra/lib/harness-execution-role.ts`:

```ts
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
```

- [ ] **Step 2: 失敗するテストを書く**

`infra/lib/foundation-stack.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { FoundationStack } from './foundation-stack.js';

function synth(instance = 'demo1') {
  const app = new App();
  const stack = new FoundationStack(app, `FdeDemo-${instance}-Foundation`, {
    instance,
    env: { account: '123456789012', region: 'ap-northeast-1' },
  });
  return Template.fromStack(stack);
}

describe('FoundationStack', () => {
  it('Cognito ドメインのプレフィックスは instance そのもの', () => {
    // 厳密一致なので、アカウント ID が混ざっていればここで落ちる。
    // テンプレート全文を走査してはいけない。実行ロールの信頼ポリシーは
    // aws:SourceAccount にアカウント ID の実値を要求するため両立しない。
    // 守るべきなのは「利用者に見える名前」だけ（要件書 5.3）。
    synth('demo1').hasResourceProperties('AWS::Cognito::UserPoolDomain', { Domain: 'demo1' });
  });

  it('Amplify アプリ名に instance が入る', () => {
    synth('demo1').hasResourceProperties('AWS::Amplify::App', { Name: 'fde-demo-demo1' });
  });

  it('IAM ロール名を指定しない（自動命名に任せる）', () => {
    const roles = synth().findResources('AWS::IAM::Role');
    for (const role of Object.values(roles)) {
      expect(role.Properties).not.toHaveProperty('RoleName');
    }
  });

  it('実行ロールの信頼ポリシーが SourceAccount で絞られている', () => {
    synth().hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Principal: { Service: 'bedrock-agentcore.amazonaws.com' },
            Condition: Match.objectLike({
              StringEquals: { 'aws:SourceAccount': '123456789012' },
            }),
          }),
        ]),
      }),
    });
  });

  it('案件スタックが要る 4 つを Export する', () => {
    const outputs = synth().findOutputs('*');
    const names = Object.values(outputs).map((o: any) => o.Export?.Name);
    expect(names).toEqual(
      expect.arrayContaining([
        'FdeDemo-demo1-Foundation-UserPoolId',
        'FdeDemo-demo1-Foundation-DiscoveryUrl',
        'FdeDemo-demo1-Foundation-AmplifyAppId',
        'FdeDemo-demo1-Foundation-ExecutionRoleArn',
      ]),
    );
  });
});
```

- [ ] **Step 3: テストを流して失敗を確認する**

Run: `npx vitest run infra/lib/foundation-stack.test.ts`
Expected: FAIL。`./foundation-stack.js` が解決できない

- [ ] **Step 4: 土台スタックを書く**

`infra/lib/foundation-stack.ts`:

```ts
import {
  Stack,
  StackProps,
  CfnOutput,
  RemovalPolicy,
  aws_cognito as cognito,
  aws_amplify as amplify,
} from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import { harnessExecutionRole } from './harness-execution-role.js';

export interface FoundationStackProps extends StackProps {
  /** 同一アカウントに複数の土台を置くための識別子。グローバル一意な名前に必ず入る。 */
  readonly instance: string;
}

export class FoundationStack extends Stack {
  readonly userPool: cognito.UserPool;

  constructor(scope: Construct, id: string, props: FoundationStackProps) {
    super(scope, id, props);
    const { instance } = props;

    // デモは数週間で廃棄する前提。撤去は 1 手で残骸なく終わる必要がある。
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // ドメインプレフィックスはリージョン内で全 AWS アカウント共通の名前空間。
    // 一意性の責任は instance を決める人にある。アカウント ID は入れない
    // （ログイン URL はクライアントのブラウザに表示される）。
    this.userPool.addDomain('Domain', {
      cognitoDomain: { domainPrefix: instance },
    });

    // リポジトリは接続しない。中身は start-deployment で ZIP を上げる。
    // 接続すると GitHub のアクセストークンが要り、シークレットを CFn に持ち込むことになる。
    const amplifyApp = new amplify.CfnApp(this, 'App', { name: `fde-demo-${instance}` });

    const executionRole = harnessExecutionRole(this, 'HarnessExecutionRole');

    new CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      exportName: `${this.stackName}-UserPoolId`,
    });
    new CfnOutput(this, 'DiscoveryUrl', {
      value: `https://cognito-idp.${this.region}.amazonaws.com/${this.userPool.userPoolId}/.well-known/openid-configuration`,
      exportName: `${this.stackName}-DiscoveryUrl`,
    });
    new CfnOutput(this, 'AmplifyAppId', {
      value: amplifyApp.attrAppId,
      exportName: `${this.stackName}-AmplifyAppId`,
    });
    new CfnOutput(this, 'ExecutionRoleArn', {
      value: executionRole.roleArn,
      exportName: `${this.stackName}-ExecutionRoleArn`,
    });
  }
}
```

- [ ] **Step 5: テストを流して通ることを確認する**

Run: `npx vitest run infra/lib/foundation-stack.test.ts`
Expected: PASS。5 件すべて緑

- [ ] **Step 6: コミット**

```bash
git add infra/lib/harness-execution-role.ts infra/lib/foundation-stack.ts infra/lib/foundation-stack.test.ts
git commit -m "$(cat <<'EOF'
feat: 土台スタックと Harness 実行ロールを追加

Amplify にリポジトリを接続しない。接続すると GitHub のアクセストークンが要り、
シークレットを CFn に持ち込むことになる。中身は start-deployment で ZIP を上げる。
Amplify アプリが未接続でも作れることは実測済み。

実行ロールの信頼ポリシーは aws:SourceAccount と aws:SourceArn で絞る。
混乱した代理問題を避けるため。権限は @aws/agentcore-cdk の実装から写したが、
パッケージには依存していない（alpha 版のため）。

テストでアカウント ID がテンプレートに出ないことを確認している。
前身ではドメインにアカウント ID が入り、ログイン URL に露出していた。
EOF
)"
```

---

## Task 3: Harness のコンストラクト

**Files:**
- Create: `infra/lib/harness.ts`
- Test: `infra/lib/harness.test.ts`

**Interfaces:**
- Consumes: `toHarnessName` (Task 1)
- Produces:

```ts
export interface HarnessToolSpec {
  readonly type: 'inline_function' | 'agentcore_code_interpreter';
  readonly name: string;
  readonly description?: string;              // inline_function のとき必須
  readonly inputSchema?: Record<string, unknown>; // inline_function のとき必須
}

export interface HarnessProps {
  readonly instance: string;
  readonly slug: string;
  readonly executionRoleArn: string;
  readonly modelId: string;
  readonly systemPrompt: string;
  readonly tools: readonly HarnessToolSpec[];
  readonly discoveryUrl: string;
  readonly allowedClientId: string;
}

export class Harness extends Construct {
  readonly harnessArn: string;   // CfnHarness.attrArn
  readonly harnessId: string;    // CfnHarness.attrHarnessId
  readonly harnessName: string;
}
```

- [ ] **Step 1: 失敗するテストを書く**

`infra/lib/harness.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { Harness } from './harness.js';

function synth() {
  const app = new App();
  const stack = new Stack(app, 'Test', {
    env: { account: '123456789012', region: 'ap-northeast-1' },
  });
  new Harness(stack, 'Harness', {
    instance: 'demo1',
    slug: 'smoke',
    executionRoleArn: 'arn:aws:iam::123456789012:role/role-name',
    modelId: 'jp.anthropic.claude-sonnet-4-5-20250929-v1:0',
    systemPrompt: 'あなたは検証用のエージェントです。',
    tools: [
      {
        type: 'inline_function',
        name: 'search',
        description: 'キーワードで検索する',
        inputSchema: { type: 'object', properties: { keyword: { type: 'string' } } },
      },
      { type: 'agentcore_code_interpreter', name: 'code' },
    ],
    discoveryUrl: 'https://example.invalid/.well-known/openid-configuration',
    allowedClientId: 'client-abc',
  });
  return Template.fromStack(stack);
}

describe('Harness', () => {
  it('SystemPrompt は [{ Text }] の配列で出る', () => {
    synth().hasResourceProperties('AWS::BedrockAgentCore::Harness', {
      SystemPrompt: [{ Text: 'あなたは検証用のエージェントです。' }],
    });
  });

  it('Memory を省略せず Disabled を明示する', () => {
    // 省略するとサービスが managed memory を勝手に用意してしまう
    synth().hasResourceProperties('AWS::BedrockAgentCore::Harness', {
      Memory: { Disabled: {} },
    });
  });

  it('HarnessName はハイフンを含まない', () => {
    synth().hasResourceProperties('AWS::BedrockAgentCore::Harness', {
      HarnessName: 'demo1_smoke',
    });
  });

  it('cognito:groups を CONTAINS で検証する', () => {
    synth().hasResourceProperties('AWS::BedrockAgentCore::Harness', {
      AuthorizerConfiguration: {
        CustomJWTAuthorizer: {
          DiscoveryUrl: 'https://example.invalid/.well-known/openid-configuration',
          AllowedClients: ['client-abc'],
          CustomClaims: [
            {
              InboundTokenClaimName: 'cognito:groups',
              InboundTokenClaimValueType: 'STRING_ARRAY',
              AuthorizingClaimMatchValue: {
                ClaimMatchValue: { MatchValueString: 'smoke' },
                ClaimMatchOperator: 'CONTAINS',
              },
            },
          ],
        },
      },
    });
  });

  it('ツールは Type / Name / Config の形で出る', () => {
    synth().hasResourceProperties('AWS::BedrockAgentCore::Harness', {
      Tools: [
        {
          Type: 'inline_function',
          Name: 'search',
          Config: {
            InlineFunction: {
              Description: 'キーワードで検索する',
              InputSchema: { type: 'object', properties: { keyword: { type: 'string' } } },
            },
          },
        },
        { Type: 'agentcore_code_interpreter', Name: 'code', Config: { AgentCoreCodeInterpreter: {} } },
      ],
    });
  });

  it('VPC を使わないので Environment を出さない', () => {
    const resources = synth().findResources('AWS::BedrockAgentCore::Harness');
    const props = Object.values(resources)[0].Properties;
    expect(props).not.toHaveProperty('Environment');
  });
});
```

- [ ] **Step 2: テストを流して失敗を確認する**

Run: `npx vitest run infra/lib/harness.test.ts`
Expected: FAIL。`./harness.js` が解決できない

- [ ] **Step 3: ラッパを書く**

`infra/lib/harness.ts`:

```ts
import { CfnHarness } from 'aws-cdk-lib/aws-bedrockagentcore';
import { Construct } from 'constructs';
import { toHarnessName } from './naming.js';

export interface HarnessToolSpec {
  readonly type: 'inline_function' | 'agentcore_code_interpreter';
  readonly name: string;
  /** inline_function のときだけ使う。 */
  readonly description?: string;
  /** inline_function のときだけ使う。 */
  readonly inputSchema?: Record<string, unknown>;
}

export interface HarnessProps {
  readonly instance: string;
  readonly slug: string;
  readonly executionRoleArn: string;
  readonly modelId: string;
  readonly systemPrompt: string;
  readonly tools: readonly HarnessToolSpec[];
  readonly discoveryUrl: string;
  readonly allowedClientId: string;
}

/**
 * AWS::BedrockAgentCore::Harness を作る。
 *
 * aws-cdk-lib の L1（CfnHarness）を使う。@aws/agentcore-cdk は L2 を持つが alpha 版で、
 * harness.json を置くディレクトリを必須にするため依存しない。
 *
 * 許容値の根拠は aws-facts.md にある。とくに inboundTokenClaimValueType は
 * STRING と STRING_ARRAY の 2 つだけで、STRING_LIST は存在しない。
 */
export class Harness extends Construct {
  readonly harnessArn: string;
  readonly harnessId: string;
  readonly harnessName: string;

  constructor(scope: Construct, id: string, props: HarnessProps) {
    super(scope, id);

    this.harnessName = toHarnessName(props.instance, props.slug);

    const resource = new CfnHarness(this, 'Resource', {
      harnessName: this.harnessName,
      executionRoleArn: props.executionRoleArn,
      model: { bedrockModelConfig: { modelId: props.modelId, apiFormat: 'converse_stream' } },
      // 文字列ではなく配列。text は minLength: 1
      systemPrompt: [{ text: props.systemPrompt }],
      tools: props.tools.map(toolToCfn),
      // 省略するとサービスが managed memory を勝手に用意する。無効を明示する
      memory: { disabled: {} },
      authorizerConfiguration: {
        customJwtAuthorizer: {
          discoveryUrl: props.discoveryUrl,
          allowedClients: [props.allowedClientId],
          customClaims: [
            {
              inboundTokenClaimName: 'cognito:groups',
              // 配列のうち少なくとも 1 つに一致するかを見る型
              inboundTokenClaimValueType: 'STRING_ARRAY',
              authorizingClaimMatchValue: {
                claimMatchValue: { matchValueString: props.slug },
                // cognito:groups は配列。EQUALS は STRING 型専用
                claimMatchOperator: 'CONTAINS',
              },
            },
          ],
        },
      },
      // environment は渡さない。VPC を使わないため
      // （networkConfiguration は createOnly で後から変えられない）
    });

    this.harnessArn = resource.attrArn;
    this.harnessId = resource.attrHarnessId;
  }
}

function toolToCfn(tool: HarnessToolSpec): CfnHarness.HarnessToolProperty {
  if (tool.type === 'agentcore_code_interpreter') {
    // codeInterpreterArn は省略可。省略すると組み込みが使われる
    return { type: tool.type, name: tool.name, config: { agentCoreCodeInterpreter: {} } };
  }
  if (!tool.description || !tool.inputSchema) {
    throw new Error(
      `inline_function のツール "${tool.name}" には description と inputSchema が必要です。`,
    );
  }
  return {
    type: tool.type,
    name: tool.name,
    config: { inlineFunction: { description: tool.description, inputSchema: tool.inputSchema } },
  };
}
```

- [ ] **Step 4: テストを流して通ることを確認する**

Run: `npx vitest run infra/lib/harness.test.ts`
Expected: PASS。6 件すべて緑

- [ ] **Step 5: コミット**

```bash
git add infra/lib/harness.ts infra/lib/harness.test.ts
git commit -m "$(cat <<'EOF'
feat: Harness のコンストラクトを追加

aws-cdk-lib の L1（CfnHarness）を使う。@aws/agentcore-cdk は L2 を持つが
0.1.0-alpha.46 で、harness.json を置くディレクトリを必須にする。構造を前提にする
仕組みを土台の中心部に埋めたくないので依存しない。

プロパティ名を手書きすると誤る。実際 inboundTokenClaimValueType を存在しない
STRING_LIST と書いていた（正しくは STRING_ARRAY）。L1 ならコンパイラが検査する。

Memory を省略しない。省略するとサービスが managed memory を勝手に用意する。
「メモリ無し」を意味させるには Disabled を明示する必要がある。テストで固定した。

SystemPrompt は文字列ではなく [{ Text }] の配列。これも間違えやすいので
テストで固定している。
EOF
)"
```

---

## Task 4: 案件設定の型と検証用案件

**Files:**
- Create: `infra/lib/demo-config.ts`
- Create: `demos/smoke/demo.ts`
- Create: `demos/smoke/seed/items.json`
- Create: `demos/smoke/tools.ts`
- Test: `demos/smoke/tools.test.ts`

**Interfaces:**
- Consumes: `HarnessToolSpec` (Task 3)
- Produces:
  - `interface DemoConfig { slug, clientName, brand, harness, examples }`
  - `demos/smoke/demo.ts` が `export const demo: DemoConfig`
  - `demos/smoke/tools.ts` が `export function search(input: { keyword: string }): string`

**注意:** `demos/smoke/` は**土台の検証専用**。商談用の案件ではない。
商談用の案件は必ず `new-demo` スキルから起こすこと（`CLAUDE.md`）。

- [ ] **Step 1: 型を書く**

`infra/lib/demo-config.ts`:

```ts
import type { HarnessToolSpec } from './harness.js';

export interface DemoConfig {
  /** URL とリソース名に使う。英数字とハイフン。 */
  readonly slug: string;
  /** 画面に出すクライアント名。 */
  readonly clientName: string;
  readonly brand: { readonly primary: string };
  readonly harness: {
    readonly modelId: string;
    /**
     * 必ず 3 点を含める（要件書 4.2）。
     * 1. 調べる順序  2. 根拠の示し方  3. 答えてはいけない条件
     */
    readonly systemPrompt: string;
    readonly tools: readonly HarnessToolSpec[];
  };
  /** 商談で見せる 3 問。3 つ目は「答えられない質問」を置く（要件書 4.2）。 */
  readonly examples: readonly [string, string, string];
}
```

- [ ] **Step 2: 検証用の seed を書く**

`demos/smoke/seed/items.json`:

```json
[
  { "id": "A-001", "keyword": "出張", "text": "出張の旅費精算は帰着後 5 営業日以内に申請する（規程 12 条）" },
  { "id": "A-002", "keyword": "経費", "text": "3 万円を超える経費は事前承認が必要（規程 8 条）" },
  { "id": "A-003", "keyword": "休暇", "text": "有給休暇は取得日の 3 営業日前までに申請する（規程 21 条）" }
]
```

- [ ] **Step 3: 失敗するテストを書く**

`demos/smoke/tools.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { search } from './tools.js';

describe('search', () => {
  it('キーワードに一致する項目を返す', () => {
    const result = search({ keyword: '出張' });
    expect(result).toContain('A-001');
    expect(result).toContain('規程 12 条');
  });

  it('一致しないときは見つからなかったと返す', () => {
    expect(search({ keyword: 'そんな制度はない' })).toContain('見つかりませんでした');
  });

  it('文字列を返す（toolResult.content は text のみ受け付けるため）', () => {
    expect(typeof search({ keyword: '経費' })).toBe('string');
  });
});
```

- [ ] **Step 4: テストを流して失敗を確認する**

Run: `npx vitest run demos/smoke/tools.test.ts`
Expected: FAIL。`./tools.js` が解決できない

- [ ] **Step 5: ツールを書く**

`demos/smoke/tools.ts`:

```ts
import items from './seed/items.json' with { type: 'json' };

/**
 * キーワードで seed を引く。
 *
 * 戻り値は必ず文字列。toolResult.content は text しか受け付けず、
 * json を渡すと unsupported type で拒否される（実測。aws-facts.md 参照）。
 */
export function search(input: { keyword: string }): string {
  const hits = items.filter(
    (item) => item.keyword.includes(input.keyword) || item.text.includes(input.keyword),
  );
  if (hits.length === 0) {
    return `「${input.keyword}」に該当する規程は見つかりませんでした。`;
  }
  return hits.map((h) => `[${h.id}] ${h.text}`).join('\n');
}
```

- [ ] **Step 6: テストを流して通ることを確認する**

Run: `npx vitest run demos/smoke/tools.test.ts`
Expected: PASS。3 件すべて緑

- [ ] **Step 7: 検証用案件の設定を書く**

`demos/smoke/demo.ts`:

```ts
import type { DemoConfig } from '../../infra/lib/demo-config.js';

/**
 * 土台の検証専用の案件。商談用ではない。
 * 商談用の案件は new-demo スキルから起こすこと。
 */
export const demo: DemoConfig = {
  slug: 'smoke',
  clientName: '検証用',
  brand: { primary: '#2563eb' },
  harness: {
    modelId: 'jp.anthropic.claude-sonnet-4-5-20250929-v1:0',
    systemPrompt: [
      'あなたは社内規程についての問い合わせに答えるアシスタントです。',
      '',
      '# 調べる順序',
      '1. 必ず最初に search ツールを呼び、キーワードで規程を引く',
      '2. 引けた内容だけを根拠にして答える',
      '',
      '# 根拠の示し方',
      '回答には必ず項番（A-001 など）と条番号を添える。',
      '',
      '# 答えてはいけない条件',
      '規程に書かれていない個別事情については判断しない。',
      'その場合は「規程には定めがないため、総務部への確認が必要です」と答え、',
      '何を確認すべきかを箇条書きで示す。推測で答えてはならない。',
    ].join('\n'),
    tools: [
      {
        type: 'inline_function',
        name: 'search',
        description: '社内規程をキーワードで検索する',
        inputSchema: {
          type: 'object',
          properties: { keyword: { type: 'string', description: '検索するキーワード' } },
          required: ['keyword'],
        },
      },
    ],
  },
  examples: [
    '出張の精算はいつまでに出せばいいですか',
    '5 万円の備品を買いたいのですが手続きは',
    // 3 つ目は答えられない質問。規程に無い個別事情
    '取引先との会食で 2 万円使いましたが、上司が立て替えた場合は誰が精算しますか',
  ],
};
```

- [ ] **Step 8: 全テストを流す**

Run: `npx vitest run`
Expected: PASS。Task 1〜4 のテストがすべて緑

- [ ] **Step 9: コミット**

```bash
git add infra/lib/demo-config.ts demos/smoke
git commit -m "$(cat <<'EOF'
feat: 案件設定の型と土台検証用の案件を追加

案件設定を YAML ではなく TypeScript にした。パーサも検証も要らず型で落ちる。
CDK とフロントが同じファイルを import できる（systemPrompt は Harness へ、
brand と examples は画面へ）。YAML だと両側にパーサと検証が要る。

demos/smoke は土台の検証専用で、商談用ではない。商談用の案件は new-demo から
起こす。答えてはいけないことは打ち合わせメモに絶対に書かれないため、
そこを聞き出す手順を飛ばすと何でも答えるデモができる。

tools は必ず文字列を返す。toolResult.content は text しか受け付けず、
json を渡すと unsupported type で拒否される。
EOF
)"
```

---

## Task 5: 案件スタックと CDK アプリ

**Files:**
- Create: `infra/lib/demo-stack.ts`
- Create: `infra/bin/app.ts`
- Test: `infra/lib/demo-stack.test.ts`

**Interfaces:**
- Consumes: `Harness` / `HarnessProps` (Task 3)、`DemoConfig` (Task 4)、
  土台の Export 名（Task 2）
- Produces: `class DemoStack extends Stack`、props は
  `DemoStackProps { instance: string; foundationStackName: string; demo: DemoConfig } & StackProps`

- [ ] **Step 1: 失敗するテストを書く**

`infra/lib/demo-stack.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { DemoStack } from './demo-stack.js';
import { demo } from '../../demos/smoke/demo.js';

function synth() {
  const app = new App();
  const stack = new DemoStack(app, 'FdeDemo-demo1-smoke', {
    instance: 'demo1',
    foundationStackName: 'FdeDemo-demo1-Foundation',
    demo,
    env: { account: '123456789012', region: 'ap-northeast-1' },
  });
  return Template.fromStack(stack);
}

describe('DemoStack', () => {
  it('案件ごとにグループを作る', () => {
    synth().hasResourceProperties('AWS::Cognito::UserPoolGroup', { GroupName: 'smoke' });
  });

  it('コールバックにブランチ URL と localhost の両方を登録する', () => {
    synth().hasResourceProperties('AWS::Cognito::UserPoolClient', {
      CallbackURLs: Match.arrayWith(['http://localhost:5173/']),
    });
  });

  it('Amplify ブランチを案件スタックが持つ', () => {
    synth().hasResourceProperties('AWS::Amplify::Branch', { BranchName: 'smoke' });
  });

  it('Harness を 1 つ作る', () => {
    synth().resourceCountIs('AWS::BedrockAgentCore::Harness', 1);
  });

  it('土台の値は ImportValue で引く（ハードコードしない）', () => {
    const json = JSON.stringify(synth().toJSON());
    expect(json).toContain('FdeDemo-demo1-Foundation-ExecutionRoleArn');
    expect(json).toContain('FdeDemo-demo1-Foundation-AmplifyAppId');
  });

  it('デモの URL と Harness ARN を出力する', () => {
    const outputs = synth().findOutputs('*');
    expect(Object.keys(outputs)).toEqual(
      expect.arrayContaining(['DemoUrl', 'HarnessArn']),
    );
  });
});
```

- [ ] **Step 2: テストを流して失敗を確認する**

Run: `npx vitest run infra/lib/demo-stack.test.ts`
Expected: FAIL。`./demo-stack.js` が解決できない

- [ ] **Step 3: 案件スタックを書く**

`infra/lib/demo-stack.ts`:

```ts
import {
  Stack,
  StackProps,
  CfnOutput,
  Fn,
  aws_cognito as cognito,
  aws_amplify as amplify,
} from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import { Harness } from './harness.js';
import type { DemoConfig } from './demo-config.js';

export interface DemoStackProps extends StackProps {
  readonly instance: string;
  /** 土台スタック名。Export 名の組み立てに使う。 */
  readonly foundationStackName: string;
  readonly demo: DemoConfig;
}

export class DemoStack extends Stack {
  constructor(scope: Construct, id: string, props: DemoStackProps) {
    super(scope, id, props);
    const { instance, foundationStackName, demo } = props;
    const slug = demo.slug;

    // 土台の値は ImportValue で引く。土台が案件に使われている間は土台を消せなくなるが、
    // それは望ましい挙動（撤去漏れがそのまま検出される）。
    const userPoolId = Fn.importValue(`${foundationStackName}-UserPoolId`);
    const discoveryUrl = Fn.importValue(`${foundationStackName}-DiscoveryUrl`);
    const amplifyAppId = Fn.importValue(`${foundationStackName}-AmplifyAppId`);
    const executionRoleArn = Fn.importValue(`${foundationStackName}-ExecutionRoleArn`);

    const branch = new amplify.CfnBranch(this, 'Branch', {
      appId: amplifyAppId,
      branchName: slug,
    });

    const demoUrl = `https://${slug}.${amplifyAppId}.amplifyapp.com`;

    // コールバック URL はワイルドカード不可。案件ごとに Client を作る。
    // localhost はローカル開発に要る。デモ用途なので残ることは許容する。
    const client = new cognito.CfnUserPoolClient(this, 'Client', {
      userPoolId,
      clientName: `${instance}-${slug}`,
      generateSecret: false,
      allowedOAuthFlows: ['code'],
      allowedOAuthScopes: ['openid', 'email'],
      allowedOAuthFlowsUserPoolClient: true,
      supportedIdentityProviders: ['COGNITO'],
      // `callbackUrLs` / `logoutUrLs` の綴りは誤字ではない。CFn の CallbackURLs を
      // jsii が変換した結果であり、これが aws-cdk-lib の正しいプロパティ名。直さないこと
      callbackUrLs: [`${demoUrl}/`, 'http://localhost:5173/'],
      logoutUrLs: [`${demoUrl}/`, 'http://localhost:5173/'],
    });

    // 案件ごとのグループ。Harness がこの名前を cognito:groups に CONTAINS で探す。
    new cognito.CfnUserPoolGroup(this, 'Group', {
      userPoolId,
      groupName: slug,
    });

    const harness = new Harness(this, 'Harness', {
      instance,
      slug,
      executionRoleArn,
      modelId: demo.harness.modelId,
      systemPrompt: demo.harness.systemPrompt,
      tools: demo.harness.tools,
      discoveryUrl,
      allowedClientId: client.ref,
    });

    new CfnOutput(this, 'DemoUrl', { value: demoUrl });
    new CfnOutput(this, 'HarnessArn', { value: harness.harnessArn });
    new CfnOutput(this, 'ClientId', { value: client.ref });
    new CfnOutput(this, 'BranchName', { value: branch.branchName });
  }
}
```

- [ ] **Step 4: テストを流して通ることを確認する**

Run: `npx vitest run infra/lib/demo-stack.test.ts`
Expected: PASS。6 件すべて緑

- [ ] **Step 5: CDK アプリを書く**

`infra/bin/app.ts`:

```ts
import { App } from 'aws-cdk-lib';
import { FoundationStack } from '../lib/foundation-stack.js';
import { DemoStack } from '../lib/demo-stack.js';
import { demo as smoke } from '../../demos/smoke/demo.js';

const app = new App();

// 同一アカウントに複数の土台を置けることを前提にする。省略は許さない。
const instance = app.node.tryGetContext('instance');
if (!instance) {
  throw new Error('instance が指定されていません。`cdk deploy -c instance=<name>` で渡してください。');
}

const env = { region: 'ap-northeast-1', account: process.env.CDK_DEFAULT_ACCOUNT };

const foundationStackName = `FdeDemo-${instance}-Foundation`;
new FoundationStack(app, foundationStackName, { instance, env });

for (const demo of [smoke]) {
  new DemoStack(app, `FdeDemo-${instance}-${demo.slug}`, {
    instance,
    foundationStackName,
    demo,
    env,
  });
}
```

- [ ] **Step 6: synth が通ることを確認する**

Run: `npx cdk synth -c instance=demo1 --quiet`
Expected: エラーなく終わる。`cdk.out/` にテンプレートができる

- [ ] **Step 7: `instance` 未指定で落ちることを確認する**

Run: `npx cdk synth --quiet`
Expected: FAIL。`instance が指定されていません` が出る

- [ ] **Step 8: コミット**

```bash
git add infra/lib/demo-stack.ts infra/lib/demo-stack.test.ts infra/bin/app.ts
git commit -m "$(cat <<'EOF'
feat: 案件スタックと CDK アプリを追加

土台の値は Export/ImportValue で引く。土台が案件に使われている間は土台を
消せなくなるが、それは望ましい。撤去漏れがそのまま検出される。

コールバック URL はワイルドカードが使えないため、User Pool Client は案件ごとに作る。
localhost も同じ Client に登録する。ローカルでストリーム形状を確かめるのに要る。
デモ用途なので開発用 URL が残ることは許容する。

instance は省略できない。同一アカウントに複数の土台を置けることを前提にしており、
Cognito のドメインプレフィックスはリージョン内で全アカウント共通の名前空間のため。
EOF
)"
```

---

## Task 6: デプロイして未確認 2〜5 を潰す

**Files:**
- Modify: `.claude/skills/aws-fact-check/references/aws-facts.md`
- Modify: `docs/superpowers/specs/2026-08-08-what-to-build-design.md:286-300`（5 章の表）

**Interfaces:**
- Consumes: Task 5 までの全成果物
- Produces: 実測値。以降のタスクと次の計画が前提にする

**このタスクは AWS にリソースを作る。課金が発生する。**

- [ ] **Step 1: 今の稼働数を控える**

Run: `aws bedrock-agentcore-control list-harnesses --region ap-northeast-1 --query 'length(harnesses)'`
Expected: 数値が出る。この後の増分を見るために控えておく

- [ ] **Step 2: 土台をデプロイし、所要時間を測る**

Run:
```bash
time npx cdk deploy FdeDemo-demo1-Foundation -c instance=demo1 --require-approval never
```
Expected: `CREATE_COMPLETE`。出力に `UserPoolId` / `DiscoveryUrl` / `AmplifyAppId` /
`ExecutionRoleArn` の 4 つが出る。**所要時間を記録する**（前身の実績は 50 秒）

- [ ] **Step 3: 未確認 5 を確かめる（Cognito ユーザー作成）**

Run:
```bash
aws cognito-idp admin-create-user --region ap-northeast-1 \
  --user-pool-id <Step 2 の UserPoolId> \
  --username demo@example.com \
  --message-action SUPPRESS \
  --generate-cli-skeleton
```
Expected: スケルトンが出る。`TemporaryPassword` がリクエストに含まれるかを見る。
**含まれるなら**、CFn の `AWS::Cognito::UserPoolUser` にも同等の手段があるか
`aws cloudformation describe-type --type RESOURCE --type-name AWS::Cognito::UserPoolUser`
で確かめる。結果を `aws-facts.md` に 1 行足す

- [ ] **Step 4: 案件をデプロイし、所要時間を測る（未確認 4）**

Run:
```bash
time npx cdk deploy FdeDemo-demo1-smoke -c instance=demo1 --require-approval never
```
Expected: `CREATE_COMPLETE`。出力に `DemoUrl` / `HarnessArn` / `ClientId` / `BranchName`。
**所要時間を記録する。** 前身の実績は `217〜256 秒`

**ここが大幅に悪化していたら止まること。** 設計書 5 章の未確認 4 は方針を覆しうる。
その場合は先に進まず、`DECISIONS.md` に実測値と判断を書いてから相談する

- [ ] **Step 5: 未確認 2 を確かめる（CFn が READY を待つか）**

Run:
```bash
aws bedrock-agentcore-control list-harnesses --region ap-northeast-1 \
  --query "harnesses[?harnessName=='demo1_smoke'].{name:harnessName,status:status}"
```
Expected: `status` が出る。`CREATE_COMPLETE` 直後に `READY` なら CFn は待っている。
`CREATING` なら待っていない。**待っていない場合は次を足す**:

`infra/lib/demo-stack.ts` の末尾に確認用の出力を足し、手順書側で
`aws bedrock-agentcore-control get-harness --harness-id <id>` を回す手順を書く

- [ ] **Step 6: 未確認 3 を確かめる（Amplify ブランチ）**

Run:
```bash
aws amplify list-branches --region ap-northeast-1 --app-id <Step 2 の AmplifyAppId> \
  --query 'branches[].{name:branchName,stage:stage,active:activeJobId}'
```
Expected: `smoke` ブランチが存在する。`activeJobId` は**空のはず**
（リポジトリを接続していないのでビルドは走らない）。
`start-deployment` で ZIP を上げる方式が成立することをここで確認する:

```bash
aws amplify start-deployment --region ap-northeast-1 --generate-cli-skeleton
```
Expected: `sourceUrl` を取るリクエスト形状が出る。**結果を `aws-facts.md` に足す**

- [ ] **Step 7: 実測を `aws-facts.md` に書く**

`.claude/skills/aws-fact-check/references/aws-facts.md` の
「公式ツール群（2026-08-08 確認）」の下に節を足す:

```markdown
### CFn での構築（実測）

| 項目 | 実測値 |
|---|---|
| 土台スタックのデプロイ | <Step 2 の時間> |
| 案件スタックのデプロイ | <Step 4 の時間> |
| CFn は Harness の READY を待つか | <Step 5 の結果> |
| CFn で作った Amplify ブランチ | <Step 6 の結果> |
| Cognito ユーザーを CFn で作れるか | <Step 3 の結果> |
```

- [ ] **Step 8: 設計書の未確認表を更新する**

`docs/superpowers/specs/2026-08-08-what-to-build-design.md` の 5 章で、
潰した行に `**解決（2026-08-08）** — <結果>` を追記する。**行は消さない**
（何を疑って何が分かったかが次の判断材料になる）

- [ ] **Step 9: コミット**

```bash
git add .claude/skills/aws-fact-check/references/aws-facts.md docs/superpowers/specs/2026-08-08-what-to-build-design.md
git commit -m "$(cat <<'EOF'
docs: CFn 構築の実測値を記録し、未確認 2〜5 を潰した

設計書は 5 件の未確認を推測で埋めずに残していた。うち 4 件を実測で潰した。
残る 1 件（InvokeHarness のストリーム形状）は次のタスクで潰す。

行は消さずに解決を追記した。何を疑って何が分かったかが次の判断材料になる。
EOF
)"
```

---

## Task 7: event stream のデコーダとパーサ

**Files:**
- Create: `web/src/agent/eventstream.ts`
- Create: `web/src/agent/streamParser.ts`
- Test: `web/src/agent/eventstream.test.ts`
- Test: `web/src/agent/streamParser.test.ts`

**Interfaces:**
- Consumes: なし（AWS 不要。純粋関数）
- Produces:
  - `createFrameDecoder(): { push(chunk: Uint8Array): Frame[] }` — 状態を持つ。
    チャンクを渡すと、その時点で揃ったフレームだけを返す
  - `interface Frame { headers: Record<string, string>; payload: Uint8Array }`
  - `parseFrame(frame: Frame): StreamEvent | null`
  - `type StreamEvent = { kind: 'text'; text: string } | { kind: 'toolUse'; toolUseId: string; name: string }
     | { kind: 'toolResult'; toolUseId: string; status: string } | { kind: 'stop'; reason: string }
     | { kind: 'error'; message: string }`

**フレーム構造**（実測済み。`aws-facts.md`）:

```
[total length: 4][headers length: 4][prelude CRC: 4][headers][payload][message CRC: 4]
ヘッダ: [name length: 1][name][value type: 1][value]   ※ type 7 = string（長さは 2 バイト）
イベント名は :event-type、例外は :exception-type ヘッダ
```

- [ ] **Step 1: 失敗するテストを書く**

`web/src/agent/eventstream.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createFrameDecoder } from './eventstream.js';

/** テスト用に 1 フレームを組み立てる。CRC は検証しないので 0 で埋める。 */
function buildFrame(eventType: string, payload: string): Uint8Array {
  const enc = new TextEncoder();
  const name = ':event-type';
  const nameBytes = enc.encode(name);
  const valueBytes = enc.encode(eventType);
  // [name len:1][name][type:1][value len:2][value]
  const headersLen = 1 + nameBytes.length + 1 + 2 + valueBytes.length;
  const payloadBytes = enc.encode(payload);
  const total = 4 + 4 + 4 + headersLen + payloadBytes.length + 4;

  const buf = new Uint8Array(total);
  const view = new DataView(buf.buffer);
  let o = 0;
  view.setUint32(o, total); o += 4;
  view.setUint32(o, headersLen); o += 4;
  view.setUint32(o, 0); o += 4;           // prelude CRC（検証しない）
  buf[o] = nameBytes.length; o += 1;
  buf.set(nameBytes, o); o += nameBytes.length;
  buf[o] = 7; o += 1;                      // type 7 = string
  view.setUint16(o, valueBytes.length); o += 2;
  buf.set(valueBytes, o); o += valueBytes.length;
  buf.set(payloadBytes, o); o += payloadBytes.length;
  view.setUint32(o, 0);                    // message CRC（検証しない）
  return buf;
}

describe('createFrameDecoder', () => {
  it('1 フレームを復号する', () => {
    const frame = buildFrame('contentBlockDelta', '{"delta":{"text":"こんにちは"}}');
    const frames = createFrameDecoder().push(frame);
    expect(frames).toHaveLength(1);
    expect(frames[0].headers[':event-type']).toBe('contentBlockDelta');
    expect(new TextDecoder().decode(frames[0].payload)).toContain('こんにちは');
  });

  it('フレーム境界をまたぐ分割入力を復号する', () => {
    // 前身ではここが実際に起きた。7 バイトずつに割って通す
    const frame = buildFrame('contentBlockDelta', '{"delta":{"text":"分割"}}');
    const decoder = createFrameDecoder();
    const collected = [];
    for (let i = 0; i < frame.length; i += 7) {
      collected.push(...decoder.push(frame.slice(i, i + 7)));
    }
    expect(collected).toHaveLength(1);
    expect(new TextDecoder().decode(collected[0].payload)).toContain('分割');
  });

  it('1 チャンクに 2 フレームが入っていても両方返す', () => {
    const a = buildFrame('messageStart', '{}');
    const b = buildFrame('messageStop', '{"stopReason":"end_turn"}');
    const merged = new Uint8Array(a.length + b.length);
    merged.set(a, 0);
    merged.set(b, a.length);
    expect(createFrameDecoder().push(merged)).toHaveLength(2);
  });

  it('フレームが揃うまでは何も返さない', () => {
    const frame = buildFrame('messageStart', '{}');
    expect(createFrameDecoder().push(frame.slice(0, 5))).toHaveLength(0);
  });
});
```

- [ ] **Step 2: テストを流して失敗を確認する**

Run: `npx vitest run web/src/agent/eventstream.test.ts`
Expected: FAIL。`./eventstream.js` が解決できない

- [ ] **Step 3: デコーダを書く**

`web/src/agent/eventstream.ts`:

```ts
export interface Frame {
  readonly headers: Record<string, string>;
  readonly payload: Uint8Array;
}

/**
 * application/vnd.amazon.eventstream のデコーダ。
 *
 * フレーム構造（実測。aws-facts.md 参照）:
 *   [total length: 4][headers length: 4][prelude CRC: 4][headers][payload][message CRC: 4]
 *   ヘッダ: [name length: 1][name][value type: 1][value]  ※ type 7 = string（長さ 2 バイト）
 *
 * CRC は検証しない。デモ基盤であり、壊れたフレームは JSON パースの時点で落ちる。
 *
 * チャンクはフレーム境界をまたいで届く。状態を持ち、揃ったフレームだけ返す。
 */
export function createFrameDecoder(): { push(chunk: Uint8Array): Frame[] } {
  let buffer = new Uint8Array(0);

  return {
    push(chunk: Uint8Array): Frame[] {
      const merged = new Uint8Array(buffer.length + chunk.length);
      merged.set(buffer, 0);
      merged.set(chunk, buffer.length);
      buffer = merged;

      const frames: Frame[] = [];
      while (buffer.length >= 12) {
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        const total = view.getUint32(0);
        if (buffer.length < total) break;

        const headersLen = view.getUint32(4);
        const headersStart = 12;
        const payloadStart = headersStart + headersLen;
        const payloadEnd = total - 4;

        frames.push({
          headers: parseHeaders(buffer.subarray(headersStart, payloadStart)),
          payload: buffer.slice(payloadStart, payloadEnd),
        });
        buffer = buffer.slice(total);
      }
      return frames;
    },
  };
}

function parseHeaders(bytes: Uint8Array): Record<string, string> {
  const decoder = new TextDecoder();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headers: Record<string, string> = {};
  let o = 0;

  while (o < bytes.length) {
    const nameLen = bytes[o];
    o += 1;
    const name = decoder.decode(bytes.subarray(o, o + nameLen));
    o += nameLen;
    const type = bytes[o];
    o += 1;
    if (type !== 7) {
      // string 以外は使っていない。読み飛ばせないので打ち切る
      break;
    }
    const valueLen = view.getUint16(o);
    o += 2;
    headers[name] = decoder.decode(bytes.subarray(o, o + valueLen));
    o += valueLen;
  }
  return headers;
}
```

- [ ] **Step 4: テストを流して通ることを確認する**

Run: `npx vitest run web/src/agent/eventstream.test.ts`
Expected: PASS。4 件すべて緑

- [ ] **Step 5: パーサの失敗するテストを書く**

`web/src/agent/streamParser.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseFrame } from './streamParser.js';

function frame(eventType: string, body: unknown) {
  return {
    headers: { ':event-type': eventType },
    payload: new TextEncoder().encode(JSON.stringify(body)),
  };
}

describe('parseFrame', () => {
  it('本文の差分を text として返す', () => {
    const e = parseFrame(frame('contentBlockDelta', { delta: { text: 'こんにちは' } }));
    expect(e).toEqual({ kind: 'text', text: 'こんにちは' });
  });

  it('toolUse の開始を返す', () => {
    const e = parseFrame(
      frame('contentBlockStart', { start: { toolUse: { toolUseId: 'tu-1', name: 'search' } } }),
    );
    expect(e).toEqual({ kind: 'toolUse', toolUseId: 'tu-1', name: 'search' });
  });

  it('toolResult を返す', () => {
    const e = parseFrame(
      frame('contentBlockStart', { start: { toolResult: { toolUseId: 'tu-1', status: 'success' } } }),
    );
    expect(e).toEqual({ kind: 'toolResult', toolUseId: 'tu-1', status: 'success' });
  });

  it('stopReason を返す', () => {
    expect(parseFrame(frame('messageStop', { stopReason: 'tool_use' })))
      .toEqual({ kind: 'stop', reason: 'tool_use' });
  });

  it('例外ヘッダを error として返す', () => {
    const e = parseFrame({
      headers: { ':exception-type': 'internalServerException' },
      payload: new TextEncoder().encode(JSON.stringify({ message: '落ちた' })),
    });
    expect(e).toEqual({ kind: 'error', message: '落ちた' });
  });

  it('知らないイベントは null を返す', () => {
    expect(parseFrame(frame('messageStart', {}))).toBeNull();
  });
});
```

- [ ] **Step 6: テストを流して失敗を確認する**

Run: `npx vitest run web/src/agent/streamParser.test.ts`
Expected: FAIL。`./streamParser.js` が解決できない

- [ ] **Step 7: パーサを書く**

`web/src/agent/streamParser.ts`:

```ts
import type { Frame } from './eventstream.js';

export type StreamEvent =
  | { kind: 'text'; text: string }
  | { kind: 'toolUse'; toolUseId: string; name: string }
  | { kind: 'toolResult'; toolUseId: string; status: string }
  | { kind: 'stop'; reason: string }
  | { kind: 'error'; message: string };

/**
 * フレームを 1 つ、画面が扱える形に変換する。
 *
 * イベント名は Bedrock Converse と同じ（実測。aws-facts.md 参照）。
 * 知らないイベントは null を返して捨てる。増えても壊れないようにするため。
 */
export function parseFrame(frame: Frame): StreamEvent | null {
  const exceptionType = frame.headers[':exception-type'];
  const body = decodeJson(frame.payload);

  if (exceptionType) {
    return { kind: 'error', message: String(body?.message ?? exceptionType) };
  }

  switch (frame.headers[':event-type']) {
    case 'contentBlockDelta': {
      const text = body?.delta?.text;
      return typeof text === 'string' ? { kind: 'text', text } : null;
    }
    case 'contentBlockStart': {
      const start = body?.start;
      if (start?.toolUse) {
        return { kind: 'toolUse', toolUseId: start.toolUse.toolUseId, name: start.toolUse.name };
      }
      if (start?.toolResult) {
        return {
          kind: 'toolResult',
          toolUseId: start.toolResult.toolUseId,
          status: start.toolResult.status ?? 'success',
        };
      }
      return null;
    }
    case 'messageStop':
      return { kind: 'stop', reason: String(body?.stopReason ?? 'end_turn') };
    default:
      return null;
  }
}

/** payload の形はイベント種別ごとに違う。呼び出し側の switch で絞る。 */
function decodeJson(payload: Uint8Array): any {
  try {
    return JSON.parse(new TextDecoder().decode(payload));
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 8: 全テストを流す**

Run: `npx vitest run`
Expected: PASS。Task 1〜7 のテストがすべて緑

- [ ] **Step 9: コミット**

```bash
git add web/src/agent
git commit -m "$(cat <<'EOF'
feat: event stream のデコーダとパーサを追加

@aws-sdk/client-bedrock-agentcore は InvokeHarness を持ち復号もするが、
認証スキームが aws.auth#sigv4 だけで httpBearerAuth が無い。Harness を
customJWTAuthorizer で保護する限り使えないため、自前で復号する。

CRC は検証しない。デモ基盤であり、壊れたフレームは JSON パースで落ちる。

チャンクはフレーム境界をまたいで届く。前身で実際に起きたので、
7 バイトずつに割った入力を通すテストを最初から入れてある。

知らないイベントは捨てる。イベント種別が増えても壊れないようにするため。
EOF
)"
```

---

## Task 8: 実測でストリーム形状を確かめる（未確認 1）

**Files:**
- Create: `scripts/probe-harness.ts`
- Modify: `.claude/skills/aws-fact-check/references/aws-facts.md`
- Modify: `docs/superpowers/specs/2026-08-08-what-to-build-design.md`（5 章の未確認 1）

**Interfaces:**
- Consumes: `createFrameDecoder` / `parseFrame` (Task 7)、Task 6 でデプロイした Harness
- Produces: 実測で確認したストリーム形状。次の計画（フロント）の前提になる

- [ ] **Step 1: デモユーザーを作り、グループに入れる**

**パスワードをこのファイルに書かないこと。** 実行する人がその場で決め、
シェル変数に入れて使う。リポジトリに残すと、そのまま使われて git 履歴に入る。

```bash
POOL=<Task 6 Step 2 の UserPoolId>
read -rs -p 'デモユーザーのパスワード: ' DEMO_PASSWORD; echo

aws cognito-idp admin-create-user --region ap-northeast-1 \
  --user-pool-id "$POOL" --username demo@example.com --message-action SUPPRESS
aws cognito-idp admin-set-user-password --region ap-northeast-1 \
  --user-pool-id "$POOL" --username demo@example.com --password "$DEMO_PASSWORD" --permanent
aws cognito-idp admin-add-user-to-group --region ap-northeast-1 \
  --user-pool-id "$POOL" --username demo@example.com --group-name smoke
```
Expected: どれもエラーなく終わる。
`demo@example.com` は RFC 2606 の文書用予約ドメインなので、実在の宛先には届かない

- [ ] **Step 2: アクセストークンを取る**

```bash
aws cognito-idp initiate-auth --region ap-northeast-1 \
  --client-id <Task 6 Step 4 の ClientId> \
  --auth-flow USER_PASSWORD_AUTH \
  --auth-parameters "USERNAME=demo@example.com,PASSWORD=$DEMO_PASSWORD" \
  --query 'AuthenticationResult.AccessToken' --output text
```
Expected: JWT が出る。**ID トークンではなくアクセストークンを使う**
（ID トークンには `client_id` クレームが無く `allowedClients` の検証に落ちて 500 になる）

**`USER_PASSWORD_AUTH` が無効で落ちたら**、`infra/lib/demo-stack.ts` の
`CfnUserPoolClient` に `explicitAuthFlows: ['ALLOW_USER_PASSWORD_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH']`
を足して再デプロイする

- [ ] **Step 3: 実測用のスクリプトを書く**

`scripts/probe-harness.ts`:

```ts
/**
 * InvokeHarness を叩いて、生イベントと解釈結果の両方を出す。
 *
 * 設計書 5 章の未確認 1（ストリーム形状）を潰すためのもの。
 * 型定義と公式実装からの推定が実際と合っているかを確かめる。
 *
 * 使い方:
 *   HARNESS_ARN=... ACCESS_TOKEN=... npx tsx scripts/probe-harness.ts "出張の精算は"
 */
import { createFrameDecoder } from '../web/src/agent/eventstream.js';
import { parseFrame } from '../web/src/agent/streamParser.js';

const harnessArn = requireEnv('HARNESS_ARN');
const accessToken = requireEnv('ACCESS_TOKEN');
const region = 'ap-northeast-1';
const prompt = process.argv[2] ?? 'こんにちは';

// runtimeSessionId は英数字のみ 33〜100 文字（実測）
const sessionId = 'probe' + '0'.repeat(28) + Date.now().toString().slice(-5);

const url =
  `https://bedrock-agentcore.${region}.amazonaws.com/harnesses/invoke` +
  `?harnessArn=${encodeURIComponent(harnessArn)}`;

const res = await fetch(url, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    runtimeSessionId: sessionId,
    messages: [{ role: 'user', content: [{ text: prompt }] }],
  }),
});

console.log('status:', res.status, res.statusText);
console.log('content-type:', res.headers.get('content-type'));
if (!res.ok || !res.body) {
  console.log('body:', await res.text());
  process.exit(1);
}

const decoder = createFrameDecoder();
const reader = res.body.getReader();
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  for (const frame of decoder.push(value)) {
    console.log('--- frame ---');
    console.log('headers:', frame.headers);
    console.log('payload:', new TextDecoder().decode(frame.payload));
    console.log('parsed :', parseFrame(frame));
  }
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`環境変数 ${name} が必要です`);
  return v;
}
```

- [ ] **Step 4: 実測する**

```bash
HARNESS_ARN=<Task 6 Step 4 の HarnessArn> \
ACCESS_TOKEN=<Step 2 のトークン> \
npx tsx scripts/probe-harness.ts "出張の精算はいつまでですか"
```
Expected: `status: 200`、`content-type: application/vnd.amazon.eventstream`。
フレームが順に出て、`parsed` に `text` / `toolUse` / `stop` が現れる。
**`stopReason: tool_use` で止まるはず**（`inline_function` は return-of-control のため）

- [ ] **Step 5: 3 つ目の質問（答えられない質問）でも叩く**

```bash
HARNESS_ARN=... ACCESS_TOKEN=... npx tsx scripts/probe-harness.ts \
  "取引先との会食で 2 万円使いましたが、上司が立て替えた場合は誰が精算しますか"
```
Expected: 同じくストリームが返る。**この時点では回答内容の質は見ない**
（ツールループがまだ無いので `tool_use` で止まる）。**形状だけ確かめる**

- [ ] **Step 6: 別グループのトークンで弾かれることを確かめる**

```bash
aws cognito-idp admin-remove-user-from-group --region ap-northeast-1 \
  --user-pool-id "$POOL" --username demo@example.com --group-name smoke
# トークンを取り直してから
HARNESS_ARN=... ACCESS_TOKEN=<取り直したトークン> npx tsx scripts/probe-harness.ts "こんにちは"
```
Expected: **403 で弾かれる。** ここが通ってしまうと案件の分離が効いていない。
確認後、グループに戻す:
```bash
aws cognito-idp admin-add-user-to-group --region ap-northeast-1 \
  --user-pool-id "$POOL" --username demo@example.com --group-name smoke
```

- [ ] **Step 7: 実測を `aws-facts.md` に反映する**

「InvokeHarness のストリームは Converse 形式」の節から
**「実際に呼んで確かめてはいない」を削除**し、実測で分かったことに書き換える。
推定と違っていた点があれば、それを目立つ形で書く。
`parseFrame` が想定と違っていたら Task 7 のコードとテストも直す

- [ ] **Step 8: 設計書の未確認 1 を解決にする**

`docs/superpowers/specs/2026-08-08-what-to-build-design.md` の 5 章、
未確認 1 の行に `**解決（2026-08-08）** — <結果>` を追記する。行は消さない

- [ ] **Step 9: コミット**

```bash
git add scripts/probe-harness.ts .claude/skills/aws-fact-check/references/aws-facts.md docs/superpowers/specs/2026-08-08-what-to-build-design.md web/src/agent
git commit -m "$(cat <<'EOF'
feat: InvokeHarness のストリーム形状を実測し、未確認 1 を潰した

設計書は「型定義と公式実装からの推定であって、実際に呼んでいない」と
明記していた。土台ができたので実測に置き換えた。

グループから外したトークンで 403 になることも確かめた。案件の分離は
Harness の CustomJWTAuthorizer が cognito:groups を CONTAINS で検証して行うので、
ここが通ってしまうと要件書 4.1「他案件の画面に入れない」が成立しない。

probe-harness.ts は残す。仕様が変わったとき同じ確認を最短で回せる。
EOF
)"
```

---

## この計画を終えた時点の状態

| | |
|---|---|
| デプロイ済み | 土台スタック 1 つ、案件スタック 1 つ（`smoke`） |
| 動くこと | Cognito でログインしたユーザーのトークンで `InvokeHarness` が叩ける |
| 分離の確認 | グループ外のトークンは 403 |
| テスト済み | `harnessName` の検証、CFn プロパティ、デコーダ、パーサ、案件のツール |
| 潰した未確認 | 5 件すべて |
| **無いもの** | **画面。まだクライアントには見せられない** |

## 撤去

検証用の案件を残さないこと。**Harness は課金対象。**

```bash
npx cdk destroy FdeDemo-demo1-smoke -c instance=demo1
npx cdk destroy FdeDemo-demo1-Foundation -c instance=demo1
```

削除後は `cleanup-check` スキルで残骸を確かめる。Harness の削除は数分かかり、
完了前に同名で作ると `ConflictException` になる。

## 次の計画

フロント（設計書の手順 4〜6）と手順書（手順 7）。
**この計画の Task 6 Step 4 で測った案件デプロイ所要時間を見てから書く。**
`217〜256 秒` から大幅に悪化していれば、先に `DECISIONS.md` で方針を見直す。
