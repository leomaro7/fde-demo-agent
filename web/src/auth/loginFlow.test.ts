import { describe, it, expect } from 'vitest';
import { decideLoginAction } from './loginFlow.js';

describe('decideLoginAction', () => {
  it('error パラメータがあるとき、redirect を返さず fail で理由を示す（無限リダイレクトの防止）', () => {
    const action = decideLoginAction({
      search: '?error=access_denied&error_description=User%20cancelled',
      verifier: null,
      expectedState: null,
    });
    expect(action.kind).toBe('fail');
    expect(action.kind === 'fail' && action.message).toBe('User cancelled');
  });

  it('error パラメータに error_description が無ければ error の値を message にする', () => {
    const action = decideLoginAction({
      search: '?error=access_denied',
      verifier: 'v',
      expectedState: 's',
    });
    expect(action.kind).toBe('fail');
    expect(action.kind === 'fail' && action.message).toBe('access_denied');
  });

  it('code があり verifier・expectedState が揃い state が一致すれば exchange を返す', () => {
    const action = decideLoginAction({
      search: '?code=auth-code-1&state=state-1',
      verifier: 'verifier-1',
      expectedState: 'state-1',
    });
    expect(action).toEqual({ kind: 'exchange', code: 'auth-code-1', verifier: 'verifier-1' });
  });

  it('code はあるが state が一致しなければ検証失敗として fail を返す', () => {
    const action = decideLoginAction({
      search: '?code=auth-code-1&state=state-attacker',
      verifier: 'verifier-1',
      expectedState: 'state-1',
    });
    expect(action.kind).toBe('fail');
    expect(action.kind === 'fail' && action.message).toMatch(/検証/);
  });

  it('code はあるが verifier か expectedState が無ければ途中状態が失われた旨の fail を返す', () => {
    const withoutVerifier = decideLoginAction({
      search: '?code=auth-code-1&state=state-1',
      verifier: null,
      expectedState: 'state-1',
    });
    expect(withoutVerifier.kind).toBe('fail');
    expect(withoutVerifier.kind === 'fail' && withoutVerifier.message).toMatch(/ログイン|やり直/);

    const withoutExpectedState = decideLoginAction({
      search: '?code=auth-code-1&state=state-1',
      verifier: 'verifier-1',
      expectedState: null,
    });
    expect(withoutExpectedState.kind).toBe('fail');
  });

  it('code が無ければ Hosted UI への redirect を返す', () => {
    const action = decideLoginAction({ search: '', verifier: null, expectedState: null });
    expect(action).toEqual({ kind: 'redirect' });
  });
});
