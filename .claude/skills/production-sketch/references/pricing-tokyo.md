# 東京リージョンの単価（実測）

**2026-08-17 に AWS Pricing API から取得。** 料金表の版は `publicationDate 2026-08-14`、
適用開始は `2026-08-01`。**半年以上経っていたら引き直すこと。**

引き方は `SKILL.md` の「金額を引く」にある。`--region us-east-1` 固定、
usagetype の `APN1-` 接頭辞で東京を引く。

---

## AgentCore

サービスコード `AmazonBedrockAgentCore`。**ハーネス自体には課金されない。**
下の各項目が実際の課金対象。

| usagetype | 単位 | USD |
|---|---|---|
| `APN1-Runtime:Consumption-based:vCPU` | vCPU-Hour | 0.0895 |
| `APN1-Runtime:Consumption-based:Memory` | GB-Hour | 0.00945 |
| `APN1-Memory:Consumption-based:Short-Term-Memory` | イベント | 0.00025 |
| `APN1-Memory:Consumption-based:Long-Term-Memory-Storage:Built-in-memory` | 件・月 | 0.00075 |
| `APN1-Memory:Consumption-based:Long-Term-Memory-Retrieval` | 件 | 0.0005 |

**CPU は I/O 待ちの間は課金されない**（モデルやツールの応答待ち中に
バックグラウンド処理が無ければ）。**メモリはセッションが生きている間ずっと課金される。**
セッション時間をそのまま vCPU 時間として積むと過大に出る。

同じ体系で `APN1-CodeInterpreter:*` と `APN1-BrowserTool:*` もある（vCPU / Memory）。
Gateway は `APN1-Gateway:Consumption-based:API-Invocations` ほか。
Knowledge Base は `APN1-Knowledge-Base:Consumption-based:{Retrieval,Storage,AgenticRetrieval}`。
**使うときに引く。**

## Cognito

サービスコード `AmazonCognito`。MAU（月あたり利用者数）課金。**段階制はLiteのみ。**

| ティア | usagetype | USD / MAU |
|---|---|---|
| Lite | `APN1-CognitoLiteMAU` | 0.0055（〜90,000）／ 0.0046 ／ 0.00325 ／ 0.0025 |
| Essentials | `APN1-CognitoEssentialsMAU` | 0.015 |
| Plus | `APN1-CognitoPlusMAU` | 0.020 |

AgentCore からの認証リクエストは別建て。
`APN1-Bedrock-Agent-Core:Auth-Request:Oauth2` が **0.00001 USD / リクエスト**。

## Amplify

サービスコード `AWSAmplify`。

| usagetype | 単位 | USD |
|---|---|---|
| `APN1-DataTransferOut` | GB | 0.15 |
| `APN1-DataStorage` | GB | 0.023 |
| `APN1-BuildDuration` | 分 | 0.01 |
| `APN1-HostingComputeRequestCount` | 100万リクエスト | 0.30 |

**静的配信だけならビルド以外はほぼ無視できる。**

## CloudWatch

サービスコード `AmazonCloudWatch`。

| usagetype | 単位 | USD |
|---|---|---|
| `APN1-DataProcessing-Bytes` | GB（取り込み） | 0.76 |
| `APN1-TimedStorage-ByteHrs` | GB・月（保存） | 0.033 |
| `APN1-XRay-Spans-Indexed` | span | 0.00000075 |

**取り込みが効く。** 保存は 20 分の 1 以下なので、削るなら出力量のほう。

---

## Bedrock モデル利用料 — API からは引けない

**2026-08-17 に確認。以下は全部試して駄目だった。**

| 当て先 | 結果 |
|---|---|
| `AmazonBedrock`（`model` 属性あり） | Claude 3 系まで。4.5 以降が無い |
| `AmazonBedrockService` | Claude Sonnet 4.5 はあるが**予約（TPM）のみ**。東京は 8 件すべて `Reserved - 1/3 Month`。`feature=On-demand Inference` は**全リージョンで 0 件** |
| `AmazonBedrockFoundationModels` | usagetype にモデル名が入らない（`APN1-MP:APN1_InputTokenCount_Global-Units` の形）。`model` 属性そのものが無い |
| 料金ページのテキスト取得 | Anthropic の表がタブ内で JS 生成。抽出しても見出しだけ |
| ブラウザ操作 | リージョン切替は `select` ではなくカスタム UI。クリックで開かず、他リージョンの表は DOM にも無い（他プロバイダの表は DOM にある） |

**人が料金ページを見て転記する。** ここだけ自動化しない。

### オレゴンの実測値（2026-08-17、料金ページから取得）

東京が確認できないときの**参考値**。使うなら「オレゴン単価」と明記する。

Claude Sonnet 4.5、USD / 100万トークン。

| | 入力 | 出力 | キャッシュ書込(5m) | キャッシュ読取 |
|---|---|---|---|---|
| Global cross-region | 3.00 | 15.00 | 3.75 | 0.30 |
| **Geo / in-region**（`jp.` 相当） | **3.30** | **16.50** | 4.125 | 0.33 |

**Geo は Global の 1.1 倍。** 東京の予約単価（API で引ける）でも同じ比率だった
（1ヶ月予約の入力 TPM が Geo 0.198 / Global 0.18）。

**`jp.` プロファイルは Geo 側**。国内に経路を閉じる代わりに 10% 高い。
この差は商談で必ず説明できるようにしておく（「国内に閉じるための費用」と言える）。

キャッシュ読取は入力の 1/10。**指示文が毎回同じなら効くはずだが、
AgentCore Harness が自動で使うかは未確認。** 概算に織り込まないこと。
