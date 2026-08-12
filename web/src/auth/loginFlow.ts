/**
 * Cognito Hosted UI から戻ってきたときに次に何をするかを決める純粋関数。
 *
 * 判断ロジックを useEffect の中に埋め込むと、テストできないまま
 * 「同意拒否で無限リダイレクト」「交換失敗で取り残される」といった、
 * 商談中に画面が黙って止まる不具合を作り込む。ここに切り出して固定する。
 */

export type LoginAction =
  | { kind: 'exchange'; code: string; verifier: string }
  | { kind: 'redirect' }
  | { kind: 'fail'; message: string };

export function decideLoginAction(o: {
  /** コールバックのクエリ文字列（window.location.search 相当） */
  readonly search: string;
  /** sessionStorage に入っている値。無ければ null */
  readonly verifier: string | null;
  readonly expectedState: string | null;
}): LoginAction {
  const params = new URLSearchParams(o.search);

  // Cognito は同意拒否やセッション切れのときに error を付けて返す。
  // ここを見ずに「code が無い」だけで判定すると、アプリ → Cognito →
  // アプリ … と無限リダイレクトになる
  const error = params.get('error');
  if (error) {
    return { kind: 'fail', message: params.get('error_description') ?? error };
  }

  const code = params.get('code');
  if (!code) {
    return { kind: 'redirect' };
  }

  if (!o.verifier || !o.expectedState) {
    return {
      kind: 'fail',
      message: 'ログインの途中状態が失われました。画面を再読み込みしてログインをやり直してください。',
    };
  }

  // state を突き合わせないと、他所から仕込まれた認可コードを掴まされる（CSRF）。
  // 生成するだけで検証しないなら、そもそも付ける意味がない
  if (params.get('state') !== o.expectedState) {
    return {
      kind: 'fail',
      message: 'ログインの検証に失敗しました。画面を再読み込みしてログインをやり直してください。',
    };
  }

  return { kind: 'exchange', code, verifier: o.verifier };
}
