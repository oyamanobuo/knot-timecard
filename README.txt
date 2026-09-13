# KNOT TIME CARD v1

店舗Wi-Fi限定打刻の最小試作です。

## 重要
このV1は「画面＋サーバー側IP判定」の骨格です。Cloudflare Workerのサンプルはデモ用で、打刻データは永続保存されません。

### 店舗IP
現在確認した店舗IPv4:
27.121.145.216

### デモPIN
田中 1234
佐藤 2345
山田 3456
大山 4567

本番ではPINをコードに直書きせず、ハッシュ化してD1/KV等へ保存してください。

## 動かし方
1. index.html をWeb公開する
2. worker.js をCloudflare Workers等へデプロイ
3. index.html の `API_BASE` をWorker URLへ変更
4. Workerの `STORE_IPS` に店舗のグローバルIPを登録
5. 店舗Wi-Fiから打刻テスト
6. スマホのモバイル回線から打刻拒否テスト

## 次のV2
- D1で永続的な打刻保存
- 管理者ログイン
- 従業員登録
- PIN変更
- 修正申請と履歴
- 給与計算
- CSV出力
- GPS記録
- QR打刻
- 店舗IP変更検知
