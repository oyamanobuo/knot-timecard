-- V1.6.0: セキュリティ強化
-- 総当たり（ブルートフォース）対策として、PIN認証の失敗回数を記録するテーブルを追加します。
-- 管理者PINは env.ADMIN_PIN（Cloudflare Secret）から読み込むようになったため、
-- このマイグレーションではPINや従業員データのシード（初期投入）は行いません。

CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_scope_key_time ON login_attempts(scope, key, created_at);
