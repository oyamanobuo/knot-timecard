CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  pin TEXT NOT NULL,
  hourly_wage INTEGER NOT NULL DEFAULT 0,
  transport_allowance INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS punches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('in','out')),
  timestamp TEXT NOT NULL,
  client_ip TEXT,
  source TEXT NOT NULL DEFAULT 'web',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS punch_edits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  punch_id INTEGER,
  employee_id TEXT NOT NULL,
  old_type TEXT,
  old_timestamp TEXT,
  new_type TEXT,
  new_timestamp TEXT,
  reason TEXT NOT NULL,
  edited_by TEXT NOT NULL,
  edited_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_punches_employee_time ON punches(employee_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_punches_time ON punches(timestamp);

INSERT OR IGNORE INTO employees (id, name, pin) VALUES
  ('tanaka', '田中', '1234'),
  ('sato', '佐藤', '2345'),
  ('yamada', '山田', '3456'),
  ('oyama', '大山', '4567');
