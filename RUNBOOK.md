# 手順書

打ち合わせで聞いた課題を、同日中に触れるプロトタイプとして提示するための手順。
**この手順書は書きながら実行して作った。** 未確認の箇所は明記してある。

用語は 2 つだけ。

| | |
|---|---|
| **土台** | Cognito / Amplify アプリ / Harness 実行ロール。一度だけ作る |
| **案件** | デモ 1 件ぶん。Harness / User Pool Client / グループ / Amplify ブランチ |

---

## 1. 前提

### 1.1 手元に要るもの

```bash
node --version
npm --version
aws --version
```

確認した組み合わせ。**これより新しければ動く見込みだが、確かめてはいない。**

```
v24.2.0
11.3.0
aws-cli/2.35.21 Python/3.14.6 Darwin/23.4.0 source/arm64
```

**Node は 22 以上が要る。** import attributes（`with { type: 'json' }`）を使っている。

### 1.2 AWS の認証情報

```bash
aws sts get-caller-identity --query '{Account:Account,Arn:Arn}' --output json
```

アカウントと ARN が出れば通っている。出なければ `aws login` などで通す。

### 1.3 CDK の bootstrap

**確認してから実行する。** 済んでいれば飛ばす。

```bash
aws cloudformation describe-stacks --stack-name CDKToolkit --region ap-northeast-1 \
  --query 'Stacks[0].StackStatus' --output text
```

`CREATE_COMPLETE` か `UPDATE_COMPLETE` が出れば済んでいる。
`An error occurred (ValidationError) ... does not exist` なら次を実行する。

```bash
npx cdk bootstrap aws://<アカウントID>/ap-northeast-1
```

### 1.4 依存を入れる

```bash
npm install
```

### 1.5 シェルに `VITE_*` が残っていないか

```bash
env | grep '^VITE_'
```

**何も出ないのが正しい。** 出る場合は、そのシェルで消す。

```bash
unset VITE_AWS_REGION VITE_USER_POOL_ID VITE_USER_POOL_CLIENT_ID \
      VITE_HARNESS_ARN VITE_COGNITO_DOMAIN
```

**毎回出るなら `~/.zshrc`（bash なら `~/.bashrc`）に書かれている。** そちらを消す。

```bash
grep -n 'VITE_' ~/.zshrc
```

別プロジェクトの環境変数が残っていると紛らわしい。
**ビルド側は環境変数を読まないようにしてあるので実害は無い**が、
かつてこれで前身プロジェクトの Cognito ドメインを指したままデプロイした
（`docs/DECISIONS.md` 2026-08-12）。

**警告について。** `npm audit` が推移的依存の脆弱性を報告することがある。
数週間で廃棄するデモ基盤なので、`npm audit fix` は必須ではない。

---

## 1.6 企業リポジトリを作る（新しいクライアントのとき）

**リポジトリはクライアント企業ごとに分ける**（要件書 7.1）。
既にその企業のリポジトリがあるなら、この章は飛ばして 2 章へ。

**土台の修正を既存の企業リポジトリへ配る仕組みは無い。**
その時点の土台からコピーして作る、という運用である。

```bash
gh repo create fde-demo-<企業> --private --template <土台リポジトリ> --clone
```

**`--private` を必ず付ける。** 案件ごとにクライアント固有の情報が入る。

`git clone` ではなく `--template` を使う理由は、**履歴が入らない**こと。
土台リポジトリの開発履歴（検証用の架空案件を含む）を持ち込まない。

作った直後に、**見本の案件を消す。**

```bash
rm -rf demos/smoke demos/sales demos/hr
# demos/index.ts の登録表から 3 行を消し、import も消す
npm install
npx vitest run   # 見本を消したことで落ちるテストがあれば、それも消す
```

`demos/smoke` `demos/sales` `demos/hr` は**土台リポジトリに残す見本**であり、
企業リポジトリには要らない。型ごとの書き方を参照したいときは土台リポジトリを見る
（要件書 4.3「近い既存案件を見本として参照する。テンプレート化しない」）。

### この章は未確認

**実行して確かめていない。** 理由は 2 つ。

- 土台リポジトリが **GitHub 上に存在しない**（このリポジトリにリモートが無い）
- `gh repo create` は `.claude/settings.json` の `deny` に入れてある（意図的）

確認できているのは **`gh repo create` に `--template` `--private` `--clone` の各フラグが
存在すること**だけ（`gh version 2.34.0` で確認）。

**次に実際にこの手順を通す人が、以下を確かめて書き直すこと。**

- テンプレートからのコピーに `.claude/` と `docs/` が含まれるか
- 土台リポジトリを GitHub の template として設定する手順（リポジトリ設定の変更が要る）
- 見本を消したあとにテストが通るか

---

## 2. 土台を構築する

**`instance` を決める。** これはグローバルに一意な名前に入る。

| 入る先 | 一意性の範囲 |
|---|---|
| Cognito のドメインプレフィックス | **リージョン内で全 AWS アカウント共通** |
| Amplify アプリ名 | アカウント内 |
| CFn スタック名 | アカウント内 |

**`demo` や `test` のような一般的な語は他社に取られている。**
`fdedemo0809` のように固有性のある短い語にする。
英数字のみ・先頭は文字（`<instance>_<slug>` が 40 文字以内になること）。

```bash
npx cdk deploy FdeDemo-<instance>-Foundation -c instance=<instance> --require-approval never
```

初回は 50 秒ほど（実測 49.5 / 50.2 秒）。既にある場合は変更がなければ数秒で終わり、出力だけ再表示される。
**2 周目でも壊れない。**

出力の 5 つは後で使う。控えなくてよい（後述のスクリプトが引く）。

```
AmplifyAppId / DiscoveryUrl / ExecutionRoleArn / HostedUiDomain / UserPoolId
```

**`instance` を省くと synth で落ちる。** 意図的にそうしてある。

```
Error: instance が指定されていません。`cdk deploy -c instance=<name>` で渡してください。
```

---

## 3. 案件を追加する

### 3.1 案件を用意する

**まず `new-demo` スキルを通す**
（打ち合わせメモに絶対に書かれない「答えてはいけないこと」を聞き出す手順が入っている）。

**このスキルはファイルを作らない。** 決めるのは中身だけで、型・拒む条件・seed に仕込むもの・
見せる 3 問を決めて、承認を 1 回取ったところで終わる。**ここから先の作成はこの章の作業。**

`demos/<slug>/` に 3 点を置く。

**手元にメモが無い（試すだけ）なら** [docs/sample-meeting-note.md](docs/sample-meeting-note.md)
を使う。架空の打ち合わせメモで、**わざと「答えてはいけないこと」を書いていない**。
これで作ったのが `demos/maint/`。

| ファイル | 中身 |
|---|---|
| `demo.ts` | 指示文・ツール宣言・見せる 3 問・色 |
| `seed/*.json` | ダミーデータ |
| `tools.ts` | 検索処理と、名前 → 関数の登録表 |

**`tools.ts` はテストを書く**（`demos/<slug>/tools.test.ts`）。純粋関数なので TDD の対象。
既存の案件のテストをそのまま真似てよい。**見せる 3 問が seed から本当に引けるかを、
ここで確かめる。** 引けないまま商談に出すのが最悪で、実際に踏んだ（`new-demo` スキル）。

**`demos/index.ts` に 3 行足す。** import 2 行と、登録表の 1 行。

```ts
import { demo as <slug>Demo } from './<slug>/demo.js';      // ← 足す
import { tools as <slug>Tools } from './<slug>/tools.js';   // ← 足す

export const demos: Record<string, DemoEntry> = {
  smoke: { demo: smokeDemo, tools: smokeTools },
  <slug>: { demo: <slug>Demo, tools: <slug>Tools },         // ← 足す
};
```

CDK（`infra/bin/app.ts`）も画面（`web/src/ui/App.tsx`）も、どちらもこの登録表を
見ている。**どちらか片方だけ直すという事故が起きない。**

配信する案件は `scripts/deploy-web.ts` の引数（slug）で決まり、
`VITE_DEMO_SLUG` としてビルドに焼き込まれる。**ソースは書き換えない。**

**`slug` は英数字とハイフン。** `<instance>_<slug>` が 40 文字以内に収まること
（ハイフンは `_` に変換される）。超えると synth で落ちる。

**既にある案件（見本など）をそのまま使うなら、3.1 は飛ばして 3.2 へ。**

### 3.1.1 デプロイする前に確認する

**デプロイは 40 秒かかる。手元で分かる誤りをそこで見つけない。**

```bash
npx tsc --noEmit
npm test
npx cdk list -c instance=<instance>
```

| | 見るところ |
|---|---|
| `tsc --noEmit` | 何も出なければ通っている |
| `npm test` | **失敗が 0 件**なら OK。件数は増えるので数えない |
| `cdk list` | 一覧に `FdeDemo-<instance>-<slug>` が出れば、登録表が CDK 側に効いている |

`cdk list` の出力はこうなる（見本 4 件がある状態）。

```
FdeDemo-<instance>-Foundation
FdeDemo-<instance>-smoke
FdeDemo-<instance>-sales
FdeDemo-<instance>-hr
FdeDemo-<instance>-maint
```

**`-c instance=` を忘れると、次で止まる。** 異常ではない。

```
Error: instance が指定されていません。`cdk deploy -c instance=<name>` で渡してください。
```

**`slug` が 40 文字の制限に触れる場合も、ここで落ちる**（`<instance>_<slug>` が上限）。

### 3.2 案件スタックをデプロイする

```bash
npx cdk deploy FdeDemo-<instance>-<slug> -c instance=<instance> --require-approval never
```

初回は 40 秒ほど（実測 40.2 / 40.5 秒）。2 周目は変更がなければ数秒。

出力の `DemoUrl` がクライアントに渡す URL、`ClientId` と `HarnessArn` は
フロントのビルドに使う（後述のスクリプトが引く）。

**`demo.ts` の指示文（`systemPrompt`）は Harness に焼かれる。**
変更したらこのコマンドを流し直すこと。**フロントを配り直すだけでは効かない。**
`seed` と `tools.ts` はフロント側なので、そちらは 4 章（フロントを配信する）だけでよい。

### 3.3 デモ用のユーザーを作る

**ここだけ IaC に載っていない。** CloudFormation の `AWS::Cognito::UserPoolUser` に
パスワードを設定する手段が無いため（`docs/DECISIONS.md` 2026-08-08）。

**パスワードは手順書にもリポジトリにも書かない。** その場で決めて渡す。

zsh の場合。

```zsh
POOL=<UserPoolId>
read -rs '?デモユーザーのパスワード: ' P; echo
aws cognito-idp admin-create-user --region ap-northeast-1 \
  --user-pool-id "$POOL" --username demo@example.com --message-action SUPPRESS
aws cognito-idp admin-set-user-password --region ap-northeast-1 \
  --user-pool-id "$POOL" --username demo@example.com --password "$P" --permanent
aws cognito-idp admin-add-user-to-group --region ap-northeast-1 \
  --user-pool-id "$POOL" --username demo@example.com --group-name <slug>
unset P
```

**bash では `read -rs -p 'プロンプト: ' P` になる。** zsh の `read -p` は
別の意味（コプロセス）なので、そのままでは動かない。

**2 周目**では 1 つ目がこう出る。**既にユーザーがいるだけなので、そのまま次へ進んでよい。**

```
An error occurred (UsernameExistsException) when calling the AdminCreateUser operation:
User account already exists
```

`admin-set-user-password` と `admin-add-user-to-group` は**何度実行してもよい**
（2 周目でもエラーにならないことを確認済み）。

**パスワードは 8 文字以上で、大文字・小文字・数字・記号を含めること。**
`read` が失敗して空のまま渡すと、こう出る。

```
Value at 'password' failed to satisfy constraint:
Member must satisfy regular expression pattern: ^[\S]+.*[\S]+$
```

**`<slug>` のグループに入れ忘れると、ログインはできるが会話で弾かれる。**
そのとき Harness は **HTTP 403 ではなく 500** を返す（画面には
「このアカウントにはこのデモを見る権限がありません」と出る）。

---

## 4. フロントを配信する

```bash
npx tsx scripts/deploy-web.ts <instance> <slug>
```

ビルドから反映まで数秒で終わる。次が出れば投げ終わっている。

```
Instance '<instance>' の Slug '<slug>' で web/.env.local を上書きします
...
デモの URL: https://<slug>.<appId>.amplifyapp.com
```

**このコマンドは `web/.env.local` を上書きする。** 別の案件をローカルで
触っている最中に実行すると、ローカルの向き先が変わる。だから 1 行目を出している。

反映の完了を確認する。

```bash
aws amplify list-jobs --region ap-northeast-1 --app-id <AmplifyAppId> \
  --branch-name <slug> --max-results 1 \
  --query 'jobSummaries[0].{jobId:jobId,status:status}' --output json
```

`"status": "SUCCEED"` になれば見られる。数十秒かかることがある。

**リポジトリは接続していない。** ZIP を上げる方式なので、GitHub のアクセストークンは
要らない（`docs/DECISIONS.md` / 設計書 4.1）。push しても何も起きない。

### ローカルで動かす場合

```bash
npx tsx scripts/stack-outputs.ts <instance> <slug> > web/.env.local
npm run dev
```

`http://localhost:5173/` が開く（この URL は User Pool Client のコールバックに
登録済み）。**`web/.env.local` はコミットしないこと**（`.gitignore` の `.env.*` で除外済み）。

---

## 5. 動作を確認する

**クライアントに見せる前に必ず通す。** ここを省くとテストが全部緑でも壊れている
ことがある（実際にあった。`docs/DECISIONS.md` 2026-08-12）。

1. `DemoUrl` をブラウザで開く
2. Cognito のログイン画面に飛ぶ。`demo@example.com` と 3.3 で決めたパスワードで入る
3. 入力欄の上に並ぶ**例示の 3 問を左から順に押す**

見るのは 3 点。

| | 期待 |
|---|---|
| 1・2 問目 | **答える。** 項番（`【A-001】` など）と条番号が付いている |
| **3 問目** | **答えを拒む。** 「規程には定めがないため、〜への確認が必要です」と、確認すべき事項を箇条書きで示す |
| 右のトレース | 押すたびに `search（ブラウザ が実行）` と検索語が積まれる |

**3 問目が肝。** ここで無理に答えを作るなら、そのデモは商談に出せない。
運用部門が最も警戒するのが「何でも答える AI」であるため。

### うまくいかないとき

| 症状 | 見るところ |
|---|---|
| 画面に「設定が足りません: VITE_…」 | 4 章のデプロイをやり直す |
| 「このアカウントにはこのデモを見る権限がありません」 | 3.3 のグループ追加が漏れている |
| 「ツールの呼び出しが上限（5 回）に達したため中断しました」 | **指示文に「探すのをやめる条件」が無い。** `new-demo` スキルの 4 点目を見る |
| 答えられるはずの質問を拒む | seed に検索語が無い。`tools.ts` の検索は**すべての語を含む項目**しか返さない |
| 指示文を直したのに変わらない | **`systemPrompt` は Harness に焼かれている。** 3.2 を流し直す |

---

## 6. 撤去する

**Harness は課金対象。** 使い終わったら消すこと。

**案件 → 土台の順に消す。** 逆順はできない（案件が土台の値を `ImportValue` で
参照しているため、案件が残っていると土台の削除が拒否される）。

```bash
npx cdk destroy FdeDemo-<instance>-<slug> -c instance=<instance> --force
npx cdk destroy FdeDemo-<instance>-Foundation -c instance=<instance> --force
```

**`--force` を付けないと確認を求められる。** 対話で消すなら外してよい。

実測した所要時間。**案件のほうは大きくばらつく。**

| | 時間 |
|---|---|
| 案件（Harness を含む） | **64 秒 〜 10 分以上**。実測で 64 / 125 / 186 秒、および 10 分でも終わらなかった回がある |
| 土台（User Pool・Amplify・IAM） | 30〜35 秒（安定している） |

**Harness の削除時間が読めない。** 3 案件をまとめて消すつもりで待つと、
10 分では終わらないことがある。**1 件ずつ流し、待てる時間を確保してから始めること。**
急ぐ場面（次の構築が控えている等）で始めないほうがよい。

**削除の順序は CloudFormation が解く。** 土台では Cognito のドメインが
User Pool より先に消えることを確認した。手で消す場合はこの順序を自分で守る必要がある。

### 残骸を確認する

```bash
R=ap-northeast-1
aws cloudformation list-stacks --region $R \
  --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE \
  --query 'StackSummaries[].StackName' --output text
echo "Harness : $(aws bedrock-agentcore-control list-harnesses --region $R --query 'length(harnesses)' --output text)"
echo "UserPool: $(aws cognito-idp list-user-pools --max-results 60 --region $R --query 'length(UserPools)' --output text)"
echo "Amplify : $(aws amplify list-apps --region $R --query 'length(apps)' --output text)"
```

**見るのは `FdeDemo-` で始まるスタックが残っていないことと、3 つの数が 0 であること。**

```
Harness : 0
UserPool: 0
Amplify : 0
```

**スタック一覧には無関係なものが並ぶ。** `CDKToolkit` は bootstrap のスタックで
残ってよい。**共用アカウントでは他プロジェクトのスタックも出る**
（2026-08-13 の実測では `AgentCore-TemporalDemo-default` と `llm-ab` が並んだ）。
**`FdeDemo-` 以外は触らないこと。**

`FdeDemo-` だけを見るならこう絞る。

```bash
aws cloudformation list-stacks --region $R \
  --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE DELETE_IN_PROGRESS DELETE_FAILED \
  --query 'StackSummaries[?starts_with(StackName, `FdeDemo-`)].{Name:StackName,Status:StackStatus}' \
  --output table
```

**何も出なければ撤去できている。**

**Harness / UserPool / Amplify の数も、他プロジェクトが使っていれば 0 にならない。**
その場合は数ではなく名前で見る（`FdeDemo-<instance>` や `<instance>_<slug>`）。

数が合わない、あるいは `DELETING` が残っている場合は `cleanup-check` スキルを使う。
`DELETING` は待てば消えるが、**完了前に同名で作ると `ConflictException`** になる。

---

## 検証の状況

**この手順書は 2026-08-12 に、書きながら実行して作った。**

| 章 | 状態 |
|---|---|
| 1 前提 | 実行。`VITE_*` の検出も実際に引っかかることを確認 |
| **初回構築からの通し** | **2026-08-13 に実行**（何も無い状態から `instance=fdeverify0813` で構築）。**1〜5 章が通った**（5 章は人が手で実施） |
| 1.6 企業リポジトリを作る | **未実行。** 土台リポジトリが GitHub 上に無く、`gh repo create` は deny に入れてある。フラグの存在のみ確認 |
| 2 土台を構築 | 実行。**2 周目**（既にある状態）で 3 秒・出力再表示を確認 |
| 3.1 案件を用意 | 実行。**2026-08-14 に `maint` を新規で起こし、書き足りない箇所を直した**（下記） |
| 3.1.1 デプロイ前の確認 | 実行（`tsc` / `npm test` / `cdk list`）。**2026-08-14 に追加した章** |
| 3.2 案件スタックをデプロイ | 実行。**2 周目**で 4 秒 |
| 3.3 デモユーザー | 実行。**2 周目**で `UsernameExistsException` が出ること、パスワード設定とグループ追加は何度でも通ることを確認 |
| 4 フロントを配信 | 実行。ジョブが `SUCCEED` になるまで確認。ローカル開発も起動を確認 |
| 5 動作を確認 | **実行。ブラウザで 3 問を通した**（2026-08-12 と 2026-08-13 の 2 回）。1・2 問目は根拠つきで回答、3 問目は拒否。**人が手で実施する必要がある**（自動操作は安定しない） |
| 6 撤去 | **2026-08-13 の初回構築の通しでも実行**。案件 186 秒 / 土台 30 秒。`FdeDemo-*` の残骸ゼロを確認。**期待される出力の書き方が共用アカウントで通用しないことが分かり、直した** |

**2026-08-13 に、何も無い状態から通した。** 1〜4 章はそのまま通り、
所要時間の記述を実測に合わせて直した（土台 40→50 秒、案件 30→40 秒）。

この通しで**実際のバグが 1 件出た。** `vite.config.ts` の `define` に
キーがべた書きされており、`VITE_DEMO_SLUG` を足し忘れていた。
配信物には焼き込まれず、**画面が「設定が足りません」で止まった。**
ビルドは通り、バンドルの grep でも気づけない。**画面を開いて初めて分かった。**

**5 章（動作確認）の 3 問も 2026-08-13 に通した。**
1・2 問目は `【A-001】規程12条` `【A-002】規程8条` を根拠に答え、
3 問目は「規程には定めがないため、総務部への確認が必要です」と拒んで
確認すべき事項を 3 点示した。**期待どおり。**

**ただしこれは人が手で通した。** ブラウザの自動操作は安定しないため、
**5 章だけは人の手が要る**と考えておくこと。

### 2026-08-14: 3.1 を新しい案件で通して、3 箇所を直した

`docs/sample-meeting-note.md` から `demos/maint/` を起こした。**3.1 の欠陥が 3 つ出た。**

| 何が起きたか | どう直したか |
|---|---|
| `new-demo` がどこまでやるのか書いておらず、**スキルがファイルを作ると読めた** | 「このスキルはファイルを作らない」と明記 |
| 「登録表に **1 行**足す。これだけでよい」と書いてあったが、**実際は import 2 行を含む 3 行** | 3 行に直した。設計書の「クライアント固有は登録表の 1 行だけ」（＝情報がどこに閉じているかの話）を、編集行数の話と取り違えていた |
| **デプロイ前に何を確認するかが書かれていない。** 実際には `tsc` / `npm test` / `cdk list` を回した | 3.1.1 として章を足した |

**3 つ目が最も悪い。** 手順書に無い操作を補って進んだので、
**書いていなかったこと自体が見えなくなっていた**（`verify-runbook` が名指しで禁じている）。
読者は補完できない。

**`maint` は AWS にデプロイしていない。** 3.2 以降は通していない。

**6 章（撤去）もこの通しで実行した。** 案件 186 秒・土台 30 秒。
`FdeDemo-*` が残っていないことを確認している。

**1.6（企業リポジトリを作る）だけが未実行。** 理由は 1.6 に書いてある。
