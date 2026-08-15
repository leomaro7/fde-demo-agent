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
| aws-cdk-lib の L1 | **`CfnHarness` は `aws-cdk-lib@2.263.0` に存在する**（`aws-cdk-lib/aws-bedrockagentcore`）。**`@aws/agentcore-cdk` のソースコメントは「L1 が無い」と書いているが、それは古い aws-cdk-lib を前提にした記述。信じないこと** |
| **L1 が守ってくれる範囲** | **プロパティ名と構造だけ。列挙値は守られない。** `inboundTokenClaimValueType` も `claimMatchOperator` も型は素の `string` で、`tsc` は不正な値を通す。**列挙値は必ず CLI ヘルプの `Possible values` で確かめること** |
| 列挙値の誤りを拾う最後の砦 | **`cdk synth` 時の CloudFormation スキーマ検証**（警告として出る）。`STRING_LIST` はこれで見つかった。**警告を読み飛ばさない** |
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

**2026-08-09 実測。** 実際に叩いて確かめた（`scripts/probe-harness.ts`）。
以下は推定ではなく実物。

```
ヘッダは 3 つ: :event-type / :content-type / :message-type

messageStart      {"role":"assistant"}
contentBlockStart {"contentBlockIndex":0,"start":{"toolUse":{
                     "name":"search","toolUseId":"tooluse_...","type":"tool_use"}}}
contentBlockDelta {"contentBlockIndex":0,"delta":{"toolUse":{"input":""}}}
contentBlockDelta {"contentBlockIndex":0,"delta":{"toolUse":{"input":"{\"keywor"}}}
contentBlockDelta {"contentBlockIndex":0,"delta":{"toolUse":{"input":"d\": \"出"}}}
contentBlockDelta {"contentBlockIndex":0,"delta":{"toolUse":{"input":"張 精算\"}"}}}
contentBlockStop  {"contentBlockIndex":0}
messageStop       {"stopReason":"tool_use"}
```

| 実測で分かったこと | 内容 |
|---|---|
| **ツールの引数は `contentBlockStart` に入らない** | **`contentBlockDelta.delta.toolUse.input` に JSON 文字列の断片として流れる。** 呼び出し側が `contentBlockIndex` ごとに連結し、`contentBlockStop` で完成とみなして `JSON.parse` する。**ここを実装しないとツールループが引数を組み立てられない** |
| `start.toolUse` の中身 | `name` / `toolUseId` / **`type`**（`tool_use` / `mcp_tool_use` / `server_tool_use`） |
| **`type` は「誰が実行したか」を表さない** | **2026-08-12 実測。** `agentcore_code_interpreter` を宣言したとき、Harness 側で走る `code_interpreter` / `file_operations` / `shell` も**すべて `type: "tool_use"`** で来た。`server_tool_use` は観測できていない。**執行者の判別に `type` を使ってはいけない** |
| Code Interpreter が出すツール名 | `code_interpreter` / `file_operations` / `shell` の 3 つ。**宣言した名前（例: `code_interpreter`）以外も出る** |
| Code Interpreter の実行 | **`executeCode` は毎回 error になった**（4 回中 4 回。`language` の有無を問わず）。一方 **`shell` の `python3` は成功し、pandas も使えた**。原因は未調査。**`shell` を使うよう指示文で誘導するのが確実** |
| 失敗が利用者に見える | エージェントは自力で `shell` に切り替えて回復するが、**「code_interpreter が使えないため」と回答文に書いてしまう**。商談では製品が壊れて見える。**「実行環境で起きたことを回答に書かない」と指示文に入れること** |
| 本文の差分 | `delta.text`。ツール引数の差分（`delta.toolUse.input`）と**同じ `contentBlockDelta` で来る**ので、中身で振り分ける |
| `messageStop` | `inline_function` を使うと設計どおり `{"stopReason":"tool_use"}` で止まる |

### 認可に落ちたときは 403 ではなく 500

**`cognito:groups` に必要なグループが無いトークンで叩くと、HTTP 500 が返る。**

```
status: 500 Internal Server Error
content-type: application/json
body: {"message":"Authorization denied"}
```

**ステータスコードだけでは本物のサーバーエラーと区別できない。**
画面に出し分けるなら本文を読むこと。

（旧記述の出典は `@aws/agentcore@0.26.0` 同梱の
`dist/assets/harness/invoke.py.template` と CLI 本体のイベント処理だった。）

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

`HarnessToolUseType` の列挙値が 3 つある（`tool_use` / `mcp_tool_use` / `server_tool_use`）。

> **2026-08-12 訂正 — この 3 値を「誰が実行したか」と読んではいけない。**
> SDK の型定義から executor を推測して書いていたが、**実測と食い違った。**
> `agentcore_code_interpreter` を宣言したとき、Harness 側で走る
> `code_interpreter` / `file_operations` / `shell` が**すべて `type: "tool_use"`**
> で届いた。`server_tool_use` は一度も観測できていない。
>
> **執行者は、案件が登録しているツール名で判別すること。** それが唯一
> 確かな情報である。上の「実測で分かったこと」の表を見ること。

**ツールがフロント実行と Harness 実行で混在すること自体は正しい。**
`inline_function` でツールを返しつつ Code Interpreter を使う構成は実際に動いた。
「フロント実行か Harness 実行か」は二者択一ではなく、**ツールごとに選べる**。

`HarnessStopReason`: `end_turn` / `tool_use` / `tool_result` / `max_tokens` /
`max_iterations_exceeded` / `timeout_exceeded` / `content_filtered` /
`malformed_tool_use` / `malformed_model_output` / `model_context_window_exceeded` /
`max_output_tokens_exceeded` / `stop_sequence` / `interrupted` / `partial_turn`。

`HarnessToolUseStatus`: `success` / `error`。

### `AWS::BedrockAgentCore::Harness` の CFn プロパティ（2026-08-08 確認）

**このプロジェクトでは `aws-cdk-lib` の `CfnHarness`（L1）を使うので、
下の生 JSON を手で書く必要はない。** L1 の型（camelCase）から下の PascalCase へは
CDK が変換する。**構造と許容値の対応表として読むこと。**

出典は `@aws/agentcore-cdk@0.1.0-alpha.46` の
`dist/cdk/constructs/components/primitives/harness/harness-cfn-mapping.js`（全文を読んだ）と、
`aws bedrock-agentcore-control create-harness help`。

### モデル ID は推論プロファイルから引く（2026-08-15 実測 / ap-northeast-1）

**`jp.` があるモデルと無いモデルがある。推測しない。**

```bash
aws bedrock list-inference-profiles --region ap-northeast-1 \
  --query "inferenceProfileSummaries[].[inferenceProfileId,status]" --output text
```

| モデル | プロファイル |
|---|---|
| **Sonnet 5** | **`global.anthropic.claude-sonnet-5` のみ。`jp.` は存在しない** |
| **GPT-5.6 Terra** | **`global.openai.gpt-5.6-terra`**（sol / luna も `global.` のみ） |
| **Nova 2 Lite** | **`jp.amazon.nova-2-lite-v1:0`** / `global.` |
| Sonnet 4.5 | `jp.` / `global.` / `apac.` |
| Sonnet 4.6 | `jp.` / `global.` |
| Haiku 4.5 | `jp.` |
| Opus 4.7 / 4.8 | `jp.` |

**OpenAI と Amazon のモデルも `bedrockModelConfig` で渡す。**
`openAiModelConfig` は API キー（`apiKeyArn`）が要る直接続き用で、
Bedrock 経由なら不要。**プロバイダが変わっても設定の形は変わらない。**

上の 3 つはいずれも `responseStreamingSupported: true`、
`inferenceTypesSupported: ["INFERENCE_PROFILE"]`（＝素の ID では呼べない）。

**ID が正しくても、実行ロールに Marketplace の権限が無いと呼べない**（2026-08-15 実測）。

`CreateHarness` は成功し、`InvokeHarness` の**ストリームの中で**こう返る。

```
AccessDeniedException ... not authorized to perform the required AWS Marketplace
actions (aws-marketplace:ViewSubscriptions, aws-marketplace:Subscribe)
```

**本文は 2 つの別々の原因を同じ文言で返す。** 切り分けは、**同じモデルを自分の
資格情報で直接呼ぶ**のが最短。

```bash
aws bedrock-runtime converse --region ap-northeast-1 \
  --model-id <プロファイル ID> \
  --messages '[{"content":[{"text":"hi"}],"role":"user"}]'
```

| 直接呼ぶと | 原因 | 直し方 |
|---|---|---|
| **通る** | **実行ロールの権限不足** | ロールに `aws-marketplace:ViewSubscriptions` を足す（`Subscribe` は不要）|
| **同じエラー** | **そのモデルの購読がまだ済んでいない** | **1 回目の呼び出しが購読を開始する。** 数分待って呼び直す |

**1 回目が失敗しても諦めない。** エラー本文の末尾に
「If you recently fixed this issue, try again after 2 minutes」とある。
GPT-5.6 Terra は 1 回目が `AccessDenied`、しばらく後に呼び直すと通った（2026-08-15 実測）。

**`get-foundation-model-availability` の `agreementAvailability` は当てにならない。**
Sonnet 5 は `NOT_AVAILABLE` と出たが実際には呼べた。GPT-5.6 Terra は失敗後に
`AVAILABLE` へ変わった。**この値で判断せず、呼んでみること。**

2026-08-15 の実測。**4 つとも Harness からツールを最後まで往復できた。**

| モデル | プロファイル | 備考 |
|---|---|---|
| Claude Sonnet 5 | `global.` | ロールに `ViewSubscriptions` が要る |
| Claude Sonnet 4.6 | `jp.` | |
| Nova 2 Lite | `jp.` | 入力を 1 回で返す（分割しない）|
| GPT-5.6 Terra | `global.` | 初回は `AccessDenied`。購読の完了後に通った。`toolUse` に `type` が無い |

**`global.` でも東京は経路に入る。** `get-inference-profile` の `models[].modelArn` に
`ap-northeast-1` が含まれる。ただしリージョン指定なしの ARN も並ぶので**東京に固定はされない**。
`jp.` は `ap-northeast-1` と `ap-northeast-3` だけ。

**ツール呼び出しのイベント形状はモデルによらず同じ**（同日実測）。
`contentBlockStart` の `start.toolUse` と `contentBlockDelta` の `delta.toolUse.input`。
違うのは断片の粒度だけで、Nova は入力を 1 回で返し、Claude と GPT は分割して返す。
**GPT の `toolUse` には `type` が入らない**ので、実行するツールの判定に `type` を使わないこと。

**`global.` は推論の経路が日本国内に限定されない。** このデモ基盤はダミーデータしか
扱わないので支障は無いが、商談で聞かれることがある。

`list-foundation-models` にはプロファイルの無い素の ID（`anthropic.claude-sonnet-5`）も
出る。**Harness に渡すのはプロファイル ID のほう。**

```jsonc
{
  "HarnessName": "instance_slug",          // createOnly・40 文字以内
  "ExecutionRoleArn": "arn:aws:iam::...",
  "Model": { "BedrockModelConfig": {
      "ModelId": "jp.anthropic.claude-...",
      "Temperature": 0.2, "TopP": 0.9, "MaxTokens": 4096,
      "ApiFormat": "converse_stream"       // converse_stream | responses | chat_completions
  }},
  "SystemPrompt": [ { "Text": "..." } ],   // ★ 配列。オブジェクトのキーは Text
  "Tools": [ { "Type": "inline_function", "Name": "search",
               "Config": { "InlineFunction": { "Description": "...", "InputSchema": {...} } } },
             { "Type": "agentcore_code_interpreter", "Name": "code",
               "Config": { "AgentCoreCodeInterpreter": {} } } ],
  "Memory": { "Disabled": {} },            // ★ 省略禁止。下記参照
  "MaxIterations": 20, "MaxTokens": 8192, "TimeoutSeconds": 300,
  "AuthorizerConfiguration": { "CustomJWTAuthorizer": {
      "DiscoveryUrl": "https://cognito-idp.<region>.amazonaws.com/<poolId>/.well-known/openid-configuration",
      "AllowedClients": [ "<clientId>" ],
      "CustomClaims": [ {
        "InboundTokenClaimName": "cognito:groups",
        "InboundTokenClaimValueType": "STRING_ARRAY",   // ★ STRING_LIST ではない
        "AuthorizingClaimMatchValue": {
          "ClaimMatchValue": { "MatchValueString": "<slug>" },
          "ClaimMatchOperator": "CONTAINS"
        }
      } ]
  }},
  "Tags": [ { "Key": "...", "Value": "..." } ]
}
```

| 落とし穴 | 内容 |
|---|---|
| **`InboundTokenClaimValueType` の許容値は `STRING` / `STRING_ARRAY` の 2 つだけ** | `STRING_ARRAY` は「配列のうち少なくとも 1 つに一致」。**`STRING_LIST` は存在しない**（CLI ヘルプの `Possible values` で確認）。`cognito:groups` は配列なので `STRING_ARRAY` + `ClaimMatchOperator: CONTAINS` + `ClaimMatchValue.MatchValueString` |
| `ClaimMatchValue` | **tagged union。** `MatchValueString` か `MatchValueStringList` の**どちらか一方だけ** |
| **`Memory` を省略してはいけない** | **省略するとサービスが managed memory を勝手に用意する。** 「メモリ無し」を意味させるには `{ "Disabled": {} }` を明示する（公式実装のコメントに明記） |
| `SystemPrompt` | **文字列ではなく `[{ Text }]` の配列**。`Text` は `minLength: 1`。空文字を渡すと `CREATE_FAILED` |
| `Environment.AgentCoreRuntimeEnvironment.NetworkConfiguration` | **createOnly**。VPC を使わないなら `Environment` ごと省略する |
| 戻り値 | **`Ref` は Arn**。`HarnessId` / `Status` / `Version` / `AgentRuntimeArn` は `Fn::GetAtt` |

ツール `Config` のキー（`Type` の値と対応）:
`RemoteMcp{Url,Headers}` / `AgentCoreBrowser{BrowserArn}` /
`AgentCoreCodeInterpreter{CodeInterpreterArn}` /
`AgentCoreGateway{GatewayArn,OutboundAuth}` / `InlineFunction{Description,InputSchema}`。

`Model` の他プロバイダ: `OpenAiModelConfig` / `GeminiModelConfig` / `LiteLlmModelConfig`。

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
| Amplify の手動デプロイ | **自前の S3 バケットは要らない**（2026-08-11 確認）。下記の 3 手 |
| `InvokeHarness` のリクエスト | `{ harnessArn, runtimeSessionId, messages }`。`messages[].content[]` は union で `{text}` / `{toolUse}` / `{toolResult}` / `{reasoningContent}`。`toolResult` は `{ toolUseId, content: [{text}], status }` |

### Amplify の手動デプロイ（リポジトリ未接続）

```bash
# 1. デプロイ枠を作る。jobId と zipUploadUrl が返る（自前バケット不要）
aws amplify create-deployment --app-id <id> --branch-name <branch> --region ap-northeast-1
# 2. 返ってきた URL に ZIP を PUT する
curl -X PUT --upload-file dist.zip "<zipUploadUrl>"
# 3. 反映する
aws amplify start-deployment --app-id <id> --branch-name <branch> --job-id <jobId> --region ap-northeast-1
```

`create-deployment` に `fileMap` を渡すと `zipUploadUrl` の代わりに
`fileUploadUrls`（ファイル名 → URL のマップ）が返る。**ZIP のほうが手数が少ない。**
`start-deployment` の `sourceUrlType` の既定は `ZIP`。
| Transaction Search | **アカウント・リージョンごとに 1 つのグローバル設定**。CFn スタックに含めると、削除時に他プロジェクトのトレースまで止まる |
| IAM の `--description` | **ASCII のみ**。日本語を入れると `ValidationError` |
| AgentCore の提供リージョン | ap-northeast-1 で利用可。`jp.anthropic.claude-*` で**推論も国内完結** |
