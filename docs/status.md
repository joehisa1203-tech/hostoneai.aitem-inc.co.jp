# status — HostOne AI（このサーバーでの現在地）

最終更新: 2026-11-08

## 現在地

**公開済み: https://hostoneai.aitem-inc.co.jp**

`210.131.216.216`（Xserver VPS。JOE 各アプリが動いているサーバー）の
`~/JOE/hostoneai.aitem-inc.co.jp` で稼働中。

| 項目 | 状態 |
|---|---|
| イメージ | `hostoneai-app:latest` |
| コンテナ | `hostoneai-app-1` / `healthy` / `restart: unless-stopped` |
| 待ち受け | `127.0.0.1:8300` → コンテナ 3000 |
| 公開 | nginx `/etc/nginx/sites-available/hostoneai` が `127.0.0.1:8300` へ proxy |
| 証明書 | Let's Encrypt（ECDSA）。期限 2027-02-06。`certbot.timer` で自動更新 |
| DB | `./data/hostone.db`（ホスト側 bind mount。コンテナを作り直しても残る） |
| テスト | `node --test test/basic.test.js` 4件パス |
| お問い合わせ | LP のフォーム → `POST /api/contact` → SMTP で `CONTACT_TO` へ送信。**`SMTP_PASS` 未記入のため現在は送信不可** |

疎通確認済み（HTTPS・証明書検証あり）: `/health` `{"ok":true}` / LP 200 /
`widget.js` 200 / `/admin/` 401 / HTTP は 301 で HTTPS へ / 署名なし LINE webhook 401。

`ADMIN_PASSWORD` が空のため管理画面は**誰も入れない状態**（`basicAuth` はパスワード未設定時に
全て 401 を返す fail-closed 実装）。値を入れるまでこの状態が正しい。

## 決まっている方針

### caddy サービスは**このホストでは使わない**

リポジトリ標準の `docker-compose.yml` にある `caddy` は 80/443 を奪うが、このホストの
80/443 は既存 nginx が使用中（joeai.co.jp / sns / reply / geo を配信）。起動すれば
ポート衝突で**稼働中の他サイトが全部止まる**。

そのため `docker-compose.override.yml` を置き、

- `app` を `127.0.0.1:8300` にのみ公開（このホストの他アプリと同じ流儀。
  joeai-wordpress:8080 / sns-web:8100 / beds24-ai-reply:8200）
- `caddy` を `profiles` で既定の起動対象から外す

とした。`docker compose up -d` で caddy は起動しない。HTTPS は既存 nginx が終端する。
README の Caddy 手順は「VPS に単独で立てる場合」の記述として読む。

### nginx 設定は certbot に管理させる

`sites-available/hostoneai` は HTTP の proxy だけ手で書き、TLS と HTTP→HTTPS
リダイレクトは `certbot --nginx --redirect` に追記させた。既存4サイトと同じ形
（`# managed by Certbot` コメント付き）。手で TLS を書くと更新時に certbot と食い違う。

### お問い合わせメールは joeai.co.jp と同じ SMTP を使う

LP のフォームは `POST /api/contact` で受けて nodemailer から送る。SMTP は
joeai.co.jp（WordPress）が使っているものと同じ。設定箇所は
`~/JOE/HP-wordpress/frontend/theme/functions.php` の `joeai_configure_smtp`
（探し方: `command grep -n "joeai_configure_smtp" frontend/theme/functions.php`）。

| 項目 | 値 |
|---|---|
| ホスト | `sv14898.xserver.jp` |
| ポート | 465（SSL） |
| 認証ユーザー | `info@joeai.co.jp` |
| 送信先 | `info@joeai.co.jp`（`CONTACT_TO`） |
| パスワード | `SMTP_PASS`。**利用者本人が `.env` に記入する。こちらでは扱わない** |

**差出人は SMTP 認証したアドレスに固定し、問い合わせ者のアドレスは Reply-To に入れる。**
問い合わせ者のアドレスを差出人にすると SPF / DMARC で弾かれ、届かなくなる。

送信できない時に黙って捨てると問い合わせが消えるため、`SMTP_PASS` 未設定なら 503、
送信失敗なら 502 を返し、画面に「`info@joeai.co.jp` へ直接」と出す。サーバー側の
ログにも残す（`docker compose logs | grep contact`）。

### LP は細い画面でヘッダーをハンバーガーにまとめる

760px 以下で `nav` を隠し、44×44px のボタンに畳む。実機幅での確認は
ヘッドレス Chrome で行う（検証スクリプトは残していない。必要なら puppeteer の
公式イメージで `#navtoggle` の `display` と `aria-expanded` を見る）。

色・角丸・余白は既存の CSS 変数と既存の値だけを使い、新しい値を作っていない。
エラー表示も新しい色を足さず、`⚠` と太字で区別している（このリポジトリに
デザイン文書が無いため、既存のトークンを唯一の規範として扱った）。

### DNS は共有サーバーから VPS へ切り替え済み

`hostoneai.aitem-inc.co.jp` → `210.131.216.216`（全5台の権威NSで一致）。
切り替え前は `162.43.101.99`（`sv14898.xserver.jp` = Xserver 共有レンタルサーバー）。

ゾーンの管理場所は **sv14898 の共有サーバーのサーバーパネル > ドメイン > DNSレコード設定**。
根拠: SPF に `+a:sv14898.xserver.jp`、MX が `mx.xserver.jp`。

**Xserver VPS の VPSパネルの「DNS設定」にこのドメインを登録してはいけない。**
VPS 側の DNS も同じ `ns1〜5.xserver.jp` を使うため、ゾーンが二重になり apex や MX まで
食い違ってメールが止まる。

切り替え直後は権威NS 5台のうち2台だけが新IPを返す状態が数十分続いた。判別方法は
各NSに `dig +short A <名前> @nsN.xserver.jp` を投げて実測すること。SOA シリアルは
5台とも `0` なので版数では判断できない。

**旧サーバー（sv14898）側にこのサブドメインの設定と証明書がまだ残っている。**
旧IPに繋がった場合、Xserver が自前で発行した Let's Encrypt 証明書
（2026-11-08 20:53 JST 発行）で HTTPS 応答し、Xserver の 404 ページが出る。
TLS エラーにならないので「繋がっているのに中身が違う」という見え方になる。

今すぐ消す必要はないが、**将来 A レコードが旧IPに書き戻されたら、まずこの設定を疑う**
（共有サーバーにサブドメイン設定が残っていると DNS 自動設定が書き戻すことがある）。
消す場合の対象は共有サーバーのサーバーパネルにある `hostoneai` の**サブドメイン設定だけ**。
ドメイン自体や MX を消すとメールが止まる（SPF に `+a:sv14898.xserver.jp`、
MX は `mx.xserver.jp`）。

## 残課題

### 利用者本人でないとできないこと

- **`.env` の秘密情報の記入**（こちらでは値を生成・入力しない）。優先度順:
  - `ADMIN_PASSWORD` … 空の間、管理画面は使えない
  - `ANTHROPIC_API_KEY` … 空の間、AI 返信は動かない
  - **`SMTP_PASS`** … 空の間、LP のお問い合わせフォームは送信できず 503 を返す
    （`info@joeai.co.jp` のメールパスワード。joeai.co.jp の WordPress と同じもの）
  - 必要に応じて `BEDS24_REFRESH_TOKEN` / `LINE_*` / `SLACK_*` / `TWILIO_AUTH_TOKEN`
  - 記入後に `cd ~/JOE/hostoneai.aitem-inc.co.jp && docker compose up -d` で反映
- 各外部サービス側の webhook URL 登録（`README.md` の「各サービスの連携設定」の表）

## 見送った判断

### `data/hostone.db` の日次バックアップ — 2026-11-08 に見送り

提案したが「今はいい」との判断。**現状バックアップは無い。**

見送って構わない理由: この時点で `.env` が未記入のため AI 返信も各チャネル連携も
動いておらず、DB に失って困る実データがまだ無い。

**再提案すべき時期: `.env` を記入して実際にゲスト対応が動き出した時点。**
そこから先は会話履歴・物件ナレッジが DB にしか無く、失うと復旧できない。

実施する場合の方針（決めてあるので再検討しない）: 稼働中 SQLite はファイルコピーで
壊れるため `VACUUM INTO` を使う。既存の `~/backups/sns-auto` /
`~/backups/wordpress-auto` と同じ日次 cron の流儀に合わせる。

## 退避したもの

| 退避先 | 中身 |
|---|---|
| `~/backups/nginx_manual/etc-nginx-before-hostoneai-20261108_230255.tar.gz` | vhost 追加前の `/etc/nginx` 全体。別の場所へ展開して原本と一致することを確認済み |
| `~/backups/hostoneai-index-before-nav-contact-20261109_012852.html` | ハンバーガーメニューとお問い合わせフォームを入れる前の `public/index.html` |

## 文書の地図

| 文書 | 内容 |
|---|---|
| `README.md` | アプリ本体の仕様・機能・各サービス連携設定・VPS 単独構成の手順 |
| `docs/status.md`（本書） | このサーバーでの現在地・構成判断・残課題 |
| `docker-compose.override.yml` | このホスト専用の上書き（理由をコメントで併記） |
| `.env.example` | 環境変数の一覧と形式（値は入れない） |
