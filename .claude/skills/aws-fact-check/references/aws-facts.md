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
