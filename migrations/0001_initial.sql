CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

INSERT OR IGNORE INTO users (id, name) VALUES
  ('wang', '小汪'),
  ('yanzi', '小言子');

CREATE TABLE IF NOT EXISTS word_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_number INTEGER NOT NULL UNIQUE,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS words (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  word TEXT NOT NULL UNIQUE COLLATE NOCASE,
  meaning TEXT NOT NULL,
  group_id INTEGER NOT NULL,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES word_groups(id)
);

CREATE TABLE IF NOT EXISTS study_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  kind TEXT NOT NULL,
  group_id INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  current_index INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  correct_count INTEGER NOT NULL DEFAULT 0,
  wrong_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (group_id) REFERENCES word_groups(id)
);

CREATE TABLE IF NOT EXISTS study_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  word_id INTEGER NOT NULL,
  answer TEXT NOT NULL,
  is_correct INTEGER NOT NULL,
  answered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES study_sessions(id),
  FOREIGN KEY (word_id) REFERENCES words(id)
);

CREATE TABLE IF NOT EXISTS wrong_words (
  user_id TEXT NOT NULL,
  word_id INTEGER NOT NULL,
  wrong_count INTEGER NOT NULL DEFAULT 0,
  recent_wrong_at TEXT,
  last_correct_at TEXT,
  PRIMARY KEY (user_id, word_id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (word_id) REFERENCES words(id)
);

CREATE TABLE IF NOT EXISTS checkins (
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  study_done INTEGER NOT NULL DEFAULT 0,
  review_done INTEGER NOT NULL DEFAULT 0,
  wrong_review_done INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  PRIMARY KEY (user_id, date),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_words_group_id ON words(group_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user_status ON study_sessions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_answers_user_word ON study_answers(user_id, word_id);
CREATE INDEX IF NOT EXISTS idx_wrong_words_user ON wrong_words(user_id, wrong_count DESC, recent_wrong_at DESC);
