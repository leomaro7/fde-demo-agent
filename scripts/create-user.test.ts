import { describe, it, expect } from 'vitest';
import {
  createUserArgs,
  setPasswordArgs,
  addToGroupArgs,
  isAlreadyExists,
  hintFor,
  generatePassword,
  parseArgs,
  DEFAULT_USERNAME,
} from './create-user.js';

const POOL = 'ap-northeast-1_XXXXXXXXX';

describe('createUserArgs', () => {
  it('招待メールを送らない', () => {
    // 宛先が実在しない。送ると SES の制限にも当たる
    const args = createUserArgs({ poolId: POOL, username: DEFAULT_USERNAME });
    expect(args).toContain('--message-action');
    expect(args[args.indexOf('--message-action') + 1]).toBe('SUPPRESS');
  });
});

describe('setPasswordArgs', () => {
  it('--permanent を付ける', () => {
    // これが無いと FORCE_CHANGE_PASSWORD のままで、商談中に変更を求められる
    expect(setPasswordArgs({ poolId: POOL, username: 'u', password: 'p' })).toContain('--permanent');
  });

  it('パスワードを引数として渡す（シェルを介さない）', () => {
    // 記号入りのパスワードがシェルに解釈されると壊れる
    const args = setPasswordArgs({ poolId: POOL, username: 'u', password: 'a$b c"d' });
    expect(args[args.indexOf('--password') + 1]).toBe('a$b c"d');
  });
});

describe('addToGroupArgs', () => {
  it('slug をそのままグループ名にする', () => {
    const args = addToGroupArgs({ poolId: POOL, username: 'u', group: 'maint' });
    expect(args[args.indexOf('--group-name') + 1]).toBe('maint');
  });
});

describe('isAlreadyExists', () => {
  it('2 周目のエラーは続行してよい', () => {
    // 止めると、パスワードを入れ直したいだけのときに作り直しになる
    expect(
      isAlreadyExists(
        'An error occurred (UsernameExistsException) when calling the AdminCreateUser operation: User account already exists',
      ),
    ).toBe(true);
  });

  it('別のエラーは続行しない', () => {
    expect(isAlreadyExists('An error occurred (ResourceNotFoundException)')).toBe(false);
  });
});

describe('parseArgs', () => {
  it('ユーザー名を案件ごとに変えられる', () => {
    // クライアントのログイン画面に出る。demo@example.com のままだと
    // 当社の都合が見えてしまう案件がある
    const o = parseArgs(['cen', 'maint', 'hozen@sample-foods.example.com']);
    expect(o.username).toBe('hozen@sample-foods.example.com');
    expect(o.instance).toBe('cen');
    expect(o.slug).toBe('maint');
  });

  it('省いたら既定値', () => {
    expect(parseArgs(['cen', 'maint']).username).toBe(DEFAULT_USERNAME);
  });

  it('旗と位置引数を混ぜてよい', () => {
    // 順序を覚えさせない。どちらで打っても同じ結果になる
    for (const argv of [
      ['cen', 'maint', 'a@b.example.com', '--generate-password'],
      ['cen', 'maint', '--generate-password', 'a@b.example.com'],
      ['--generate-password', 'cen', 'maint', 'a@b.example.com'],
    ]) {
      const o = parseArgs(argv);
      expect(o.generate).toBe(true);
      expect(o.username).toBe('a@b.example.com');
    }
  });

  it('ユーザー名なしで旗だけでも通る', () => {
    const o = parseArgs(['cen', 'maint', '--generate-password']);
    expect(o.generate).toBe(true);
    expect(o.username).toBe(DEFAULT_USERNAME);
  });

  it('足りなければ使い方を出す', () => {
    expect(() => parseArgs([])).toThrow('使い方');
    expect(() => parseArgs(['cen'])).toThrow('使い方');
  });

  it('打ち間違えた旗を黙って無視しない', () => {
    // --generate-passwd を無視すると、対話入力待ちで止まった理由が分からない
    expect(() => parseArgs(['cen', 'maint', '--generate-passwd'])).toThrow('知らない指定');
  });

  it('引数が多すぎるときは知らせる', () => {
    // slug とユーザー名を取り違えたまま通すと、別のグループに入る
    expect(() => parseArgs(['cen', 'maint', 'a@b.example.com', 'extra'])).toThrow('多すぎます');
  });
});

describe('generatePassword', () => {
  it('Cognito の既定の規則を必ず満たす', () => {
    // 1 回でも欠けると InvalidPasswordException になる。運任せにしない
    for (let i = 0; i < 200; i++) {
      const p = generatePassword();
      expect(p).toHaveLength(20);
      expect(p).toMatch(/[A-Z]/);
      expect(p).toMatch(/[a-z]/);
      expect(p).toMatch(/[0-9]/);
      expect(p).toMatch(/[-_.!*]/);
      // 前後に空白があると ^[\S]+.*[\S]+$ に落ちる
      expect(p.trim()).toBe(p);
    }
  });

  it('毎回違う値になる', () => {
    const seen = new Set(Array.from({ length: 50 }, () => generatePassword()));
    expect(seen.size).toBe(50);
  });

  it('種類が先頭に固まらない', () => {
    // 混ぜ忘れると先頭 4 文字が必ず 大文字・小文字・数字・記号 の順になる
    const heads = new Set(Array.from({ length: 50 }, () => generatePassword()[0]));
    expect(heads.size).toBeGreaterThan(1);
  });

  it('8 文字未満は作らない', () => {
    expect(() => generatePassword(7)).toThrow('8 文字以上');
  });
});

describe('hintFor', () => {
  it('パスワード規則の違反には規則を出す', () => {
    expect(hintFor('InvalidPasswordException: Password did not conform')).toContain('8 文字以上');
    expect(hintFor("Value at 'password' failed to satisfy constraint")).toContain('8 文字以上');
  });

  it('グループが無いときは案件スタックを疑わせる', () => {
    const hint = hintFor(
      'An error occurred (ResourceNotFoundException) when calling the AdminAddUserToGroup operation: Group not found.',
    );
    expect(hint).toContain('3.2');
    // 2026-08-14 に、画面から消されていたのが原因だった
    expect(hint).toContain('画面から消した');
  });

  it('User Pool が無いときは土台スタックを疑わせる', () => {
    expect(hintFor('An error occurred (ResourceNotFoundException): User pool does not exist')).toContain(
      '土台スタック',
    );
  });

  it('分からないエラーには何も足さない', () => {
    // 当てずっぽうの助言は、読者を間違った方向へ送る
    expect(hintFor('An error occurred (ThrottlingException)')).toBeUndefined();
  });
});
