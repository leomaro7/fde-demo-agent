# 手順書

打ち合わせで聞いた課題を、同日中に触れるプロトタイプとして提示するための手順。
**書きながら実行して作り、直すたびに通し直している。未確認の章は無い。**
経緯となぜそう直したかは [docs/DECISIONS.md](docs/DECISIONS.md)。

先に用語を 4 つ。

| | |
|---|---|
| **土台** | Cognito / Amplify アプリ / Harness 実行ロール。一度だけ作る |
| **案件** | デモ 1 件ぶん。Harness / User Pool Client / グループ / Amplify ブランチ |
| **Harness** | AgentCore の実体。指示文とモデルとツール宣言を持つ。**課金対象** |
| **seed** | 案件のダミーデータ（`demos/<slug>/seed/`）。エージェントがツール経由で引く |

## 誰がやるか

**大半はエージェントに任せられる。** ただし次の 3 つは**人でないと実行できない**。
本文の該当箇所には、引用の形で `人がやる` と目印を付けてある。

| | なぜ人でないと駄目か |
|---|---|
| **1.2 AWS の認証情報** | 本人の資格情報を通す操作。エージェントは代われない |
| **1.5 シェルに `VITE_*` が残っていないか** | **本人のシェルの状態**。エージェントのシェルとは別物で、見えない |
| **7 動作を確認する** | ブラウザ操作。**自動操作は安定しない**（2 回試して 2 回とも途中で止まった） |

**6 章のパスワード入力も端末が要る**が、`--generate-password` を付ければ
エージェントでも通せる（6 章参照）。

**外向き・課金が発生する章（2 / 3 / 4.3 / 5）はエージェントでも流せる。**
ただし作る前に承認を取ること。

## コマンドの読み方

**流さないと先へ進めないコマンドには `必ず実行する。` と書いてある。**

```
1.4  npm install                      依存を入れる
2.2  gh repo create / cd / npm install 企業リポジトリを作って移る（新しいクライアントのときだけ）
3    npx cdk deploy ...Foundation     土台を作る
4.3  npx cdk deploy ...<slug>         案件を作る
5    npx tsx scripts/deploy-web.ts    フロントを配る
6    npx tsx scripts/create-user.ts   ログインする人を作る
8    npx cdk destroy ...              消す（Harness は課金対象）
```

**目印の無いコマンドは 2 種類ある。**

| | 例 | 飛ばすと |
|---|---|---|
| **確認するだけ** | `aws sts get-caller-identity` / `npx cdk list` | 何も起きない。**間違いに気づくのが後になるだけ** |
| **章ごと飛ばせる** | 2 章と 4.4（企業リポジトリのときだけ）/ `npx cdk bootstrap`（未実施のときだけ）/ `unset VITE_*`（出たときだけ） | **当てはまるのに飛ばすと落ちる。** bootstrap 未実施なら 3 章で止まる。**章に入ったら中のコマンドは全部やる** |

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

**リージョンは `ap-northeast-1` 固定。** `aws` を叩くコマンドには毎回 `--region` が
書いてあるが、**`npx cdk` は手元の既定リージョンを見る**。東京以外が既定なら、
このシェルで指定してから進めること。

```bash
export AWS_REGION=ap-northeast-1
```

**複数アカウントを使い分けているなら `AWS_PROFILE` も先に通す。**
`get-caller-identity` に出たアカウントが、作りたい先で合っているかを確かめること。

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

## 2. 企業リポジトリを作る（新しいクライアントのときだけ）

> **承認を取ってから。** GitHub 上に実物を作る操作なので、エージェントでも流せるが
> 勝手にやらせない。`gh repo create` は `.claude/settings.json` の `ask` に入れてある。

**リポジトリはクライアント企業ごとに分ける**（要件書 7.1）。

**今どちらにいるか先に確かめる。**

```bash
git remote -v
```

`fde-demo-agent` が出たら**土台リポジトリ**にいるので、この章をやる。
`fde-demo-<企業>` が出たら既にその企業のリポジトリにいるので、**飛ばして 3 章へ。**

**土台の修正を既存の企業リポジトリへ配る仕組みは無い。**
その時点の土台からコピーして作る、という運用である。

### 2.1 土台リポジトリを template にする（初回だけ）

`<土台リポジトリ>` はこの基盤のリポジトリのこと。**`owner/repo` の形で書く**
（`git remote -v` に出る URL の末尾。この基盤なら `leomaro7/fde-demo-agent`）。

**これをしていないと次のコマンドが失敗する。** まず今の状態を見る。

```bash
gh repo view <土台リポジトリ> --json name,isTemplate,visibility
```

`"isTemplate": false` なら設定する。**一度やれば以降は不要。**

```bash
gh repo edit <土台リポジトリ> --template
```

もう一度 `gh repo view` して `"isTemplate": true` になっていれば通っている。

### 2.2 企業リポジトリを作って、そこへ移る

**必ず実行する。**

```bash
gh repo create fde-demo-<企業> --private --template <土台リポジトリ> --clone
cd fde-demo-<企業>
npm install
```

**`cd` を忘れない。** 以降の 3〜8 章は**すべてこの企業リポジトリの中で実行する。**
土台リポジトリのまま進めると、クライアント固有の情報を**公開リポジトリに置くことになる**
（CLAUDE.md「置いた瞬間に公開事故になる」）。

**`npm install` も忘れない。** テンプレートに `node_modules` は入らないので、
これを飛ばすと 3 章の `npx cdk deploy` が落ちる。

**`--private` を必ず付ける。** 案件ごとにクライアント固有の情報が入る。
`gh repo view fde-demo-<企業> --json visibility` で `PRIVATE` を確かめること。

`git clone` ではなく `--template` を使う理由は、**履歴が入らない**こと。
土台リポジトリの開発履歴（検証用の架空案件を含む）を持ち込まない。

**入るもの・入らないもの**（実測）。

| | 結果 |
|---|---|
| `.claude/`（スキル・エージェント・フック・設定） | **入る。** 隠しディレクトリも来る |
| `docs/`（要件書・判断・設計） | **入る** |
| 開発履歴 | **入らない。** `Initial commit` の 1 つだけ |
| `node_modules/` | 入らない（`npm install` する） |

**`gh` のトークンに `delete_repo` スコープが無いと、作ったリポジトリを `gh` からは消せない。**
試しに作る場合は、画面から消すか `gh auth refresh -s delete_repo` を通しておくこと。

---

## 3. 土台を構築する

**`instance` を決める。** これはグローバルに一意な名前に入る。

| 入る先 | 一意性の範囲 |
|---|---|
| Cognito のドメインプレフィックス | **リージョン内で全 AWS アカウント共通** |
| Amplify アプリ名 | アカウント内 |
| CFn スタック名 | アカウント内 |

**`demo` や `test` のような一般的な語は他社に取られている。**
`fdedemo0809` のように固有性のある短い語にする。
英数字のみ・先頭は文字（`<instance>_<slug>` が 40 文字以内になること）。

**取られていた場合は、デプロイの途中で Cognito ドメインの作成が失敗する。**
`instance` を変えて作り直す（スタック名も変わるので、失敗したスタックは消しておく）。
**どのエラーが出るかは未確認**（衝突させて確かめていない）。

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

**`instance` と、次の章で決まる `slug` は 4〜8 章のほぼ全部で使う。** 控えておくこと。
スタックの出力のほうは控えなくてよい（スクリプトが引く）。

**`instance` を省くと synth で落ちる。** 意図的にそうしてある。

```
Error: instance が指定されていません。`cdk deploy -c instance=<name>` で渡してください。
```

---

## 4. 案件を作る

### 4.1 案件を用意する

**`new-demo` スキルを通す。この章はスキルが全部やる。**
（打ち合わせメモに絶対に書かれない「答えてはいけないこと」を聞き出す手順が入っている）

**止まるのは 2 か所だけ。** 答えてはいけないことを聞くときと、骨子の承認を取るとき。
そこから先は 4.2 の確認と `demo-quality` のレビュー反映まで通しでやり、
**4.3 の手前で止まる**（デプロイは課金が発生するので、そこで一度承認を取る）。

**`slug` はスキルが決める。** 承認を取るときに提示されるが、後から確かめるなら
`ls demos` で分かる（自分が作ったディレクトリ名がそれ）。**4.3 以降でずっと使う。**

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

**既にある案件（見本など）をそのまま使うなら、4.1 は飛ばして 4.3 へ。**

### 4.2 デプロイする前に確認する

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

### 4.3 案件スタックをデプロイする

**必ず実行する。**

```bash
npx cdk deploy FdeDemo-<instance>-<slug> -c instance=<instance> --require-approval never
```

初回は 40 秒ほど（実測 40.2 / 40.5 秒）。2 周目は変更がなければ数秒。

**`DemoUrl` はまだ開いても中身が無い。** フロントを配るのは 5 章。

出力の `DemoUrl` がクライアントに渡す URL、`ClientId` と `HarnessArn` は
フロントのビルドに使う（後述のスクリプトが引く）。

**`demo.ts` の指示文（`systemPrompt`）は Harness に焼かれる。**
変更したらこのコマンドを流し直すこと。**フロントを配り直すだけでは効かない。**
`seed` と `tools.ts` はフロント側なので、そちらは 5 章（フロントを配信する）だけでよい。

### 4.4 見本の案件を消す（企業リポジトリのときだけ）

**土台リポジトリでは消さない。** 見本は土台に残すもの（要件書 4.3）。

自分の案件ができた今が消すタイミング。**先に消すと `tsconfig.json` の `#demo` が
指す先が無くなり、`npx tsc` が通らなくなる。**

まず何があるか見る。**見本は増えていることがある。**

```bash
ls demos
```

**自分の案件以外**を消す。

```bash
rm -rf demos/smoke demos/sales demos/hr
```

続けて 2 か所を直す。

| 直す場所 | 何を |
|---|---|
| `demos/index.ts` | 消した見本の import と登録行を消す（**1 件につき 3 行**） |
| `tsconfig.json` | `#demo` と `#demo-tools` を**自分の案件**に向ける |

```jsonc
"paths": {
  "#demo": ["demos/<slug>/demo.ts"],
  "#demo-tools": ["demos/<slug>/tools.ts"]
}
```

確かめる。

```bash
npx tsc --noEmit
npm test
npx cdk list -c instance=<instance>
```

`cdk list` に**自分の案件だけ**が出れば消せている。

```
FdeDemo-<instance>-Foundation
FdeDemo-<instance>-<slug>
```

型ごとの書き方を参照したいときは土台リポジトリを見る
（要件書 4.3「近い既存案件を見本として参照する。テンプレート化しない」）。

**`docs/sample-meeting-note.md` も消してよい**（`new-demo` を試すための架空メモ）。

---

## 5. フロントを配信する

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

`<AmplifyAppId>` は土台スタックから引く（控えていなくてよい）。

```bash
APP=$(aws cloudformation describe-stacks --region ap-northeast-1 \
  --stack-name FdeDemo-<instance>-Foundation \
  --query 'Stacks[0].Outputs[?OutputKey==`AmplifyAppId`].OutputValue' --output text)

aws amplify list-jobs --region ap-northeast-1 --app-id "$APP" \
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

## 6. デモ用のユーザーを作る

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
| `Group not found.` | 案件スタックが無い（4.3）。**画面から消した場合もこうなる** |
| `ResourceNotFoundException`（User Pool） | 土台スタックが無い（3 章） |
| `InvalidPasswordException` | 規則を満たしていない。8 文字以上・大小英数字・記号 |
| `知らない指定です: --generate-passwd` | 旗の打ち間違い。**黙って無視せず止める**（対話入力待ちで固まる方が分かりにくい）|
| `引数が多すぎます` | slug とユーザー名を取り違えている可能性がある |

**グループに入れ忘れると、ログインはできるが会話で弾かれる。**
そのとき Harness は **HTTP 403 ではなく 500** を返す（画面には
「このアカウントにはこのデモを見る権限がありません」と出る）。

**CDK が作ったグループを画面から消さないこと。** CloudFormation は気づかない
（スタックは `CREATE_COMPLETE` のまま、実体だけ無い状態になる）。2026-08-14 に踏んだ。

---

## 7. 動作を確認する

> **人がやる。** ブラウザの自動操作は安定しない。2026-08-12 と 08-13 に試して、
> どちらも数回の操作で応答が返らなくなった。**ここだけは人が触る**と決めてある。

**クライアントに見せる前に必ず通す。** ここを省くとテストが全部緑でも壊れている
ことがある（実際にあった。`docs/DECISIONS.md` 2026-08-12）。

1. `DemoUrl` をブラウザで開く
2. Cognito のログイン画面に飛ぶ。**6 章で作ったユーザー名**とパスワードで入る
3. 入力欄の上に並ぶ**例示の 3 問を左から順に押す**

見るのは 3 点。

| | 期待 |
|---|---|
| 1・2 問目 | **答える。** そのうえで**根拠の番号**（`【A-001】` `【M-2024-0137】` など、案件で決めた形）が本文に出ている |
| **3 問目** | **答えを拒む。** 断ったうえで**宛先**（どの部署に何を確認するか）まで書いてある |
| 右のトレース | 押すたびに `search（ブラウザ が実行）` と検索語が積まれる。**同じ語を変えて 3 回以上検索していたら、「探すのをやめる条件」が効いていない** |

**期待する文面は案件ごとに違う。** 何が出れば合格かは `demos/<slug>/demo.ts` の
指示文に書いてある（`new-demo` が決めている）。**上の表は形の話**であって、
文言そのものではない。

**3 問目が肝。** ここで無理に答えを作るなら、そのデモは商談に出せない。
運用部門が最も警戒するのが「何でも答える AI」であるため。

### うまくいかないとき

| 症状 | 見るところ |
|---|---|
| 画面に「設定が足りません: VITE_…」 | 5 章のデプロイをやり直す |
| 「このアカウントにはこのデモを見る権限がありません」 | 6 章のグループ追加が漏れている |
| 「ツールの呼び出しが上限（5 回）に達したため中断しました」 | **指示文に「探すのをやめる条件」が無い。** `new-demo` スキルの 4 点目を見る |
| 答えられるはずの質問を拒む | seed に検索語が無い。`tools.ts` の検索は**すべての語を含む項目**しか返さない |
| 指示文を直したのに変わらない | **`systemPrompt` は Harness に焼かれている。** 4.3 を流し直す |

---

## 8. 撤去する

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

**この手順書は書きながら実行して作った**（2026-08-12）。以降も、直すたびに通し直している。
**未確認の章はもう無い。**

| いつ | 何を通したか |
|---|---|
| 2026-08-12 | 書きながら 1 章ずつ実行して作った |
| 2026-08-13 | **何も無い状態から通し**（`instance=fdeverify0813`）。所要時間を実測に合わせ、`vite.config.ts` のバグが 1 件出た |
| 2026-08-14 | 案件を新規で起こし、デモ用ユーザーをスクリプト化し、**企業リポジトリを実際に作った**（最後の未確認だった） |

**経緯と、なぜそう直したかは [docs/DECISIONS.md](docs/DECISIONS.md) にある。**

### 通していない操作

| | なぜ |
|---|---|
| 7 章の動作確認 | **人が手で通している。** ブラウザの自動操作は 2 回試して 2 回とも途中で止まった |
| 2 周目の全章 | 1 周目と 2 周目の差は各章に書いてあるが、**全章を続けて 2 周した検証はしていない** |

**数値はすべて実測。** 所要時間は環境で変わるので、目安として読むこと。
