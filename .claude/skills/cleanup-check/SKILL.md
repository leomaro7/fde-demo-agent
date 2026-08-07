---
name: cleanup-check
description: AWS リソースの撤去漏れと、IaC の管理外にあるリソースを洗い出す。デモや案件を削除したあと、土台を撤去したあと、「ちゃんと消えた？」「残ってない？」「今どれくらい動いてる？」と聞かれたときに使う。セッション開始時に表示される Harness / UserPool / Amplify の件数が想定より多いとき、案件を作る前に前の案件が残っていないか確かめたいとき、しばらく触っていなかったプロジェクトに戻ってきたときにも使う。消したつもりで残っているリソースは課金され続け、次の構築で名前が衝突する。
---

# 撤去漏れと管理外リソースの検出

**消したつもりで残っているリソースは、課金され続け、次の構築で名前が衝突する。**

前身のプロジェクトでは次が起きた。

- Cognito の User Pool がドメインを持ったままで削除に失敗し、気づかず放置
- IAM ロールを画面から作ったため、スタックを消しても残った
- Harness の削除が非同期で、消えたと思って同名を作ろうとして `ConflictException`

## 2 種類の問題を見る

| | 内容 |
|---|---|
| **撤去漏れ** | 消したはずが残っている。課金と名前衝突の原因 |
| **管理外リソース** | IaC の外で作られた。スタックを消しても残る |

後者のほうが厄介である。**存在に気づけない**ため、アカウントに沈殿していく。

## 手順

### 1. IaC が管理しているものを把握する

```bash
aws cloudformation list-stacks --region <region> \
  --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE \
  --query 'StackSummaries[].StackName' --output text

aws cloudformation list-stack-resources --stack-name <name> --region <region> \
  --query 'StackResourceSummaries[].[ResourceType,PhysicalResourceId]' --output text
```

これが**あるべき姿**。ここに無いものは管理外か、撤去漏れである。

### 2. 実際に存在するものを数える

このプロジェクトが使うサービスを横断して数える。

```bash
echo "Harness : $(aws bedrock-agentcore-control list-harnesses --region $AWS_REGION --query 'length(harnesses)' --output text)"
echo "UserPool: $(aws cognito-idp list-user-pools --max-results 60 --region $AWS_REGION --query 'length(UserPools)' --output text)"
echo "Amplify : $(aws amplify list-apps --region $AWS_REGION --query 'length(apps)' --output text)"
```

**数が合わなければ差分を特定する。** 期待値は「土台 1 セット + 稼働中の案件数」。

IAM ロールは名前で絞らない（理由は手順 4）。スタックのリソース一覧から引く。

### 3. 削除中のものを見分ける

**非同期削除に注意する。** 「まだ存在する」のか「削除中」なのかで対処が変わる。

```bash
aws bedrock-agentcore-control list-harnesses --region $AWS_REGION \
  --query 'harnesses[].[harnessName,status]' --output text
```

`DELETING` なら待てば消える。数分かかることがある。
`READY` や `ACTIVE` なら本当に残っている。

### 4. 管理外のリソースを見分ける

**タグの有無だけで判定してはいけない。** このプロジェクトは「土台は CDK、
案件は SDK スクリプト」という分担なので、**案件リソースは設計上 CloudFormation の
タグを持たない**。タグだけで見ると、正常に作られた案件リソースが全部
「管理外」に出て、報告が使い物にならなくなる。

3 つに分けて判定する。

| 分類 | 見分け方 |
|---|---|
| **IaC 管理（土台）** | `aws:cloudformation:stack-name` タグを持つ |
| **想定内（案件）** | タグは無いが、リポジトリにある案件の一覧と対応する |
| **管理外** | どちらでもない |

```bash
# 土台のスタックが持つリソースを正とする
aws cloudformation list-stack-resources --stack-name <name> --region "$AWS_REGION" \
  --query 'StackResourceSummaries[].PhysicalResourceId' --output text
```

案件の一覧は**リポジトリから取る**。どこに置かれるかは構成次第なので、
その時点のディレクトリ構成を見て判断する。

**リソース名の prefix をハードコードしない。** CLAUDE.md は「グローバルに一意な
名前は可変にする」「IAM ロール名はそもそも指定しない」と定めており、
自動命名は `<スタック名>-<論理ID>-<ハッシュ>` のようになる。固定の prefix で
絞ると、命名が変わった瞬間に **0 件ヒットして「問題なし」と報告する**。
撤去漏れ検出の目的がそのまま反転する。

正しい起点は `list-stacks` とリポジトリ内の案件一覧であって、名前の当て推量ではない。

**管理外のものが見つかったら、それがどこから来たかを確認する。**
画面で手作りしたものなら、IaC に取り込むか削除するかを判断する。

### 5. 削除の順序依存を確認する

依存があるリソースは順序を守らないと消せない。IaC を使っていれば
CloudFormation が解決するが、手動で消す場合は自分で守る。

| 対象 | 順序 |
|---|---|
| Cognito User Pool | **ドメインを先に削除**しないと消せない |
| IAM ロール | **インラインポリシーを先に削除** |
| 案件と土台 | **案件を先に削除**。グループやユーザーが User Pool の削除を妨げる |

### 6. 課金が続くものを優先して報告する

すべてのリソースが同じ重さではない。

| | |
|---|---|
| **課金される** | Harness（呼び出しとメモリ保持）、Transaction Search（取り込んだスパン） |
| **ほぼ無料** | Cognito User Pool、IAM ロール、Amplify アプリ（ビルドしなければ） |

**課金されるものを先に報告する。** 「IAM ロールが 1 つ残っています」より
「Harness が 2 件動いています」のほうが先に伝わるべき情報である。

## 報告の形

数だけでなく、**何をすべきか**まで書く。

```markdown
## 撤去漏れ

| リソース | 状態 | 対処 |
|---|---|---|
| Harness `fde_acme` | READY（**課金中**） | 案件の撤去手順を実行する |
| Harness `fde_old` | DELETING | 待てば消える |

## IaC 管理外

| リソース | 経緯の推測 | 対処 |
|---|---|---|
| IAM ロール `MyRole` | 画面から作成された可能性 | 用途を確認。不要なら削除 |

## 問題なし
- Cognito User Pool: 1 件（土台のもの）
- Amplify アプリ: 1 件（土台のもの）
```

## 削除する前に

**削除は不可逆。** 検出した結果をもとに削除を提案するときは、
**何がいくつ消えるかを具体的に述べて承認を得る**。

「残骸を消します」ではなく「Harness 2 件（`fde_acme` / `fde_globex`）と
IAM ロール 1 件を削除します」と書く。
