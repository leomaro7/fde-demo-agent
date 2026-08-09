# 何を自作するのか — 設計

作成日: 2026-08-08
対象: 要件書 7.0「そもそも何を自作するのか」

---

# 1. 結論

| 決めること（要件書 7.0） | 決めたこと |
|---|---|
| 案件リソースを CFn / CDK / AgentCore CLI のどれで作るか | **自前の CDK アプリ。`aws-cdk-lib` の `CfnHarness`（L1）を使い、`@aws/agentcore-cdk` には依存しない** |
| ツールをどこで実行するか | **ブラウザ側**（`inline_function`）。**Code Interpreter だけ Harness 側**（`server_tool_use`） |
| 案件の設定ファイルを自作スキーマにするか公式に寄せるか | **自作スキーマ。TypeScript で書く** |

**エージェント層は自作する。前身とほぼ同じ大きさになる。**
7.0 は「自作しなくてよくなるのでは」と疑ったが、3.1 の事実により成立しなかった。

**代わりに消えるのは案件構築の SDK スクリプト。** ここが CDK に置き換わる。

---

# 2. 自作するもの・任せるもの

## 任せる

| | 任せる先 |
|---|---|
| 推論 → ツール → 応答のループ | Harness |
| コード実行 | Harness の `agentcore_code_interpreter` |
| リソースの作成順序・削除順序・冪等性 | CloudFormation |
| Harness の CFn プロパティ名の正解 | `@aws/agentcore-cdk` の `harness-cfn-mapping.js` を**読む**（依存はしない） |

## 自作する

| | なぜ任せられないか |
|---|---|
| CDK スタック（土台・案件） | Cognito / Amplify / Harness を 1 つの依存グラフに載せるのは自分の仕事 |
| event stream デコーダ | **JS SDK が SigV4 しか話せない**（3.1）。前身に実績があり、フレーム構造は実測済み |
| ツールループ | `inline_function` を選んだ帰結。`stopReason: tool_use` を見て `toolResult` を返すだけ |
| フロント（会話 + トレース） | 要件書 4.1 の差別化点。既製品が無い |
| 案件設定のスキーマ | 自前 CDK を選んだ帰結 |

**前身から消えるものは無い。** 7.0 は「デコーダもツールループも不要になりうる」と疑ったが、
3.1 の事実によりデコーダは必然だと分かった。ツールループは選択の余地があったが、
3.2 の理由で残すことを選んだ。

---

# 3. 判断の根拠

すべて 2026-08-08 に確認し、`aws-facts.md` に記録済み。

## 3.1 JS SDK は SigV4 しか話せない

`@aws-sdk/client-bedrock-agentcore@3.1105.0` は `InvokeHarnessCommand` を持ち、
`stream: AsyncIterable<InvokeHarnessStreamOutput>` を返す。型も復号も完備している。

**しかし認証スキームは `aws.auth#sigv4` だけ。** `smithy.api#httpBearerAuth` が無い。

Harness を `customJWTAuthorizer`（Cognito アクセストークン）で保護する構成では使えない。
逃げ道は 2 つあり、どちらも取らない。

| 逃げ道 | 取らない理由 |
|---|---|
| `httpAuthSchemes` に自前の Bearer スキームを差し込む | **`@internal` 印の付いた設定。**版が上がると壊れる |
| authorizer を IAM にして SigV4 で叩く | **`cognito:groups` による案件分離（`customClaims`）が使えなくなる。** 要件書 4.1「他案件の画面に入れない」に直結する |

**「ブラウザ直叩き + 自作デコーダ」は前身の思いつきではなく、
JWT で案件を分離するという要件からの必然だった。**

## 3.2 ツール実行はフロントと Harness の排他ではない

`HarnessToolUseType` に 3 値ある。

| 値 | 誰が実行するか |
|---|---|
| `tool_use` | 呼び出し側（`inline_function` / return-of-control） |
| `mcp_tool_use` | Harness（`remote_mcp`） |
| `server_tool_use` | Harness（Code Interpreter / Browser） |

**同一ストリームに混在する。ツールごとに選べる。**

ブラウザ側（`inline_function`）を主にする理由は 3 点。

1. **減る自作コードがループ 1 つしかない。** デコーダは 3.1 によりどちらを選んでも要る
2. **案件ごとの AWS リソースが増える。** `remote_mcp` / `agentcore_gateway` に寄せると
   案件ごとにツールとダミーデータを AWS にホストする必要があり（Lambda + Gateway、seed の置き場）、
   `217〜256 秒` の実績を壊す。**速度が目的**である以上ここが決め手
3. **後から移せる。** Harness の `tools` 宣言を差し替えるだけで土台の作りは変わらない

Code Interpreter だけは Harness 側のままにする。前身のデータ分析型がすでにこの形で動いた。

## 3.3 公式コンストラクトに依存しない理由

| | 事実 |
|---|---|
| `@aws/agentcore-cdk` の版 | **`0.1.0-alpha.46`** |
| `AgentCoreHarness` の要求 | `HarnessSpec`（同パッケージの zod）と **`harnessDir`（`harness.json` を置くディレクトリ、必須）** |
| AgentCore CLI | CDK ジェネレータ。**Cognito と Amplify は管轄外** |
| aws-cdk-lib の L1 | **`CfnHarness` が `2.263.0` に存在する**（`aws-cdk-lib/aws-bedrockagentcore`） |

**2026-08-08 訂正** — この節は当初「L1 が無いので `CfnResource` で直書きする」と書いていた。
根拠は `@aws/agentcore-cdk` のソースコメントで、**一次情報に当たっていなかった。**
実際には `aws-cdk-lib` に `CfnHarness` がある。**`CfnHarness` を使う。**

直書きをやめた理由は 2 つ。`aws-cdk-lib` は既に依存に入っているので新たな依存が増えない。
そして手書きの PascalCase マッピングは実際に誤りを生んだ
（`InboundTokenClaimValueType` を存在しない `STRING_LIST` と書いていた。正しくは `STRING_ARRAY`）。

**ただし L1 が守るのはプロパティ名と構造だけで、列挙値は守らない。**
`inboundTokenClaimValueType` も `claimMatchOperator` も L1 の型は素の `string` で、
`tsc` は不正な値を通す。実際に `STRING_LIST` を見つけたのはコンパイラではなく、
**`cdk synth` 時の CloudFormation スキーマ検証の警告**だった。

**列挙値は CLI ヘルプの `Possible values` で確かめる。** L1 に移しても
この手順は省けない。「L1 だから安全」と思うのが一番危ない。

`@aws/agentcore-cdk`（公式の L2）を使わない理由は、L1 の有無とは別に 3 つある。

1. **alpha への依存を土台の中心部に埋め込まない**
2. **`harnessDir` 必須という構造依存を持ち込まない。**
   CLAUDE.md「構造を前提にする仕組みは、それが決まってから作る」に正面から反する
3. **Cognito / Amplify と 1 スタックに載る。**
   5.1 で IaC を選んだ狙い（削除順序と依存を CFn に解かせる）が効くのは同一スタックのとき。
   CLI に寄せると Harness だけ別経路になり、撤去が 2 手になる（要件書 4.1「1 手で消える」に反する）

**捨てるもの** — 40 文字検証と実行ロールの権限セットは自分で書く。
正解は `harness-cfn-mapping.js` にあり、依存せずに読むことはできる。
**プロパティ名と構造は `CfnHarness` が持つので、そこは自前ではない。**

---

# 4. 構成

## 4.1 スタックの分け方

```
FoundationStack           一度きり。instance ごとに 1 つ
  Cognito User Pool
  Cognito Hosted UI ドメイン
  Amplify App（リポジトリ未接続でも作れる）
  Harness 実行ロール（案件で差が出ないので共有。名前は指定しない）
        │ CFn Export / ImportValue
        ▼
DemoStack-<slug>          案件ごと
  Harness（inline_function ツール宣言 + agentcore_code_interpreter）
  User Pool Client（コールバック URL は自分の Amplify ブランチ URL）
  User Pool Group（<slug>）
  Amplify Branch
```

**クロススタック参照は CFn Export / ImportValue を使う。** SSM ではない。
土台が案件に使われている間は土台を消せなくなるが、**それは望ましい挙動**である
（撤去漏れがそのまま検出される）。

土台が Export するのは 4 つ。

| Export | 案件での用途 |
|---|---|
| User Pool ID | User Pool Client / Group の作成先 |
| User Pool の `discoveryUrl` | Harness の `customJWTAuthorizer.discoveryUrl` |
| Amplify App ID | Branch の作成先、およびブランチ URL の組み立て |
| Harness 実行ロールの ARN | Harness の `executionRoleArn` |

**案件の撤去は `cdk destroy` 1 手。** 要件書 4.1 を満たす。

### Amplify にリポジトリを接続しない（2026-08-08 追記）

**この設計を最初に書いたとき、ブランチにどうやって中身を届けるかが抜けていた。**
実装計画を書く段階で気づいた。

前身はリポジトリを接続して自動ビルドしていたが、それには **GitHub のアクセストークン**が要る。
シークレットを CFn に持ち込むことになる。

**未接続のまま `StartDeployment` で ZIP を上げる。** Amplify アプリが
`Repository` も `AccessToken` も無しで作れることは実測済み。
`gh repo create` と Amplify の接続手順が丸ごと消えるので、速度側にも効く。

## 4.2 命名

`instance` を**必須パラメータ**にする（CDK context `-c instance=<name>`）。省略時は synth で落とす。

| 対象 | 形 | 根拠 |
|---|---|---|
| スタック名 | `FdeDemo-${instance}-Foundation` / `FdeDemo-${instance}-${slug}` | 5.2 |
| Cognito ドメインプレフィックス | `${instance}` | **リージョン内で全アカウント共通の名前空間。** 一意性の責任は `instance` を決める人にある |
| Amplify アプリ名 | `fde-demo-${instance}` | 5.2 |
| `harnessName` | `${instance}_${slug}` | 英数字とアンダースコアのみ・**ハイフン不可**・先頭は文字・40 文字以内 |
| IAM ロール名 | **指定しない** | 5.2 |

**アカウント ID はどこにも入れない**（5.3）。Cognito のログイン URL はクライアントに見える。

`harnessName` の作り方を曖昧にしない。**ハイフンだけ `_` に置き換える。**
それ以外の不正文字と 40 文字超過は**変換せず synth で落とす**（黙って切り詰めると
別の案件と衝突しうる）。これは純粋関数なので TDD の対象（4.8）。

## 4.3 認証と案件の分離

```
クライアント
  │ ① Amplify ブランチ URL を開く
  ▼
フロント ── 未認証 ──► ② Cognito Hosted UI（案件ごとの User Pool Client）
  │                        │
  │ ◄── ③ コールバック ────┘  アクセストークン
  │                            （ID トークンではない。client_id クレームが無く 500 になる）
  │ ④ POST /harnesses/invoke?harnessArn=...
  │    Authorization: Bearer <access_token>
  ▼
Harness ── ⑤ customClaims で cognito:groups CONTAINS <slug> を検証
```

- **コールバック URL はワイルドカード不可**のため、User Pool Client は案件ごとに作る
- ブランチ URL は `https://<branch>.<appId>.amplifyapp.com`。`appId` は Export、
  ブランチ名は既知なので CFn 内で組み立てられる
- **`http://localhost:5173` も同じ Client に登録する。** 手順 4（ローカルで Harness に繋ぐ）
  に要る。デモ用途なので本番 Client に開発用 URL が残ることは許容する
- `cognito:groups` は配列なので `claimMatchOperator` は **`CONTAINS`**（`EQUALS` は STRING 専用）

**デモ用ユーザーの作成は CFn に載せない。** `AWS::Cognito::UserPoolUser` に
一時パスワードを置く手段が無く、置けたとしてもテンプレートに平文が残る。
**手順書側の CLI 1 コマンドにする。** これは 5.1「インフラは IaC で書く」の例外であり、
理由を `DECISIONS.md` に残す。

**2026-08-09 確認済み** — `AWS::Cognito::UserPoolUser` の全 8 プロパティに
パスワード系は 1 つも無い（`clientMetadata` / `desiredDeliveryMediums` /
`forceAliasCreation` / `messageAction` / `userAttributes` / `username` /
`userPoolId` / `validationData`）。一方 API の `admin-create-user` には
`TemporaryPassword` がある。**例外は妥当だった。**

## 4.4 フロント

Vite + React + TypeScript。画面は左に会話、右にトレース。

| 部品 | 責務 | 依存 |
|---|---|---|
| `eventstream.ts` | バイト列 → フレーム | なし（純粋関数） |
| `streamParser.ts` | フレーム → `{ kind, ... }` | `eventstream` |
| `harnessClient.ts` | `fetch` + Bearer + `streamParser` | 上記 |
| `toolLoop.ts` | `stopReason: tool_use` → ツール実行 → `toolResult` で再呼び出し | `harnessClient`, 案件の `tools.ts` |
| `TraceView` | `toolUse` / `toolResult` / `reasoning` を表示 | なし |

**それぞれ単独で理解・テストできる。** `eventstream` と `streamParser` は
入出力が純粋なバイト列と値なので TDD の対象。

前身のリポジトリにコードが残っているが、**移植ではなく書き直す。**
移植は 2026-08-07 に一度やって撤回している（`DECISIONS.md`）。
**前身は消えるのが正常な未来**なので、そこを指す前提を設計に持ち込まない。

### 制約

- **ツールの引数は `contentBlockStart` に入らない。** `contentBlockDelta.delta.toolUse.input` に
  JSON 文字列の断片として流れる。`contentBlockIndex` ごとに連結し、`contentBlockStop` で
  完成とみなす。**ツールループの中心はここ**（2026-08-09 実測）
- **認可に落ちると HTTP 403 ではなく 500 が返る**（本文は `{"message":"Authorization denied"}`）。
  ステータスコードだけでは本物のサーバーエラーと区別できないので、本文を読む（同上）
- `toolResult.content` は **`text` のみ**。`json` は拒否されるので必ず文字列化する
- `runtimeSessionId` は**英数字のみ 33〜100 文字**
- Code Interpreter の `toolUse` 入力には**生成コードとデータ全体**が入る。
  そのまま出すと画面が JSON で埋まるので、**コード本体だけを抜き出して長さも抑える**
  （純粋関数。TDD の対象）

## 4.5 案件の設定

`demos/<slug>/` に 3 点。

| ファイル | 中身 |
|---|---|
| `demo.ts` | `slug` / `clientName` / `brand` / `harness`（`modelId`・`systemPrompt`・ツール宣言）/ `examples`（3 問） |
| `seed/*.json` | ダミーデータ。**発見できる傾向を仕込む**（要件書 3.5） |
| `tools.ts` | 検索処理。3 件とも `keyword` で filter して返すだけだった（要件書 3.3） |

`modelId` の既定は `jp.anthropic.claude-*` にする。**推論も国内で完結する**ので、
クライアントに聞かれたときの答えになる。

**YAML ではなく TypeScript にする。** 理由は 3 つ。

1. **パーサも検証も要らない。**型で落ちる。YAML だと CDK 側とフロント側の両方に要る
2. **CDK とフロントが同じファイルを import できる**（`systemPrompt` は Harness へ、
   `brand` と `examples` は画面へ）
3. TDD の対象が減る（CLAUDE.md「純粋関数は TDD」の負担そのもの）

`systemPrompt` には必ず 3 点を含める（要件書 4.2）。

1. 調べる順序 — どのツールをどの順で呼ぶか
2. 根拠の示し方 — 条番号、事例番号、計算に使った数字
3. **答えてはいけない条件** — 該当時に何と言い、どこに回すかまで

`examples` の **3 つ目は「答えられない質問」**を置く（要件書 4.2）。

## 4.6 リポジトリ構成

```
infra/
  bin/app.ts
  lib/foundation-stack.ts
  lib/demo-stack.ts
  lib/harness.ts          CfnHarness を案件向けに包む + harnessName 検証
web/
  src/agent/              eventstream / streamParser / harnessClient / toolLoop
  src/ui/
demos/<slug>/
  demo.ts  seed/  tools.ts
```

## 4.7 エラー処理

**商談中に黙って止まるのが最悪。** 異常は必ず画面に出す。

| 起きること | 扱い |
|---|---|
| `stopReason` が `max_iterations_exceeded` / `timeout_exceeded` / `content_filtered` / `malformed_tool_use` / `model_context_window_exceeded` | 画面に理由を出す。無言で終わらせない |
| `toolResult.status: "error"` | トレースに `[error]` として出す。会話は続行する |
| `CreateHarness` の非同期バリデーション | **CFn が READY を待つかは未確認**（5. の 2）。待たないなら `GetHarness` で `READY` を確認する手順を足す |
| Harness の削除が数分かかる | 同名での再作成は `ConflictException`。`cdk destroy` の完了を待つ |

## 4.8 テスト

CLAUDE.md の方針どおり。**自動テストに時間をかけるより実物を触る。**

| 対象 | やり方 |
|---|---|
| `eventstream` / `streamParser` | **TDD。** フレーム境界をまたぐ分割入力を含める（前身で実証した観点） |
| `harnessName` の sanitize と長さ検証 | **TDD** |
| Code Interpreter 入力からのコード抜き出し | **TDD** |
| `toolLoop` | **TDD**（`harnessClient` を差し替える） |
| デプロイ・認証・画面 | **通し確認。** 商談で見せる 3 問が通ることだけ確かめる |

**それ以外の入力での挙動は保証しない**（CLAUDE.md）。

---

# 5. 未確認のこと

**推測で埋めていない。着手時に `aws-fact-check` の手順で潰す。**

**2026-08-09 追記 — 6 件すべて実測で潰した。** 行は消さずに結果を書いた。
何を疑って何が分かったかが次の判断材料になる。

| | 何が分からないか | いつ潰すか |
|---|---|---|
| 1 | InvokeHarness のストリーム形状 | **解決（2026-08-09）** — 実測済み。**ツールの引数は `contentBlockStart` に入らず、`contentBlockDelta.delta.toolUse.input` に JSON の断片として流れる。** パーサを直した |
| 2 | CFn が Harness の `READY` を待つか | **解決（2026-08-09）** — **待つ。** `CREATE_COMPLETE` 直後に `READY` |
| 3 | `AWS::Amplify::Branch` を CFn で作れるか | **解決（2026-08-09）** — 作れる。`repository: null` のまま `activeJobId: null`（ビルドは走らない）。設計どおり |
| 4 | CFn 経由の案件デプロイ所要時間 | **解決（2026-08-09）** — **31 秒**（土台は 41 秒）。前身の `217〜256 秒` を大きく下回る。方針を戻す必要なし |
| 5 | Cognito ユーザー作成を CFn で扱えるか | **解決（2026-08-09）** — **扱えない。** `AWS::Cognito::UserPoolUser` にパスワード系プロパティが 1 つも無い（API の `admin-create-user` には `TemporaryPassword` がある）。5.1 の例外は妥当だった |
| 6 | `demoUrl` の組み立てが実際の Amplify のドメインと一致するか | **解決（2026-08-09）** — 一致。`defaultDomain` が `<appId>.amplifyapp.com` |

**1 と 4 は方針を覆しうる。** 4 が大幅に悪化するなら、案件だけ SDK スクリプトに
戻す判断（前身の分担）が再浮上する。そのときは `DECISIONS.md` に理由ごと残す。

---

# 6. この設計の範囲外

| | 理由 |
|---|---|
| 要件書 7.1（リポジトリと Cognito の分割単位） | **未決のまま。** 現行（1 リポジトリ・1 User Pool・案件ごとにグループ）を前提として採用する。分割は土台の作りを変えないので後から決められる |
| 案件の自動生成 | 要件書 9 章「工場は型が見えてから」。`new-demo` が骨子までを担う |
| 実データの取り込み・VPC・本番品質 | 要件書 6 章のスコープ外 |

---

# 7. 実装の順序

要件書 9 章「実案件を 1 件通すと土台の欠陥が出る」に従い、**通すのを早くする。**

1. **土台スタック**を書いてデプロイする（未確認 5 を潰す）
2. **`eventstream` / `streamParser` を TDD で書く**（AWS 不要。ここだけ先に固められる）
3. **案件スタック**を書き、案件 1 件をデプロイする（未確認 2・3・4 を潰す）
4. **フロント最小**（会話のみ・トレース無し）をローカルで Harness に繋ぐ（未確認 1 を潰す）
5. フロントを **Amplify ブランチに載せて通す**。ここで一度クライアントに見せられる形になる
6. **トレース UI** を足す
7. **手順書**を `verify-runbook` で書きながら実行する

**Amplify ブランチは案件スタックが持つ**（4.1）ので、案件スタックはフロントより先に要る。
ただし**未確認 1（ストリーム形状）を潰すのに Amplify は要らない**ため、
4 はローカルで先に済ませる。ここで形状が想定と違えば、影響はフロントに閉じる。

**トレースは 6 に置く。** 差別化点だが、無くても商談は成立する。先に通しを作る。
