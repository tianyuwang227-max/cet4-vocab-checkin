type Env = {
  DB: D1Database;
};

type Word = {
  id: number;
  word: string;
  meaning: string;
  group_id: number;
  position: number;
  wrong_count?: number;
};

const headers = {
  "content-type": "application/json; charset=utf-8",
};

const modeNames: Record<string, string> = {
  listen_spell: "听发音拼写",
  meaning_choice: "看意思选单词",
  meaning_listen_spell: "看意思听发音拼写",
  random_spell: "乱序拼写",
};

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await ensureUsers(env.DB);

    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/?/, "");

    if (request.method === "GET" && path === "app") {
      return json(await getAppState(env.DB, url));
    }

    if (request.method === "GET" && path === "groups") {
      return json(await getGroups(env.DB));
    }

    if (request.method === "POST" && path === "words/import") {
      return json(await importWords(env.DB, await request.json()));
    }

    if (request.method === "POST" && path === "sessions/start") {
      return json(await startSession(env.DB, await request.json()));
    }

    if (request.method === "POST" && path === "sessions/answer") {
      return json(await answerQuestion(env.DB, await request.json()));
    }

    if (request.method === "POST" && path === "sessions/finish") {
      return json(await finishSession(env.DB, await request.json()));
    }

    return json({ error: "Not found" }, 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return json({ error: message }, 500);
  }
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers });
}

async function ensureUsers(db: D1Database) {
  await db.prepare("INSERT OR IGNORE INTO users (id, name) VALUES ('wang', '小汪'), ('yanzi', '小言子')").run();
}

function localDate(url: URL) {
  return url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
}

function daysBetween(start: string, end: string) {
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  return Math.max(0, Math.floor((endMs - startMs) / 86400000));
}

async function getAppState(db: D1Database, url: URL) {
  const userId = url.searchParams.get("userId") || "wang";
  const date = localDate(url);
  const users = await db.prepare("SELECT id, name FROM users ORDER BY id DESC").all();
  const groups = await getGroups(db);
  const firstGroup = await db.prepare("SELECT MIN(date(created_at)) as start_date FROM word_groups").first<{ start_date: string | null }>();
  const todayGroupNumber = firstGroup?.start_date ? daysBetween(firstGroup.start_date, date) + 1 : 1;
  const todayGroup = groups.find((group) => group.group_number === todayGroupNumber) || null;
  const checkin = await db
    .prepare("SELECT * FROM checkins WHERE user_id = ? AND date = ?")
    .bind(userId, date)
    .first();
  const activeSessions = await db
    .prepare("SELECT * FROM study_sessions WHERE user_id = ? AND status = 'active' ORDER BY started_at DESC")
    .bind(userId)
    .all();
  const completedGroups = await db
    .prepare("SELECT DISTINCT group_id FROM study_sessions WHERE user_id = ? AND kind = 'today' AND status = 'completed' AND group_id IS NOT NULL")
    .bind(userId)
    .all<{ group_id: number }>();
  const completedGroupIds = new Set(completedGroups.results.map((row) => row.group_id));
  const makeupGroups = groups.filter((group) => group.group_number < todayGroupNumber && !completedGroupIds.has(group.id));
  const wrongWords = await getWrongWords(db, userId, 10);
  const reviewWords = await getReviewWords(db, userId, date, 30);

  return {
    users: users.results,
    currentUserId: userId,
    date,
    todayGroup,
    todayGroupNumber,
    groups,
    checkin: checkin || { user_id: userId, date, study_done: 0, review_done: 0, wrong_review_done: 0, completed_at: null },
    activeSessions: activeSessions.results,
    makeupGroups,
    wrongWords,
    reviewCount: reviewWords.length,
    modes: modeNames,
  };
}

async function getGroups(db: D1Database) {
  const groups = await db
    .prepare(
      `SELECT g.id, g.group_number, g.title, g.created_at, COUNT(w.id) AS word_count
       FROM word_groups g
       LEFT JOIN words w ON w.group_id = g.id
       GROUP BY g.id
       ORDER BY g.group_number`
    )
    .all<{ id: number; group_number: number; title: string; created_at: string; word_count: number }>();
  return groups.results;
}

async function importWords(db: D1Database, body: unknown) {
  const text = readString(body, "text");
  const parsed = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^([A-Za-z][A-Za-z'’-]*)\s+(.+)$/);
      if (!match) return null;
      return { word: match[1].toLowerCase(), meaning: match[2].trim() };
    })
    .filter((item): item is { word: string; meaning: string } => Boolean(item));

  if (parsed.length === 0) {
    throw new Error("没有解析到有效单词。格式示例：abandon 放弃；抛弃");
  }

  const inserted: Word[] = [];
  const skipped: string[] = [];
  let meta = await db.prepare("SELECT MAX(group_number) AS group_number FROM word_groups").first<{ group_number: number | null }>();
  let nextGroupNumber = (meta?.group_number || 0) + 1;
  let currentGroup = await createGroup(db, nextGroupNumber);
  let position = 1;

  for (const item of parsed) {
    const existing = await db.prepare("SELECT id FROM words WHERE word = ? COLLATE NOCASE").bind(item.word).first();
    if (existing) {
      skipped.push(item.word);
      continue;
    }

    if (position > 30) {
      nextGroupNumber += 1;
      currentGroup = await createGroup(db, nextGroupNumber);
      position = 1;
    }

    const result = await db
      .prepare("INSERT INTO words (word, meaning, group_id, position) VALUES (?, ?, ?, ?)")
      .bind(item.word, item.meaning, currentGroup.id, position)
      .run();
    inserted.push({ id: Number(result.meta.last_row_id), word: item.word, meaning: item.meaning, group_id: currentGroup.id, position });
    position += 1;
  }

  return { insertedCount: inserted.length, skipped, inserted, groups: await getGroups(db) };
}

async function createGroup(db: D1Database, groupNumber: number) {
  await db
    .prepare("INSERT OR IGNORE INTO word_groups (group_number, title) VALUES (?, ?)")
    .bind(groupNumber, `第 ${groupNumber} 组`)
    .run();
  const group = await db.prepare("SELECT id, group_number, title FROM word_groups WHERE group_number = ?").bind(groupNumber).first<{ id: number; group_number: number; title: string }>();
  if (!group) throw new Error("创建单词组失败");
  return group;
}

async function startSession(db: D1Database, body: unknown) {
  const userId = readString(body, "userId");
  const mode = readString(body, "mode");
  const kind = readString(body, "kind");
  const date = readOptionalString(body, "date") || new Date().toISOString().slice(0, 10);
  const groupId = readOptionalNumber(body, "groupId");

  const words = await resolveWords(db, userId, kind, date, groupId, mode);
  if (words.length === 0) throw new Error("没有可学习的单词");

  const sessionId = crypto.randomUUID();
  await db
    .prepare("INSERT INTO study_sessions (id, user_id, mode, kind, group_id, total) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(sessionId, userId, mode, kind, groupId || null, words.length)
    .run();

  return { session: await getSession(db, sessionId), words: shapeWordsForMode(words, mode) };
}

async function answerQuestion(db: D1Database, body: unknown) {
  const sessionId = readString(body, "sessionId");
  const userId = readString(body, "userId");
  const wordId = readNumber(body, "wordId");
  const answer = readString(body, "answer").trim();
  const word = await db.prepare("SELECT word FROM words WHERE id = ?").bind(wordId).first<{ word: string }>();
  if (!word) throw new Error("单词不存在");

  const isCorrect = normalizeAnswer(answer) === normalizeAnswer(word.word);
  await db
    .prepare("INSERT INTO study_answers (session_id, user_id, word_id, answer, is_correct) VALUES (?, ?, ?, ?, ?)")
    .bind(sessionId, userId, wordId, answer, isCorrect ? 1 : 0)
    .run();

  if (isCorrect) {
    await db
      .prepare("INSERT INTO wrong_words (user_id, word_id, last_correct_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(user_id, word_id) DO UPDATE SET last_correct_at = CURRENT_TIMESTAMP")
      .bind(userId, wordId)
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO wrong_words (user_id, word_id, wrong_count, recent_wrong_at)
         VALUES (?, ?, 1, CURRENT_TIMESTAMP)
         ON CONFLICT(user_id, word_id) DO UPDATE SET wrong_count = wrong_count + 1, recent_wrong_at = CURRENT_TIMESTAMP`
      )
      .bind(userId, wordId)
      .run();
  }

  await db
    .prepare(
      `UPDATE study_sessions
       SET current_index = current_index + 1,
           correct_count = correct_count + ?,
           wrong_count = wrong_count + ?
       WHERE id = ?`
    )
    .bind(isCorrect ? 1 : 0, isCorrect ? 0 : 1, sessionId)
    .run();

  return { isCorrect, correctWord: word.word, session: await getSession(db, sessionId) };
}

async function finishSession(db: D1Database, body: unknown) {
  const sessionId = readString(body, "sessionId");
  const userId = readString(body, "userId");
  const date = readOptionalString(body, "date") || new Date().toISOString().slice(0, 10);
  const session = await getSession(db, sessionId);
  if (!session) throw new Error("学习记录不存在");

  await db.prepare("UPDATE study_sessions SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?").bind(sessionId).run();
  if (session.kind === "today" || session.kind === "makeup") {
    const wrongReviewDone = Number(session.wrong_count) === 0 ? 1 : 0;
    await upsertCheckin(db, userId, date, { study_done: 1, wrong_review_done: wrongReviewDone });
  }
  if (session.kind === "review") {
    await upsertCheckin(db, userId, date, { review_done: 1 });
  }
  if (session.kind === "wrong") {
    await upsertCheckin(db, userId, date, { wrong_review_done: 1 });
  }
  await completeCheckinIfReady(db, userId, date);

  const wrongWords = await db
    .prepare(
      `SELECT w.id, w.word, w.meaning
       FROM study_answers a
       JOIN words w ON w.id = a.word_id
       WHERE a.session_id = ? AND a.is_correct = 0
       GROUP BY w.id
       ORDER BY w.word`
    )
    .bind(sessionId)
    .all();

  return { session: await getSession(db, sessionId), wrongWords: wrongWords.results, app: await getAppState(db, new URL(`https://local/api/app?userId=${userId}&date=${date}`)) };
}

async function upsertCheckin(db: D1Database, userId: string, date: string, values: Partial<Record<"study_done" | "review_done" | "wrong_review_done", number>>) {
  await db.prepare("INSERT OR IGNORE INTO checkins (user_id, date) VALUES (?, ?)").bind(userId, date).run();
  const sets = Object.keys(values).map((key) => `${key} = ?`).join(", ");
  const args = Object.values(values);
  await db.prepare(`UPDATE checkins SET ${sets} WHERE user_id = ? AND date = ?`).bind(...args, userId, date).run();
}

async function completeCheckinIfReady(db: D1Database, userId: string, date: string) {
  const row = await db.prepare("SELECT study_done, review_done, wrong_review_done FROM checkins WHERE user_id = ? AND date = ?").bind(userId, date).first<{ study_done: number; review_done: number; wrong_review_done: number }>();
  if (row?.study_done && row.review_done && row.wrong_review_done) {
    await db.prepare("UPDATE checkins SET completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP) WHERE user_id = ? AND date = ?").bind(userId, date).run();
  }
}

async function getSession(db: D1Database, sessionId: string) {
  return db.prepare("SELECT * FROM study_sessions WHERE id = ?").bind(sessionId).first();
}

async function resolveWords(db: D1Database, userId: string, kind: string, date: string, groupId?: number, mode?: string) {
  if (kind === "today" || kind === "makeup") {
    if (!groupId) throw new Error("缺少单词组");
    const rows = await db.prepare("SELECT * FROM words WHERE group_id = ? ORDER BY position").bind(groupId).all<Word>();
    return mode === "random_spell" ? shuffle(rows.results) : rows.results;
  }
  if (kind === "review") return getReviewWords(db, userId, date, 30);
  if (kind === "wrong") return getWrongWords(db, userId, 30);
  throw new Error("未知学习类型");
}

async function getReviewWords(db: D1Database, userId: string, date: string, limit: number) {
  const groups = await getGroups(db);
  const firstGroup = await db.prepare("SELECT MIN(date(created_at)) as start_date FROM word_groups").first<{ start_date: string | null }>();
  const todayGroupNumber = firstGroup?.start_date ? daysBetween(firstGroup.start_date, date) + 1 : 1;
  const yesterdayGroup = groups.find((group) => group.group_number === todayGroupNumber - 1);
  const seen = new Set<number>();
  const words: Word[] = [];

  if (yesterdayGroup) {
    const yesterdayWords = await db.prepare("SELECT * FROM words WHERE group_id = ? ORDER BY position").bind(yesterdayGroup.id).all<Word>();
    for (const word of yesterdayWords.results) addUnique(words, seen, word, limit);
  }

  const recentWrong = await db
    .prepare(
      `SELECT w.*, ww.wrong_count
       FROM wrong_words ww
       JOIN words w ON w.id = ww.word_id
       WHERE ww.user_id = ? AND ww.wrong_count > 0
       ORDER BY ww.recent_wrong_at DESC, ww.wrong_count DESC
       LIMIT ?`
    )
    .bind(userId, limit)
    .all<Word>();
  for (const word of recentWrong.results) addUnique(words, seen, word, limit);

  const highFreq = await getWrongWords(db, userId, limit);
  for (const word of highFreq) addUnique(words, seen, word, limit);

  return words;
}

async function getWrongWords(db: D1Database, userId: string, limit: number) {
  const rows = await db
    .prepare(
      `SELECT w.*, ww.wrong_count
       FROM wrong_words ww
       JOIN words w ON w.id = ww.word_id
       WHERE ww.user_id = ? AND ww.wrong_count > 0
       ORDER BY ww.wrong_count DESC, ww.recent_wrong_at DESC
       LIMIT ?`
    )
    .bind(userId, limit)
    .all<Word>();
  return rows.results;
}

function addUnique(words: Word[], seen: Set<number>, word: Word, limit: number) {
  if (seen.has(word.id) || words.length >= limit) return;
  seen.add(word.id);
  words.push(word);
}

function shapeWordsForMode(words: Word[], mode: string) {
  if (mode !== "meaning_choice") return words.map((word) => ({ ...word, options: undefined }));
  return words.map((word, index) => {
    const options = shuffle([word.word, ...words.filter((item) => item.id !== word.id).slice(index + 1, index + 4).map((item) => item.word)]);
    return { ...word, options };
  });
}

function shuffle<T>(items: T[]) {
  return [...items].sort(() => Math.random() - 0.5);
}

function normalizeAnswer(value: string) {
  return value.trim().toLowerCase().replace(/[’']/g, "'");
}

function readString(body: unknown, key: string) {
  const value = readRecord(body)[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`缺少字段：${key}`);
  return value;
}

function readOptionalString(body: unknown, key: string) {
  const value = readRecord(body)[key];
  return typeof value === "string" ? value : undefined;
}

function readNumber(body: unknown, key: string) {
  const value = readRecord(body)[key];
  if (typeof value !== "number") throw new Error(`缺少字段：${key}`);
  return value;
}

function readOptionalNumber(body: unknown, key: string) {
  const value = readRecord(body)[key];
  return typeof value === "number" ? value : undefined;
}

function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") throw new Error("请求体格式不正确");
  return value as Record<string, unknown>;
}
