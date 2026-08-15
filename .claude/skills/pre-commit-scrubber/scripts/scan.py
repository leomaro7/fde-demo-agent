#!/usr/bin/env python3
"""変更内容からシークレット・PII・組織/案件固有の名前を検出する。

検出専用：このスクリプトはファイルを決して編集しない。
Claude が修正を適用する前に人間が review できるよう、検出結果を報告するだけ。
macOS と Windows で動作する（標準ライブラリのみ。bash/grep/sed に依存しない）。

使い方:
    python scan.py [--repo PATH] [--glossary PATH] [--format text|json]
                   [--staged] [--no-untracked] [--require-gitleaks]

終了コード:
    0  検出なし
    1  検出あり（review が必要）
    2  使い方 / 環境エラー
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

# スキャンしないファイル（バイナリ / 外部取り込み（vendored）/ ロックファイルはノイズになりがち）。
SKIP_SUFFIXES = {
    ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp", ".svg",
    ".pdf", ".zip", ".gz", ".tar", ".7z", ".rar", ".jar", ".class",
    ".woff", ".woff2", ".ttf", ".eot", ".otf", ".mp3", ".mp4", ".mov",
    ".so", ".dylib", ".dll", ".exe", ".bin", ".wasm",
}
MAX_BYTES = 2_000_000  # 約 2 MB を超えるファイルはスキップ

# 実在のシークレットとして検出すべきでない明白なプレースホルダ。
PLACEHOLDER_RE = re.compile(
    r"^(?:x+|\*+|\.+|-+|none|null|nil|todo|changeme|example|sample|dummy|test|"
    r"your[_-]?\w+|<[^>]+>|\$\{[^}]+\}|\{\{[^}]+\}\}|%[a-z_]+%|env(?:iron)?\."
    r"\w+)$",
    re.IGNORECASE,
)

# --- シークレットのパターン（高信頼度） --------------------------------------
SECRET_PATTERNS = [
    ("private-key-block", re.compile(r"-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----")),
    ("aws-access-key-id", re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")),
    ("github-token", re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b")),
    ("github-pat", re.compile(r"\bgithub_pat_[A-Za-z0-9_]{22,}\b")),
    ("gitlab-pat", re.compile(r"\bglpat-[A-Za-z0-9\-_]{20,}\b")),
    ("slack-token", re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b")),
    ("google-api-key", re.compile(r"\bAIza[0-9A-Za-z\-_]{35}\b")),
    ("stripe-secret-key", re.compile(r"\bsk_live_[0-9A-Za-z]{20,}\b")),
    ("openai-key", re.compile(r"\bsk-[A-Za-z0-9]{20,}\b")),
    ("anthropic-key", re.compile(r"\bsk-ant-[A-Za-z0-9\-_]{20,}\b")),
    ("jwt", re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b")),
]

# 汎用の "key = value" 形式によるクレデンシャル代入。プレースホルダ除外のため値をキャプチャ。
ASSIGNMENT_RE = re.compile(
    r"(?i)\b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|"
    r"client[_-]?secret|auth[_-]?token|private[_-]?key|credential)s?\b"
    r"\s*[:=]\s*[\"']?([^\s\"',;]{6,})[\"']?"
)

# --- PII のパターン ----------------------------------------------------------
EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
IPV4_RE = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
# 電話：国際形式または JP 形式の区切り付き数字（控えめに設定）。
PHONE_RE = re.compile(r"(?<!\d)(?:\+\d{1,3}[-\s]?)?(?:\(?0\d{1,4}\)?[-\s]?)\d{1,4}[-\s]?\d{3,4}(?!\d)")
CREDIT_CARD_RE = re.compile(r"\b(?:\d[ -]?){13,16}\b")


def luhn_ok(number: str) -> bool:
    digits = [int(c) for c in number if c.isdigit()]
    if not 13 <= len(digits) <= 16:
        return False
    checksum, parity = 0, len(digits) % 2
    for i, d in enumerate(digits):
        if i % 2 == parity:
            d *= 2
            if d > 9:
                d -= 9
        checksum += d
    return checksum % 10 == 0


def run_git(args: list[str], repo: Path) -> str | None:
    try:
        out = subprocess.run(
            ["git", "-C", str(repo), *args],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
        )
    except FileNotFoundError:
        return None
    if out.returncode != 0:
        return None
    return out.stdout


def has_head(repo: Path) -> bool:
    return run_git(["rev-parse", "--verify", "HEAD"], repo) is not None


def candidate_files(repo: Path, staged_only: bool, include_untracked: bool,
                    exclude: Path | None = None) -> list[Path]:
    names: set[str] = set()
    base = "--cached" if staged_only else "HEAD"
    if base == "HEAD" and not has_head(repo):
        base = "--cached"
    diff = run_git(["diff", "--name-only", "--diff-filter=ACMR", base], repo)
    if diff:
        names.update(line for line in diff.splitlines() if line.strip())
    if include_untracked and not staged_only:
        others = run_git(["ls-files", "--others", "--exclude-standard"], repo)
        if others:
            names.update(line for line in others.splitlines() if line.strip())
    files = []
    exclude_resolved = exclude.resolve() if exclude else None
    for name in sorted(names):
        p = repo / name
        if exclude_resolved and p.resolve() == exclude_resolved:
            continue  # グロッサリファイル自体は決してスキャンしない
        if p.suffix.lower() in SKIP_SUFFIXES:
            continue
        try:
            if not p.is_file() or p.stat().st_size > MAX_BYTES:
                continue
        except OSError:
            continue
        files.append(p)
    return files


def load_glossary(path: Path) -> list[tuple[re.Pattern, str, str]]:
    """コメント以外の各行：`term` または `term => replacement`。"""
    entries = []
    if not path.is_file():
        return entries
    for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=>" in line:
            term, repl = (s.strip() for s in line.split("=>", 1))
        else:
            term, repl = line, ""
        if not term:
            continue
        entries.append((re.compile(re.escape(term), re.IGNORECASE), term, repl))
    return entries


def gitleaks_findings(repo: Path, changed: set[str]) -> list[dict]:
    """gitleaks がインストールされていれば、それでシークレット検出を補強する。"""
    if shutil.which("gitleaks") is None:
        return []
    with tempfile.TemporaryDirectory() as tmp:
        report = Path(tmp) / "gl.json"
        try:
            subprocess.run(
                ["gitleaks", "detect", "--no-git", "--no-banner",
                 "--source", str(repo),
                 "--report-format", "json", "--report-path", str(report)],
                capture_output=True, text=True,
            )
        except FileNotFoundError:
            return []
        if not report.is_file():
            return []
        try:
            data = json.loads(report.read_text(encoding="utf-8", errors="replace") or "[]")
        except json.JSONDecodeError:
            return []
    out = []
    for item in data:
        rel = item.get("File", "")
        norm = rel.replace("\\", "/").lstrip("./")
        if changed and norm not in changed:
            continue
        out.append({
            "category": "SECRET", "kind": f"gitleaks:{item.get('RuleID', 'rule')}",
            "file": norm, "line": item.get("StartLine", 0),
            "match": (item.get("Secret") or item.get("Match") or "")[:80],
        })
    return out


def scan_line(rel: str, lineno: int, text: str, glossary) -> list[dict]:
    found = []
    for kind, pat in SECRET_PATTERNS:
        for m in pat.finditer(text):
            found.append({"category": "SECRET", "kind": kind, "file": rel,
                          "line": lineno, "match": m.group(0)[:80]})
    for m in ASSIGNMENT_RE.finditer(text):
        value = m.group(2)
        if PLACEHOLDER_RE.match(value):
            continue
        found.append({"category": "SECRET", "kind": f"assignment:{m.group(1).lower()}",
                      "file": rel, "line": lineno, "match": m.group(0)[:80]})
    for m in EMAIL_RE.finditer(text):
        found.append({"category": "PII", "kind": "email", "file": rel,
                      "line": lineno, "match": m.group(0)})
    for m in CREDIT_CARD_RE.finditer(text):
        if luhn_ok(m.group(0)):
            found.append({"category": "PII", "kind": "credit-card", "file": rel,
                          "line": lineno, "match": m.group(0)})
    for m in PHONE_RE.finditer(text):
        found.append({"category": "PII", "kind": "phone", "file": rel,
                      "line": lineno, "match": m.group(0)})
    for m in IPV4_RE.finditer(text):
        octs = m.group(0).split(".")
        if all(o.isdigit() and int(o) <= 255 for o in octs):
            found.append({"category": "PII", "kind": "ip-address", "file": rel,
                          "line": lineno, "match": m.group(0)})
    for pat, term, repl in glossary:
        if pat.search(text):
            found.append({"category": "NAME", "kind": f"glossary:{term}", "file": rel,
                          "line": lineno, "match": term, "replacement": repl})
    return found


def main() -> int:
    ap = argparse.ArgumentParser(description="変更内容からシークレット / PII / 組織固有の名前を検出する。")
    ap.add_argument("--repo", default=".", help="リポジトリのパス（デフォルト：カレントディレクトリ）")
    ap.add_argument("--glossary", default=None, help="グロッサリファイル（デフォルト：<repo>/.scrub-glossary）")
    ap.add_argument("--format", choices=["text", "json"], default="text")
    ap.add_argument("--staged", action="store_true", help="stage 済みの変更のみスキャン")
    ap.add_argument("--no-untracked", action="store_true", help="未追跡ファイルをスキップ")
    ap.add_argument("--require-gitleaks", action="store_true",
                    help="gitleaks が無ければエラー終了する strict モード"
                         "（env SCRUB_REQUIRE_GITLEAKS=1 でも有効化）")
    args = ap.parse_args()

    repo = Path(args.repo).resolve()
    if run_git(["rev-parse", "--is-inside-work-tree"], repo) is None:
        print("error: git リポジトリではありません（または git が未インストール）", file=sys.stderr)
        return 2

    has_gitleaks = shutil.which("gitleaks") is not None
    env_require = os.environ.get("SCRUB_REQUIRE_GITLEAKS", "").lower() not in ("", "0", "false", "no")
    if (args.require_gitleaks or env_require) and not has_gitleaks:
        print("error: strict モード（--require-gitleaks / SCRUB_REQUIRE_GITLEAKS）が有効ですが "
              "gitleaks が見つかりません。インストールするか strict を無効化してください"
              "（references/remediation.md 参照）。", file=sys.stderr)
        return 2

    glossary_path = Path(args.glossary) if args.glossary else repo / ".scrub-glossary"
    glossary = load_glossary(glossary_path)

    files = candidate_files(repo, args.staged, not args.no_untracked, exclude=glossary_path)
    changed = {p.relative_to(repo).as_posix() for p in files}

    findings: list[dict] = []
    for p in files:
        rel = p.relative_to(repo).as_posix()
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        if "\x00" in text[:4096]:  # バイナリガード
            continue
        for i, line in enumerate(text.splitlines(), start=1):
            findings.extend(scan_line(rel, i, line, glossary))

    findings.extend(gitleaks_findings(repo, changed))
    findings.sort(key=lambda f: (f["file"], f["line"], f["category"]))

    warnings: list[str] = []
    if not has_gitleaks:
        warnings.append(
            "gitleaks 未導入のため SECRET 検出はベストエフォートです"
            "（既知フォーマット中心・エントロピー検出なし）。"
            "網羅性が必要なら gitleaks を導入して再実行してください。")

    if args.format == "json":
        print(json.dumps({"findings": findings, "scanned_files": sorted(changed),
                          "glossary": str(glossary_path), "gitleaks": has_gitleaks,
                          "warnings": warnings},
                         ensure_ascii=False, indent=2))
        return 1 if findings else 0

    # テキストレポート
    for w in warnings:
        print(f"⚠️  {w}")
    print(f"変更ファイル {len(files)} 件をスキャンしました。 "
          f"gitleaks: {'利用可能' if has_gitleaks else '未インストール（正規表現フォールバック）'}。 "
          f"グロッサリ: {'読み込み済み' if glossary else 'なし'}（{glossary_path}）。")
    if not findings:
        print("検出なし。commit に進んで問題ありません。")
        return 0
    counts: dict[str, int] = {}
    for f in findings:
        counts[f["category"]] = counts.get(f["category"], 0) + 1
    print(f"\n検出 {len(findings)} 件: " +
          ", ".join(f"{k}={v}" for k, v in sorted(counts.items())))
    for f in findings:
        repl = f.get("replacement")
        suffix = f"  -> 置換候補: {repl}" if repl else ""
        print(f"  [{f['category']:6}] {f['file']}:{f['line']}  "
              f"{f['kind']}  «{f['match']}»{suffix}")
    print("\n修正を適用する前に各検出を人間と review すること。 "
          "実在のシークレットはテキスト置換だけでなく、必ずローテーション/失効させること。")
    return 1


if __name__ == "__main__":
    sys.exit(main())
