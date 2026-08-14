# 手順書

打ち合わせで聞いた課題を、同日中に触れるプロトタイプとして提示するための手順。
**この手順書は書きながら実行して作った。** 未確認の箇所は明記してある。

用語は 2 つだけ。

| | |
|---|---|
| **土台** | Cognito / Amplify アプリ / Harness 実行ロール。一度だけ作る |
| **案件** | デモ 1 件ぶん。Harness / User Pool Client / グループ / Amplify ブランチ |

## 誰がやるか

**大半はエージェントに任せられる。** ただし次の 4 つは**人でないと実行できない**。
本文の該当箇所には、引用の形で `人がやる` と目印を付けてある。

| | なぜ人でないと駄目か |
|---|---|
| **1.2 AWS の認証情報** | 本人の資格情報を通す操作。エージェントは代われない |
| **1.5 シェルに `VITE_*` が残っていないか** | **本人のシェルの状態**。エージェントのシェルとは別物で、見えない |
| **1.6 企業リポジトリを作る** | `gh repo create` は許可リストの外。GitHub の認証も要る |
| **6 動作を確認する** | ブラウザ操作。**自動操作は安定しない**（2 回試して 2 回とも途中で止まった） |

**5 章のパスワード入力も端末が要る**が、`--generate-password` を付ければ
エージェントでも通せる（5 章参照）。

**課金が発生する章（2 / 3.2 / 4）はエージェントでも流せる。**
ただし作る前に承認を取ること。

## コマンドの読み方

**流さないと先へ進めないコマンドには `必ず実行する。` と書いてある。** 全部で 6 つ。

```
1.4 npm install                    依存を入れる
2   npx cdk deploy ...Foundation   土台を作る
3.2 npx cdk deploy ...<slug>       案件を作る
4   npx tsx scripts/deploy-web.ts  フロントを配る
5   npx tsx scripts/create-user.ts ログインする人を作る
7   npx cdk destroy ...            消す（Harness は課金対象）
```

**目印の無いコマンドは 2 種類ある。**

| | 例 | 飛ばすと |
|---|---|---|
| **確認するだけ** | `aws sts get-caller-identity` / `npx cdk list` | 何も起きない。**間違いに気づくのが後になるだけ** |
| **当てはまるときだけ** | `npx cdk bootstrap` / `unset VITE_*` / `gh repo create` | **当てはまるのに飛ばすと落ちる。** bootstrap 未実施なら 2 章で止まる |

だから確認のコマンドは先に流すほうが速い。**40 秒かけてデプロイしてから気づかない。**

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

> **人がやる。** 本人の資格情報を通す操作なので、エージェントは代われない。

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

**必ず実行する。**

```bash
npm install
```

### 1.5 シェルに `VITE_*` が残っていないか

> **人がやる。** 見るのは**本人のシェルの状態**で、エージェントのシェルとは別物。
> エージェント側で `env | grep` しても、あなたのシェルのことは分からない。

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

> **人がやる。** `gh repo create` は許可リストの外に置いてある。GitHub の認証も要る。

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

**必ず実行する。**

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

**`new-demo` スキルを通す。この章はスキルが全部やる。**
（打ち合わせメモに絶対に書かれない「答えてはいけないこと」を聞き出す手順が入っている）

**止まるのは 2 か所だけ。** 答えてはいけないことを聞くときと、骨子の承認を取るとき。
そこから先は 3.1.1 の確認と `demo-quality` のレビュー反映まで通しでやり、
**3.2 の手前で止まる**（デプロイは課金が発生するので、そこで一度承認を取る）。

以下は**中身の説明と、手で作る場合の手順**。スキルに任せるなら読まなくてよい。

`demos/<slug>/` に 3 点を置く。

**手元にメモが無い（試すだけ）なら** [docs/sample-meeting-note.md](docs/sample-meeting-note.md)
を使う。架空の打ち合わせメモで、**わざと「答えてはいけないこと」を書いていない**。

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

`cdk list` の出力はこうなる（見本 3 件 + 追加した案件）。

```
FdeDemo-<instance>-Foundation
FdeDemo-<instance>-smoke
FdeDemo-<instance>-sales
FdeDemo-<instance>-hr
FdeDemo-<instance>-<slug>
```

**`-c instance=` を忘れると、次で止まる。** 異常ではない。

```
Error: instance が指定されていません。`cdk deploy -c instance=<name>` で渡してください。
```

**`slug` が 40 文字の制限に触れる場合も、ここで落ちる**（`<instance>_<slug>` が上限）。

### 3.2 案件スタックをデプロイする

**必ず実行する。**

```bash
npx cdk deploy FdeDemo-<instance>-<slug> -c instance=<instance> --require-approval never
```

初回は 40 秒ほど（実測 40.2 / 40.5 秒）。2 周目は変更がなければ数秒。

出力の `DemoUrl` がクライアントに渡す URL、`ClientId` と `HarnessArn` は
フロントのビルドに使う（後述のスクリプトが引く）。

**`demo.ts` の指示文（`systemPrompt`）は Harness に焼かれる。**
変更したらこのコマンドを流し直すこと。**フロントを配り直すだけでは効かない。**
`seed` と `tools.ts` はフロント側なので、そちらは 4 章（フロントを配信する）だけでよい。

## 4. フロントを配信する

**必ず実行する。**

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

## 5. デモ用のユーザーを作る

> **対話入力は人がやる。** ただし `--generate-password` を付ければエージェントでも通せる。

**ここだけ IaC に載っていない。** CloudFormation の `AWS::Cognito::UserPoolUser` に
パスワードを設定する手段が無いため（`docs/DECISIONS.md` 2026-08-08）。

**使う直前に作る。** パスワードは次の章ですぐ使う。

**必ず実行する。**

```bash
npx tsx scripts/create-user.ts <instance> <slug> [ユーザー名]
```

パスワードを聞かれる。**入力は表示されない。**

```
User Pool: ap-northeast-1_XXXXXXXXX
ユーザー : demo@example.com（グループ: <slug>）
パスワード（表示されません）:
作成しました。
パスワードを設定しました（CONFIRMED）。
グループ <slug> に入れました。
```

**ユーザー名は案件ごとに変えられる。** 省くと `demo@example.com` になる。

```bash
npx tsx scripts/create-user.ts <instance> <slug> hozen@<クライアントのドメイン>
```

**これはクライアントのログイン画面に出る。** 業務に近い名前にしておくと、
その場で「自分たちのもの」として見てもらえる。逆に `demo@example.com` のままだと
当社の都合が見えるので、商談で見せる案件では変えること。

**メールアドレスの形にする。** User Pool が email をログイン ID にしているため
（`signInAliases: { email: true }`）。実在しなくてよい（招待メールは送らない）。

> **この対話入力だけ未確認。** 端末が要るため、エージェントからは実行できていない
> （Claude Code の `!` も端末にはならない）。パスワード入力以降の 3 つの API 呼び出しは
> `--generate-password` で実測済み。**最初に人が打つときに、ここだけ確かめること。**

**User Pool ID は土台スタックから引く。** 人が値をコピーすると必ず間違える。

**パスワードは手順書にもリポジトリにも書かない。** その場で決めて渡す。
8 文字以上で、大文字・小文字・数字・記号を含めること。

**2 周目**はこう出る。**作り直さずに、パスワードとグループだけ設定し直す。**
間違えて覚えたときは、同じコマンドをもう一度実行すればよい。

```
既にいます。パスワードとグループだけ設定し直します。
```

### 端末を使えないとき

エージェントに流させる場合など、対話入力ができないときは次を付ける。
**その場で作って一度だけ表示する。**

```bash
npx tsx scripts/create-user.ts <instance> <slug> --generate-password
```

```
グループ <slug> に入れました。

パスワード: （ここに出る）
これ以降は表示できません。入れ直すには同じコマンドをもう一度実行すること。
```

**付けない限り、標準入力からは読まない。** 複数行をまとめて貼り付けたときに
次の行がそのままパスワードになる事故を塞いである。

### つまずいたとき

| 出るもの | 意味 |
|---|---|
| `Group not found.` | 案件スタックが無い（3.2）。**画面から消した場合もこうなる** |
| `ResourceNotFoundException`（User Pool） | 土台スタックが無い（2 章） |
| `InvalidPasswordException` | 規則を満たしていない。8 文字以上・大小英数字・記号 |
| `知らない指定です: --generate-passwd` | 旗の打ち間違い。**黙って無視せず止める**（対話入力待ちで固まる方が分かりにくい）|
| `引数が多すぎます` | slug とユーザー名を取り違えている可能性がある |

**グループに入れ忘れると、ログインはできるが会話で弾かれる。**
そのとき Harness は **HTTP 403 ではなく 500** を返す（画面には
「このアカウントにはこのデモを見る権限がありません」と出る）。

**CDK が作ったグループを画面から消さないこと。** CloudFormation は気づかない
（スタックは `CREATE_COMPLETE` のまま、実体だけ無い状態になる）。2026-08-14 に踏んだ。

---

## 6. 動作を確認する

> **人がやる。** ブラウザの自動操作は安定しない。2026-08-12 と 08-13 に試して、
> どちらも数回の操作で応答が返らなくなった。**ここだけは人が触る**と決めてある。

**クライアントに見せる前に必ず通す。** ここを省くとテストが全部緑でも壊れている
ことがある（実際にあった。`docs/DECISIONS.md` 2026-08-12）。

1. `DemoUrl` をブラウザで開く
2. Cognito のログイン画面に飛ぶ。**5 章で作ったユーザー名**とパスワードで入る
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
| 「このアカウントにはこのデモを見る権限がありません」 | 5 章のグループ追加が漏れている |
| 「ツールの呼び出しが上限（5 回）に達したため中断しました」 | **指示文に「探すのをやめる条件」が無い。** `new-demo` スキルの 4 点目を見る |
| 答えられるはずの質問を拒む | seed に検索語が無い。`tools.ts` の検索は**すべての語を含む項目**しか返さない |
| 指示文を直したのに変わらない | **`systemPrompt` は Harness に焼かれている。** 3.2 を流し直す |

---

## 7. 撤去する

**Harness は課金対象。** 使い終わったら消すこと。

**案件 → 土台の順に消す。** 逆順はできない（案件が土台の値を `ImportValue` で
参照しているため、案件が残っていると土台の削除が拒否される）。

**必ず実行する。**

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
| **初回構築からの通し** | **2026-08-13 に実行**（何も無い状態から `instance=fdeverify0813` で構築）。**当時の 1〜5 章が通った**（動作確認は人が手で実施） |
| 1.6 企業リポジトリを作る | **未実行。** 土台リポジトリが GitHub 上に無く、`gh repo create` は deny に入れてある。フラグの存在のみ確認 |
| 2 土台を構築 | 実行。**2 周目**（既にある状態）で 3 秒・出力再表示を確認 |
| 3.1 案件を用意 | 実行。**2026-08-14 に `maint` を新規で起こし、書き足りない箇所を直した**（下記） |
| 3.1.1 デプロイ前の確認 | 実行（`tsc` / `npm test` / `cdk list`）。**2026-08-14 に追加した章** |
| 3.2 案件スタックをデプロイ | 実行。**2 周目**で 4 秒 |
| 5 デモ用のユーザー | 実行。**2026-08-14 にスクリプト化し、章を 4 章の後ろへ移した**（下記）|
| 4 フロントを配信 | 実行。ジョブが `SUCCEED` になるまで確認。ローカル開発も起動を確認 |
| 5 動作を確認 | **実行。ブラウザで 3 問を通した**（2026-08-12 と 2026-08-13 の 2 回）。1・2 問目は根拠つきで回答、3 問目は拒否。**人が手で実施する必要がある**（自動操作は安定しない） |
| 6 撤去 | **2026-08-13 の初回構築の通しでも実行**。案件 186 秒 / 土台 30 秒。`FdeDemo-*` の残骸ゼロを確認。**期待される出力の書き方が共用アカウントで通用しないことが分かり、直した** |

**2026-08-13 に、何も無い状態から通した。** 1〜4 章はそのまま通り、
所要時間の記述を実測に合わせて直した（土台 40→50 秒、案件 30→40 秒）。

この通しで**実際のバグが 1 件出た。** `vite.config.ts` の `define` に
キーがべた書きされており、`VITE_DEMO_SLUG` を足し忘れていた。
配信物には焼き込まれず、**画面が「設定が足りません」で止まった。**
ビルドは通り、バンドルの grep でも気づけない。**画面を開いて初めて分かった。**

**動作確認の 3 問も 2026-08-13 に通した。**
1・2 問目は `【A-001】規程12条` `【A-002】規程8条` を根拠に答え、
3 問目は「規程には定めがないため、総務部への確認が必要です」と拒んで
確認すべき事項を 3 点示した。**期待どおり。**

**ただしこれは人が手で通した。** ブラウザの自動操作は安定しないため、
**動作確認だけは人の手が要る**と考えておくこと。

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

**そのうえで `new-demo` の担当範囲を広げた。** 骨子を決めるところで終わっていたため、
ファイル作成・登録表・テスト・確認が全部人の作業として残っていた。
**同日中に見せるという目的に対して、人がやる範囲が多すぎた。**
いまはメモから 3.1.1 の確認と `demo-quality` の反映まで通しでやり、3.2 の手前で止まる。

### 2026-08-14: デモ用のユーザーをスクリプトにして、章を後ろへ移した

**手で 3 コマンド叩く形だったのを `scripts/create-user.ts` にまとめた。**
残っていた手作業がここに集中しており、**実際に 2 回事故った**ため。

| 起きたこと | どう塞いだか |
|---|---|
| zsh の `read -p` はコプロセスの意味で、bash 用の書き方が動かない | シェルに依存しなくなった |
| 複数行を貼ると `read` が次の行を読む・後続が端末入力待ちで止まる | **端末でないときは読まない。**`--generate-password` を使わせる |
| `<UserPoolId>` を人が貼っていた | 土台スタックから引く |
| 3 つのうち一部だけ効いた状態が見分けられない | 1 コマンドで、どこまで進んだか出る |

**章を 3.3 から 5 へ移した。** パスワードを使うのは動作確認で、間に配信の 1 章が
挟まっていた。**使う直前に作るほうが自然**という指摘による。依存関係の上でも、
必要なのは土台（2 章）とグループ（3.2）だけで、配信には依存していない。

**`instance=fdeuser0814` で通した**（土台 50 秒 / 案件 31 秒）。1 周目・2 周目とも
`CONFIRMED` + グループ付与を確認。グループが無い状態も試し、助言が出ることを確認した。
**撤去まで実行**（案件 131 秒 / 土台 35 秒、残骸ゼロ）。
**ユーザーが残ったままでも User Pool は消えた。**

**ただし対話入力の経路だけ実行していない。** 端末が要るため、エージェントからは
流せない（`--generate-password` を足したのはこれが理由）。5 章にその旨を明記してある。

**ユーザー名を案件ごとに変えられることも、同じ環境で通した**（`hozen@sample-foods.example.com`
で作成し、`email` 属性・`CONFIRMED`・グループ付与を確認）。**引数は前からあったが、
手順書に書いていなかった。** あるのに書かれていない機能は無いのと同じなので追記した。

**`maint` はリポジトリから消した**（コミット `d6eff56` に残っている）。
広げた `new-demo` を**別のセッションで通しで試すため**。既にあると経路を通せない。
AWS にはデプロイしていないので、消したのはファイルだけ。3.2 以降は通していない。

**撤去もこの通しで実行した。** 案件 186 秒・土台 30 秒。
`FdeDemo-*` が残っていないことを確認している。

**1.6（企業リポジトリを作る）だけが未実行。** 理由は 1.6 に書いてある。
