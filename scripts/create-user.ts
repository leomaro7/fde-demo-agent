/**
 * デモ用の Cognito ユーザーを作る。
 *
 * 使い方:
 *   npx tsx scripts/create-user.ts <instance> <slug> [ユーザー名]
 *
 * **ここだけ IaC に載っていない。** CloudFormation の `AWS::Cognito::UserPoolUser` に
 * パスワードを設定する手段が無いため（docs/DECISIONS.md 2026-08-08）。
 *
 * 手で 3 コマンド叩く形だったのをまとめた。理由は 2 つとも実際に踏んだもの。
 *
 * 1. **zsh と bash で `read` の書き方が違う。** zsh の `read -p` はコプロセスの意味で、
 *    bash 用の `read -rs -p` をそのまま打つと `no coprocess` で落ちる
 * 2. **複数行をまとめて貼ると途中で崩れる。** `read` が次の行を読み込んだり、
 *    後続の aws が端末入力待ちで停止したりする。3 つのうち一部だけ効いた状態は
 *    見分けが付かない（ログインはできるのに会話だけ弾かれる）
 *
 * **User Pool ID もスタックから引く。** 人が値をコピーすると必ず間違える。
 *
 * パスワードは受け取るだけで、保存も表示もしない。
 * ただし `--password` は aws プロセスの引数に乗るので、同じマシンの `ps` からは見える。
 * 手で叩いていたときと同じ性質で、ここでは許容している（数週間で捨てるデモのため）。
 */
import { execFileSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { createInterface } from 'node:readline';

const REGION = 'ap-northeast-1';

/**
 * Cognito の既定の規則を満たすパスワードを作る。
 *
 * **`--generate-password` を付けたときだけ使う。** 人が端末から打てないとき
 * （エージェントが流すとき）に、手作業を挟まずに通すため。
 * 作った値は一度だけ表示する。数時間で捨てるデモの資格情報なので、
 * 画面と会話ログに残ることは許容している。
 *
 * 記号は URL とシェルで扱いを間違えないものだけに絞る。
 */
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnpqrstuvwxyz';
const DIGIT = '23456789';
const SYMBOL = '-_.!*';

export function generatePassword(length = 20): string {
  if (length < 8) throw new Error('パスワードは 8 文字以上にすること。');
  const all = UPPER + LOWER + DIGIT + SYMBOL;
  // 各種を 1 文字ずつ確実に入れる。足りないと InvalidPasswordException になる
  const chars = [UPPER, LOWER, DIGIT, SYMBOL].map((set) => set[randomInt(set.length)]);
  while (chars.length < length) chars.push(all[randomInt(all.length)]);
  // 先頭 4 文字が種類順に並ばないよう混ぜる
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/** 既定のユーザー名。クライアントに見せる画面には出ない。 */
export const DEFAULT_USERNAME = 'demo@example.com';

export function createUserArgs(o: { poolId: string; username: string }): string[] {
  return [
    'cognito-idp', 'admin-create-user',
    '--user-pool-id', o.poolId,
    '--username', o.username,
    // 招待メールを送らない。宛先が実在しないうえ、デモに不要
    '--message-action', 'SUPPRESS',
  ];
}

export function setPasswordArgs(o: {
  poolId: string;
  username: string;
  password: string;
}): string[] {
  return [
    'cognito-idp', 'admin-set-user-password',
    '--user-pool-id', o.poolId,
    '--username', o.username,
    '--password', o.password,
    // これが無いと FORCE_CHANGE_PASSWORD のままで、ログイン時に変更を求められる
    '--permanent',
  ];
}

export function addToGroupArgs(o: {
  poolId: string;
  username: string;
  group: string;
}): string[] {
  return [
    'cognito-idp', 'admin-add-user-to-group',
    '--user-pool-id', o.poolId,
    '--username', o.username,
    '--group-name', o.group,
  ];
}

/**
 * 2 周目で出るエラーかどうか。
 *
 * **既にユーザーがいるだけなので、続けてよい。** ここで止めると、
 * パスワードを入れ直したいだけのときに毎回スタックから作り直すことになる。
 */
export function isAlreadyExists(message: string): boolean {
  return message.includes('UsernameExistsException');
}

/**
 * 失敗したときに何をすればよいかを、AWS のエラーから決める。
 *
 * 素の `ValidationException` だけ見せても、次の一手が分からない。
 */
export function hintFor(message: string): string | undefined {
  if (message.includes('InvalidPasswordException') || message.includes("at 'password'")) {
    return 'パスワードは 8 文字以上で、大文字・小文字・数字・記号を含めること。';
  }
  if (message.includes('ResourceNotFoundException') && message.includes('Group')) {
    return 'グループがありません。案件スタックをデプロイしたか確認すること（RUNBOOK 3.2）。'
      + '画面から消した場合もこうなる。';
  }
  if (message.includes('ResourceNotFoundException')) {
    return 'User Pool がありません。土台スタックを確認すること（RUNBOOK 2）。';
  }
  return undefined;
}

interface ExecError {
  stderr?: string;
  message?: string;
}

function aws(args: string[]): string {
  return execFileSync('aws', [...args, '--region', REGION], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** 失敗したら stderr を投げ直す。execFileSync の既定のメッセージには理由が入らない。 */
function awsOrThrow(args: string[]): string {
  try {
    return aws(args);
  } catch (e) {
    const err = e as ExecError;
    throw new Error((err.stderr ?? err.message ?? '').trim());
  }
}

function userPoolId(instance: string): string {
  const raw = awsOrThrow([
    'cloudformation', 'describe-stacks',
    '--stack-name', `FdeDemo-${instance}-Foundation`,
    '--query', 'Stacks[0].Outputs[?OutputKey==`UserPoolId`].OutputValue',
    '--output', 'text',
  ]);
  const id = raw.trim();
  if (!id) throw new Error(`土台スタック FdeDemo-${instance}-Foundation に UserPoolId がありません。`);
  return id;
}

/**
 * パスワードを画面に出さずに受け取る。
 *
 * **端末でないときは受け付けない。** パイプや貼り付けから読むと、
 * 意図しない文字列がそのままパスワードになる。実際に踏んだ形なので塞いでおく。
 */
function promptPassword(label: string): Promise<string> {
  if (!process.stdin.isTTY) {
    return Promise.reject(
      new Error(
        '端末から実行してください（パスワードを標準入力から読み取りません）。\n'
          + '端末を使えないなら --generate-password を付けること。'
          + 'その場で作って一度だけ表示します。',
      ),
    );
  }
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const sink = rl as unknown as { _writeToOutput: (s: string) => void };
    let muted = false;
    sink._writeToOutput = (s: string) => {
      if (!muted) process.stdout.write(s);
    };
    rl.question(label, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    muted = true;
  });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const generate = argv.includes('--generate-password');
  const [instance, slug, username = DEFAULT_USERNAME] = argv.filter((a) => !a.startsWith('--'));
  if (!instance || !slug) {
    throw new Error(
      '使い方: npx tsx scripts/create-user.ts <instance> <slug> [ユーザー名] [--generate-password]',
    );
  }

  const poolId = userPoolId(instance);
  console.log(`User Pool: ${poolId}`);
  console.log(`ユーザー : ${username}（グループ: ${slug}）`);

  const password = generate ? generatePassword() : await promptPassword('パスワード（表示されません）: ');

  try {
    awsOrThrow(createUserArgs({ poolId, username }));
    console.log('作成しました。');
  } catch (e) {
    const message = (e as Error).message;
    if (!isAlreadyExists(message)) throw e;
    console.log('既にいます。パスワードとグループだけ設定し直します。');
  }

  awsOrThrow(setPasswordArgs({ poolId, username, password }));
  console.log('パスワードを設定しました（CONFIRMED）。');

  awsOrThrow(addToGroupArgs({ poolId, username, group: slug }));
  console.log(`グループ ${slug} に入れました。`);

  // 生成したときだけ出す。人が打ったパスワードは画面に出さない
  if (generate) {
    console.log(`\nパスワード: ${password}`);
    console.log('これ以降は表示できません。入れ直すには同じコマンドをもう一度実行すること。');
  }
}

// このファイルを直接実行したときだけ AWS を叩く（テストからの import では叩かない）
if (process.argv[1]?.endsWith('create-user.ts')) {
  main().catch((e: Error) => {
    console.error(`\n失敗しました。\n${e.message}`);
    const hint = hintFor(e.message);
    if (hint) console.error(`\n→ ${hint}`);
    process.exit(1);
  });
}
