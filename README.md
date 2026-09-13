# KNOT TIME CARD v1.2

店舗Wi-Fi限定のタイムカードをCloudflare Workers + D1で永続保存するテスト版です。

## 今回の変更
- 打刻データをCloudflare D1へ保存
- 直近30件の打刻履歴表示
- スタッフ情報をD1から取得
- 店舗ネットワーク制限を継続
- 4桁PIN認証を継続
- 深夜時間計算は実装しない

## 初回セットアップ
1. CloudflareでD1データベースを作成する。名前は `knot-timecard-db` 推奨。
2. D1のDatabase IDをコピーする。
3. `wrangler.jsonc` の `PASTE_YOUR_D1_DATABASE_ID_HERE` を実際のDatabase IDに置き換える。
4. GitHubへ `wrangler.jsonc`, `worker.js`, `public/index.html`, `migrations/0001_initial.sql`, `README.md` をコミットする。
5. D1 migrationを適用する。

Wranglerを使う場合の代表的なコマンド:

```bash
npx wrangler d1 migrations apply knot-timecard-db --remote
npx wrangler deploy
```

※ GitHub/Cloudflare Buildsだけで運用する場合は、CloudflareダッシュボードのBindingsからD1 bindingを追加し、`DB` という変数名にしてください。

## テストPIN
- 田中: 1234
- 佐藤: 2345
- 山田: 3456
- 大山: 4567

本番運用前にPINは変更してください。
