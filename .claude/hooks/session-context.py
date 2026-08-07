#!/usr/bin/env python3
"""セッション開始時に「今どの AWS アカウントにいて、何が動いているか」を確定させる。

前身では、消したつもりのリソースが残って課金され続けた。さらに厄介なのは
**別アカウント・別プロファイルに建ててしまう事故**で、こちらは cleanup-check が
「Harness 0 件、問題なし」と報告するため、間違いに気づく手段がない。

毎セッション先頭で身元と稼働数を出しておけば、どちらも初手で見える。
ブレーキではなく情報提示なので、失敗しても黙って通す。
"""

import json
import os
import subprocess
import sys

REGION = os.environ.get("AWS_REGION", "ap-northeast-1")
TIMEOUT = 15


def run(args: list[str]) -> str | None:
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=TIMEOUT)
    except (OSError, subprocess.TimeoutExpired):
        return None
    if result.returncode != 0:
        return None
    return result.stdout.strip()


def emit(context: str) -> None:
    """SessionStart で Claude に文脈を渡す唯一の経路は stdout の additionalContext。"""
    json.dump(
        {
            "hookSpecificOutput": {
                "hookEventName": "SessionStart",
                "additionalContext": context,
            }
        },
        sys.stdout,
    )


def main() -> int:
    identity = run(
        ["aws", "sts", "get-caller-identity", "--query", "Arn", "--output", "text"]
    )
    if identity is None:
        # SessionStart の stderr は exit 2 でも「ユーザーにだけ」表示され、Claude には届かない。
        # 認証が切れている場面こそこのフックの価値が出るところなので、必ず stdout で返す。
        emit("AWS の認証情報が使えません。`aws sts get-caller-identity` が通る状態に"
             "してから AWS を触ること。稼働リソースの件数は未取得。")
        return 0

    # ARN の末尾（ロール名 / ユーザー名）だけ出す。アカウント ID は出さない。
    who = identity.rsplit("/", 1)[-1] if "/" in identity else identity

    counts = []
    for label, args in (
        (
            "Harness",
            ["aws", "bedrock-agentcore-control", "list-harnesses", "--region", REGION,
             "--query", "length(harnesses)", "--output", "text"],
        ),
        (
            "UserPool",
            ["aws", "cognito-idp", "list-user-pools", "--max-results", "60",
             "--region", REGION, "--query", "length(UserPools)", "--output", "text"],
        ),
        (
            "Amplify",
            ["aws", "amplify", "list-apps", "--region", REGION,
             "--query", "length(apps)", "--output", "text"],
        ),
    ):
        value = run(args)
        counts.append(f"{label} {value if value is not None else '?'}")

    emit(
        f"AWS: {who} @ {REGION} / " + " · ".join(counts) + "\n"
        "Harness は課金対象。想定より多ければ cleanup-check スキルで差分を特定すること。"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
