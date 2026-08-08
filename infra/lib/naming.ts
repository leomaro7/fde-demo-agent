/**
 * Harness の物理名を組み立てる。
 *
 * 制約（実測。aws-facts.md 参照）: 英数字とアンダースコアのみ、先頭は文字、40 文字以内。
 * ハイフンは使えない。
 *
 * ハイフンだけは `_` に置き換える（slug にハイフンを使うのが自然なため）。
 * それ以外の違反は変換せず投げる。黙って切り詰めると別の案件と名前が衝突しうる。
 */
export function toHarnessName(instance: string, slug: string): string {
  const name = `${instance}_${slug}`.replace(/-/g, '_');

  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(
      `harnessName に使えない文字が含まれています: "${name}"。` +
        `英数字とアンダースコアのみ、先頭は文字である必要があります。`,
    );
  }
  if (name.length > 40) {
    throw new Error(
      `harnessName が 40 文字を超えています: "${name}"（${name.length} 文字）。` +
        `instance か slug を短くしてください。`,
    );
  }
  return name;
}
