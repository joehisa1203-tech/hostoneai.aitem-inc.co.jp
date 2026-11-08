# HostOne AI — 民泊専門 AIゲスト対応プラットフォーム

Beds24 と連携し、**Airbnb・Booking.com 等のOTAメッセージ / LINE / Slack / 電話 / Webチャット** に届くゲストの問い合わせに、AI（Claude）が多言語で24時間自動返信するアプリです。
判断が必要な内容（返金・キャンセル・トラブル・緊急・確信度の低い回答）は下書きとして保留し、Slack と管理画面でスタッフに通知します。

- 本番URL: https://hostoneai.aitem-inc.co.jp
- 管理画面: https://hostoneai.aitem-inc.co.jp/admin/

## 料金（LPに掲載）

| 項目 | 金額（税別） |
|---|---|
| 初期構築費 | 700,000円 |
| ソフトウェア利用料 | 月額 3,000円 |

※ AI API利用料・電話回線（Twilio）・VPS 等の実費は別途。

## 構成

```
ゲスト ─┬─ Airbnb / Booking.com ──▶ Beds24 ──(API v2 ポーリング)──┐
        ├─ LINE ───────────────(Webhook)───────────────────────┤
        ├─ Slack ──────────────(Events API)────────────────────┤──▶ HostOne AI ──▶ Claude API
        ├─ 電話 ──▶ Twilio ────(Voice Webhook / 音声認識)──────┤        │
        └─ Webチャット ─────────(widget.js)─────────────────────┘        ├─ 自動返信（各チャネルへ）
                                                                          └─ 要対応 → Slack通知・管理画面で承認
```

| ディレクトリ | 内容 |
|---|---|
| `src/server.js` | Express サーバー起動・Beds24 ポーリング |
| `src/services/ai.js` | Claude による返信生成（構造化出力: 返信・言語・カテゴリ・確信度・要対応フラグ） |
| `src/services/inbox.js` | 受信 → AI → 自動送信／下書き → Slack通知 の中核処理 |
| `src/channels/` | Beds24 / LINE / Slack / Twilio 各アダプタ（署名検証込み） |
| `src/routes/` | Webhook・電話・Webチャット・管理API |
| `public/` | LP（料金）、管理画面、Webチャットウィジェット |
| `deploy/` | Xserver VPS 用セットアップ・更新スクリプト、Caddy（自動HTTPS） |

## 主な機能

- **物件ナレッジ**: チェックイン方法・Wi-Fi・ハウスルール・FAQ を物件ごとに登録。書かれていない事は推測せずスタッフ確認に回す
- **予約情報の活用**: Beds24 の予約（ゲスト名・宿泊日・人数・OTA）をAIに渡して回答
- **返信モード**: 自動送信 / 全件承認制、確信度しきい値、強制エスカレーションキーワード
- **Slack連携**: 会話ごとに通知スレッドを作成。**スレッドに返信するとそのままゲストへ送信**
- **電話**: 音声認識で用件を聞き取りAIが読み上げ回答。解決できなければスタッフ携帯へ転送
- **多言語**: ゲストの言語で返信（日本語・英語・中国語・韓国語など）

## ローカル起動

```bash
cp .env.example .env   # ANTHROPIC_API_KEY と ADMIN_PASSWORD を設定
npm install
npm start              # http://localhost:3000
npm test
```

## Xserver VPS へのデプロイ（hostoneai.aitem-inc.co.jp）

### 1. VPS 準備
1. Xserver VPS で **Ubuntu 22.04 / 24.04** のサーバーを作成（メモリ 2GB 以上推奨）
2. VPSパネル「パケットフィルター設定」で **SSH(22) / Web(80, 443)** を許可

### 2. DNS 設定
`aitem-inc.co.jp` の DNS を管理している所（Xserver のサーバーパネル/ドメインパネル等）で A レコードを追加:

| ホスト名 | 種別 | 値 |
|---|---|---|
| hostoneai | A | VPS の IPアドレス |

### 3. セットアップ（VPS に SSH して root で実行）

```bash
git clone https://github.com/joehisa1203-tech/hostoneai.aitem-inc.co.jp.git /opt/hostoneai
```

```bash
bash /opt/hostoneai/deploy/setup-vps.sh
```

初回は `.env` を作成して停止し、管理画面パスワードを表示します。APIキー類を設定してから起動します:

```bash
nano /opt/hostoneai/.env
```

```bash
cd /opt/hostoneai && docker compose up -d --build
```

Caddy が Let's Encrypt の証明書を自動取得し、`https://hostoneai.aitem-inc.co.jp` で公開されます。

### 4. 更新

```bash
bash /opt/hostoneai/deploy/update.sh
```

## 各サービスの連携設定

| サービス | 設定内容 |
|---|---|
| **Claude API** | https://console.anthropic.com で APIキーを発行 → `ANTHROPIC_API_KEY` |
| **Beds24** | Settings → Apps & Integrations → API で招待コードを発行し、`/authentication/setup` で取得した refreshToken を `BEDS24_REFRESH_TOKEN` に設定。管理画面の物件に「Beds24 物件ID」を登録 |
| **LINE** | LINE Developers で Messaging API チャネル作成 → チャネルシークレット/アクセストークンを設定、Webhook URL に `https://hostoneai.aitem-inc.co.jp/webhooks/line`（`?property=物件ID` で物件固定可） |
| **Slack** | Slack App を作成、Bot Token Scopes: `chat:write`, `channels:history`, `groups:history`。Event Subscriptions の Request URL に `https://hostoneai.aitem-inc.co.jp/webhooks/slack/events`、`message.channels` を購読。通知チャンネルIDを `SLACK_NOTIFY_CHANNEL` に設定し Bot を招待 |
| **電話 (Twilio)** | 日本の電話番号を取得し、Voice Webhook に `https://hostoneai.aitem-inc.co.jp/voice/incoming?property=物件ID`（POST）。`TWILIO_AUTH_TOKEN`、転送先 `HOST_PHONE_NUMBER` を設定 |
| **Webチャット** | 物件サイトに `<script src="https://hostoneai.aitem-inc.co.jp/widget.js" data-property="物件ID" defer></script>` を貼り付け |

## セキュリティ

- LINE / Slack / Twilio の Webhook はすべて署名検証
- 管理画面・管理APIは Basic 認証（HTTPS 必須）
- `.env` と `data/`（SQLite DB）はリポジトリに含めない
