---
name: aws-fact-check
description: このプロジェクトで実測済みの AWS 仕様を引き、未確定のものを推測せずに確かめる。bedrock-agentcore-control / CreateHarness / InvokeHarness / harnessName / runtimeSessionId / customJWTAuthorizer / claimMatchOperator / agentcore_code_interpreter / inline_function / Cognito Hosted UI ドメイン / Amplify CreateBranch / Transaction Search のいずれかに触れるときは必ず最初に使う。references/aws-facts.md に実測値があるので再調査は不要。載っていないものだけ --generate-cli-skeleton で確認する。
---

# AWS API の形状を確認する

## まず参照ファイルを読む

**[references/aws-facts.md](references/aws-facts.md) に、実測で確定した仕様がある。**
AgentCore Harness・Cognito・Amplify の 25 項目ほどと、event stream のフレーム構造。

**ここに載っているものは再調査しない。** 載っていないものだけ、以下の手順で確認する。
新しく確定したものは同ファイルに追記する。

---

**推測で書いて後から直すのが最も高くつく。**

前身のプロジェクトでは、AWS SDK の型定義とブログ記事から推測してコードを書き、
**7 箇所すべてが間違っていた**。デプロイして初めて発覚し、そのたびに直す羽目になった。

| 推測 | 実際 |
|---|---|
| `POST /harnesses/{arn}/invocations` | `POST /harnesses/invoke?harnessArn={arn}` — ARN はクエリ |
| `customJwtAuthorizer` | `customJWTAuthorizer` — JWT が大文字 |
| `memory: { shortTerm, longTerm }` | Union で `managedMemoryConfiguration` など |
| `type: "agent_core_code_interpreter"` | `agentcore_code_interpreter` |
| `claimMatchOperator: "EQUALS"` | 配列クレームには `CONTAINS` |
| `skills: [{ name }]` | `[{ awsSkills: { paths } }]` |
| `DeleteHarness({ harnessName })` | `harnessId` を取る |

**5 分の確認で、数時間の手戻りが防げる。**

## 確認の順序

### 1. CLI スケルトン（最優先）

```bash
aws <service> <operation> --generate-cli-skeleton --region <region>
```

**これが最も確実。** そのサービスの API 定義から生成されるため、
ドキュメントより正確で、SDK の型定義より読みやすい。

出力される JSON がリクエストの完全な形。Union 型（複数のうち 1 つだけ指定するもの）も
すべてのメンバーが列挙されるので、選択肢が分かる。

**出力形状を見たいとき**は `--generate-cli-skeleton output` を付ける。

### 2. 列挙値は CLI ヘルプで確認する

スケルトンには 1 例しか出ないため、選択肢は別途調べる。

```bash
aws <service> <operation> help | grep -A12 "<プロパティ名>"
```

`Possible values:` の下に候補が並ぶ。前身では `claimMatchOperator` の候補
（`EQUALS` / `CONTAINS` / `CONTAINS_ANY`）をこれで確認した。

### 3. ドキュメント検索

`awsknowledge` MCP の `search_documentation` を使う。API リファレンスの
Request Syntax は正確だが、**ブログ記事や SDK のサンプルは古いことがある**。

CloudFormation リソースの有無を調べるなら次も使える。

```bash
aws cloudformation describe-type --type RESOURCE --type-name "AWS::Service::Resource" --region <region>
```

### 4. 実際に呼んでみる

上記で分からなければ、最小の入力で呼んで**エラーメッセージから学ぶ**。
AWS のバリデーションエラーは、期待される形式を具体的に教えてくれることが多い。

**`create-*` で試すときは要注意。** バリデーションが非同期のことがあり（後述）、
エラーで弾かれずに**実際に作られる**。試すなら撤去まで込みで計画し、
作った直後に何を消すかを決めておく。`delete-*` も当然ながら副作用がある。
副作用なしで形状だけ見たいなら `--generate-cli-skeleton` を使う。

```
ValidationException: Value 'agent_core_code_interpreter' at 'tools.2.member.type'
failed to satisfy constraint: Member must satisfy enum value set:
[remote_mcp, agentcore_code_interpreter, agentcore_gateway, agentcore_browser, inline_function]
```

**このエラー 1 つで正解が分かる。**

## 特に間違えやすいもの

### 命名規則

サービスによって一貫していない。SDK の型名から推測しない。

- `customJWTAuthorizer` のように**略語が大文字のまま**のことがある
- `agentcore_` と `agent_core_` のように**区切り方が揺れる**
- Ruby SDK の `agent_core_code_interpreter` は snake_case 変換の結果であり、
  API の実際の値ではない

### Union 型

「複数のうち 1 つだけ指定する」構造は、スケルトンでは**全メンバーが並んで見える**。
すべて指定するとエラーになる。

```json
"memory": {
  "agentCoreMemoryConfiguration": {...},
  "managedMemoryConfiguration": {...},
  "disabled": {}
}
```
→ このうち **1 つだけ**を指定する。

### 識別子は名前か ID か

作成時に名前を指定しても、**削除・取得は ID を要求する**ことがある。

```bash
aws <service> delete-<resource> --generate-cli-skeleton
```
で確認する。名前から ID を引くには `list-*` を使う。

### 非同期のバリデーション

**作成 API が成功を返しても、後から失敗することがある。** ステータスが
`READY` や `ACTIVE` になるまで待ち、失敗状態を検出して中断する。

前身では `CreateHarness` が成功した 2 分後に `CREATE_FAILED` になった。

### 文字種の制約

`--description` が ASCII のみ、名前にハイフン不可、といった制約がある。
スケルトンには出ないので、API リファレンスの `Pattern:` を確認する。

前身では IAM の `--description` に日本語を入れて `ValidationError` になった。

## 変えたら、呼んで確かめる

**形を確かめただけでは足りない。2026-08-15 に 3 回続けて外した。**

モデル ID を上げるとき、`list-inference-profiles` に出ることを確認して
コミットした。**実際に呼んでいなかった。** 呼ぶと `AccessDeniedException` だった。

さらに悪いのは、その原因を**測らずに断定した**こと。

| 断定したこと | 実際 |
|---|---|
| アカウントが規約に同意していない | **実行ロールの権限不足**だった |
| GPT はアカウントに契約が無く、コードでは直らない | **初回の呼び出しが購読を開始する**。数分後に通った |

**どちらも `aws-facts.md` に書いてから訂正する羽目になった。**
参照ファイルは「再調査不要」として読まれるので、**誤りを書くのが最も高くつく。**

**AWS の設定を変えたら、次のどちらかをしてから書く。**

1. **実際に呼ぶ。** このプロジェクトなら `scripts/probe-roundtrip.ts`
2. 呼べないなら、**未確認と明記する**

**エラーが出たら、原因を 1 つに決める前に切り分ける。**
AWS のエラー本文は、**別々の原因を同じ文言で返すことがある**
（「IAM user **or service role** is not authorized」）。
自分の資格情報で直接呼んでみるのが、いちばん短い切り分けだった。

**成功のレスポンスも当てにならない。** `InvokeHarness` は未知のフィールドを
混ぜても HTTP 200 を返す。**効いたかどうかはふるまいで確かめる。**

## 確認したことを残す

**同じ調査を二度させない。** 確認した形状は
[references/aws-facts.md](references/aws-facts.md) の表に 1 行足す。
コード側にも短くコメントを置く。

```typescript
// InvokeHarness: POST /harnesses/invoke?harnessArn={arn}
// ARN はパスではなくクエリパラメータ
```

**参照ファイルへの追記を省かない。** 省くと次の担当者（多くの場合、
次のセッションの自分）が同じ手順を最初から繰り返す。
