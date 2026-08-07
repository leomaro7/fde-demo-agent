# 実測で確定した AWS 仕様

前身のプロジェクトで**実際に呼んで確かめた**もの。ここに載っているものは
再調査しなくてよい。**載っていないものは推測せず、SKILL.md の手順で確認する。**

新しく確定したものはここに追記する。

## AgentCore Harness

| 項目 | 事実 |
|---|---|
| `InvokeHarness` の URL | `POST /harnesses/invoke?harnessArn={arn}&qualifier={q}` — **ARN はクエリパラメータ**（パスではない） |
| ストリーム形式 | **`application/vnd.amazon.eventstream`（バイナリ）**。JSON Lines ではない |
| 使うトークン | **アクセストークン**。ID トークンには `client_id` クレームがなく `allowedClients` の検証に落ちて 500 |
| `toolResult.content` | **`text` のみ**。`json` は `unsupported type` で拒否される |
| `harnessName` | 英数字とアンダースコアのみ、先頭は文字、40 文字以内。**ハイフン不可** |
| `runtimeSessionId` | **英数字のみ**、33〜100 文字 |
| JWT 認証 | `authorizerConfiguration.customJWTAuthorizer`（**JWT は大文字**） |
| クレーム検証 | `customClaims[].authorizingClaimMatchValue`。`cognito:groups` は配列なので **`CONTAINS`**（`EQUALS` は STRING 型専用） |
| `memory` | Union。`managedMemoryConfiguration` / `agentCoreMemoryConfiguration` / `disabled`。`arn` は省略可 |
| ツールの `type` | `remote_mcp` / `agentcore_code_interpreter` / `agentcore_gateway` / `agentcore_browser` / `inline_function`。**`agent_core_` ではない** |
| Code Interpreter / Browser | `codeInterpreterArn` / `browserArn` は省略可（組み込みが使われる） |
| `DeleteHarness` / `GetHarness` | 名前ではなく **`harnessId`**。名前から引くには `ListHarnesses` |
| 作成の完了判定 | **必ず `READY` を待つ（約 140 秒）**。`CreateHarness` が成功を返してもバリデーションは非同期で走り、後から `CREATE_FAILED` になる |
| 削除 | **数分かかる**。完了前に同名で作ると `ConflictException` |
| CORS | **通る**。`access-control-allow-origin: *`。ブラウザから直接叩ける |
| ファイルマウント | Session storage 以外（S3 Files / EFS）は **VPC 必須** |
| `inline_function` | **サーバー側で実行されない**。`stopReason: "tool_use"` で返り、呼び出し側が結果を返す（return-of-control） |

### 公式ツール群（2026-08-08 確認）

要件書 7.0 の「確認していないこと」に対する回答。**再調査不要。**

| 項目 | 事実 |
|---|---|
| `AWS::BedrockAgentCore::Harness` | **存在する**。`describe-type` で `LIVE` / `FULLY_MUTABLE`。ただし `LatestPublicVersion` は `null`（公開レジストリに版が無い＝プライベート登録） |
| `@aws/agentcore-cdk` | **Harness を扱える**。`AgentCoreHarness`（`AWS::BedrockAgentCore::Harness` を CfnResource で生成）と `AgentCoreHarnessEnvironment`（+ 実行ロール）がある。版は **`0.1.0-alpha.46`（alpha）** |
| aws-cdk-lib の L1 | **`CfnHarness` は無い**。上記コンストラクトも生の `CfnResource` で回避している（パッケージ内コメントに明記） |
| CDK が対応する認証 | `AuthorizerConfiguration.CustomJWTAuthorizer` を `DiscoveryUrl` / `AllowedClients` / `CustomClaims` まで写像する。**Cognito グループでの案件分離は CDK だけで書ける** |
| CFn のツール種別 | `RemoteMcp` / `AgentCoreGateway` / `AgentCoreBrowser` / `AgentCoreCodeInterpreter` / `InlineFunction`。**API と同じ 5 種** |
| `HarnessName` | CFn では **createOnly**。物理名は `${projectName}_${name}`、**40 文字以内**（CDK が synth 前に検証する） |
| AgentCore CLI | `npm i -g @aws/agentcore`（`0.26.0`）。**`harness` サブコマンドがある**。`create` / `deploy` / `dev` / `invoke` ほか |
| CLI の設定ファイル | `agentcore/agentcore.json`（プロジェクト）+ **`harness.json`**（Harness ごと）。`agentcore/cdk` に CDK アプリを生成する。**CLI は CDK のジェネレータ** |
| `invoke-harness` の CLI 対応 | **aws-cli 2.35.21 には無い**（`bedrock-agentcore` に `invoke-agent-runtime` / `invoke-browser` のみ）。boto3 には `invoke_harness` がある。CLI で叩けないことを API が無い証拠にしない |

### InvokeHarness のストリームは Converse 形式

**要件書 7.0 の「Harness 側でツール実行したときブラウザへどう返るか」の答え。**

`response["stream"]` に流れるイベントは Bedrock Converse と同じ形。

```
messageStart / contentBlockStart / contentBlockDelta / contentBlockStop
messageStop / metadata / internalServerException
```

- `contentBlockStart.start.toolUse` に `{ toolUseId, name }`
- **`contentBlockStart.start.toolResult` に `{ status }`**（`error` / それ以外）
- `contentBlockDelta.delta.text` が本文。`reasoningContent` / `reasoningText` もある
- `metadata.usage`（`inputTokens` / `outputTokens`）と `metadata.metrics.latencyMs`

**`toolUse` と `toolResult` の両方がストリームに乗る。** つまり
**Harness にツールを実行させても実行トレースは取れる**（要件書 4.1 の差別化点は
`inline_function` に依存しない）。

出典は `@aws/agentcore@0.26.0` 同梱の `dist/assets/harness/invoke.py.template` と
CLI 本体のイベント処理。**実際に呼んで確かめてはいない。**

### JS SDK は Harness を持つが、SigV4 しか話せない

`@aws-sdk/client-bedrock-agentcore@3.1105.0` に **`InvokeHarnessCommand` がある。**

```ts
InvokeHarnessResponse.stream: AsyncIterable<InvokeHarnessStreamOutput>
```

型は完備している（`HarnessToolUseBlock` / `HarnessToolResultBlock` / `HarnessStopReason`）。
復号も SDK がやる。

**しかし認証スキームは `aws.auth#sigv4` の 1 つだけ。**
`dist-types/auth/httpAuthSchemeProvider.d.ts` に SigV4 しか無く、
`smithy.api#httpBearerAuth` は存在しない。

```
$ grep -oE '"(smithy\.api#httpBearerAuth|aws\.auth#sigv4)"' dist-cjs/index.js | sort -u
"aws.auth#sigv4"
```

**帰結。** Harness を `customJWTAuthorizer`（Cognito のアクセストークン）で保護する構成では、
**この SDK をそのまま使えない**。Bearer で叩くなら `fetch` + 自作デコーダになる。

- `httpAuthSchemes` に自前の Bearer スキームを差し込むことは可能だが、
  **`@internal` 印の付いた設定**であり、版が上がると壊れる
- SigV4 に寄せると authorizer を IAM にすることになり、
  **`cognito:groups` による案件分離（`customClaims`）が使えなくなる**

**つまり「ブラウザ直叩き + 自作デコーダ」は選択の帰結ではなく、
JWT で案件を分離するという要件からの必然。**

### ツール実行はフロントと Harness の排他ではない

`HarnessToolUseType` の列挙値が 3 つある。

| 値 | 誰が実行するか |
|---|---|
| `tool_use` | **呼び出し側**（`inline_function` / return-of-control） |
| `mcp_tool_use` | **Harness**（`remote_mcp`） |
| `server_tool_use` | **Harness**（Code Interpreter / Browser など組み込み） |

**同一ストリームに混在しうる。** 前身の「`inline_function` でツールを返しつつ
Code Interpreter を使う」構成は、すでにこの混在形だった。
「フロント実行か Harness 実行か」は二者択一ではなく、**ツールごとに選べる**。

`HarnessStopReason`: `end_turn` / `tool_use` / `tool_result` / `max_tokens` /
`max_iterations_exceeded` / `timeout_exceeded` / `content_filtered` /
`malformed_tool_use` / `malformed_model_output` / `model_context_window_exceeded` /
`max_output_tokens_exceeded` / `stop_sequence` / `interrupted` / `partial_turn`。

`HarnessToolUseStatus`: `success` / `error`。

### event stream のフレーム構造

```
[total length: 4][headers length: 4][prelude CRC: 4][headers][payload][message CRC: 4]
ヘッダ: [name length: 1][name][value type: 1][value]   ※ type 7 = string
イベント名は :event-type、例外は :exception-type ヘッダ
```

**この構造は前身で実装して確認済み。** 外部依存なしのデコーダが書け、分割された
チャンクがフレーム境界をまたぐケースでも動いた。

ただし**自前で復号する必要があるかは未決**（要件書 7.0）。ブラウザから直接
InvokeHarness を叩く構成を選んだ場合にだけ要る。SDK や CLI を経由するなら不要。

## Cognito / Amplify / その他

| 項目 | 事実 |
|---|---|
| Cognito User Pool の削除 | **ドメインを先に削除しないと消せない**（CFn なら依存解決される） |
| Cognito のコールバック URL | **ワイルドカード不可**。案件ごとに登録が必要 |
| Cognito Hosted UI ドメイン | **リージョン内で全アカウント共通の名前空間** |
| Amplify のブランチ自動検出 | パターンを設定しても **push で発火しなかった**。明示的に `CreateBranch` する |
| Amplify アプリ | `Repository` も `AccessToken` も**必須ではない**。未接続で作れる |
| Transaction Search | **アカウント・リージョンごとに 1 つのグローバル設定**。CFn スタックに含めると、削除時に他プロジェクトのトレースまで止まる |
| IAM の `--description` | **ASCII のみ**。日本語を入れると `ValidationError` |
| AgentCore の提供リージョン | ap-northeast-1 で利用可。`jp.anthropic.claude-*` で**推論も国内完結** |
