import Database from "better-sqlite3";
import path from "node:path";
import type {
  ActivityLogType,
  BatchMessageEntry,
  BirthdayEntry,
  InactiveUserListRow,
  InactiveUserRow,
  RecentWinnerEntry,
  RemoveUserResult,
  TodayBirthdayEntry,
  TopUserWeightedRow,
  UserActivityDetails,
  UserStats,
  UserWeightedScore,
  WinnerCandidate,
  WinnerHistoryEntry,
} from "./types.ts";

interface TrackingStatusRow {
  tracking_enabled: number;
}

interface CountRow {
  count: number;
}

interface UserInfoRow {
  last_active_timestamp: number | null;
  tracking_enabled: number;
}

interface ScoreRow {
  score: number | null;
}

interface UserIdRow {
  user_id: string;
}

interface LastByTypeRow {
  type: string;
  last_ts: number;
}

interface TimestampRow {
  timestamp: number;
}

interface DbStatements {
  getTrackingStatus: Database.Statement<[string], TrackingStatusRow>;
  upsertUserActivity: Database.Statement<[string, string, number]>;
  insertLog: Database.Statement<[string, ActivityLogType, number]>;
  upsertUserBatch: Database.Statement<[string, string, number]>;
  setTrackingStatus: Database.Statement<[string, number, number, number]>;
  getUserLogCount: Database.Statement<[string], CountRow>;
  getUserInfo: Database.Statement<[string], UserInfoRow>;
  getUserWeightedScore: Database.Statement<[string], ScoreRow>;
  getInactiveUsersList: Database.Statement<[number], InactiveUserListRow>;
  getInactiveUsers: Database.Statement<[number], InactiveUserRow>;
  pruneLogs: Database.Statement<[number]>;
  deleteUserLogs: Database.Statement<[string]>;
  deleteUser: Database.Statement<[string]>;
  deleteBirthday: Database.Statement<[string]>;
  getAllTrackedUserIds: Database.Statement<[], UserIdRow>;
  setBirthday: Database.Statement<[string, string, number, number]>;
  getAllBirthdays: Database.Statement<[], BirthdayEntry>;
  getTodayBirthdays: Database.Statement<[number, number], TodayBirthdayEntry>;
  saveMonthWinner: Database.Statement<
    [string, string, number, number, number, number]
  >;
  getRecentWinners: Database.Statement<[number], RecentWinnerEntry>;
  getAllWinnersHistory: Database.Statement<[], WinnerHistoryEntry>;
  getTopUsersWithWeights: Database.Statement<
    [number, number, number],
    TopUserWeightedRow
  >;
  getUserLastByType: Database.Statement<[string], LastByTypeRow>;
  getUserRecentReactions: Database.Statement<[string, number], TimestampRow>;
}

interface DbState {
  stmts: DbStatements;
  logTransaction: Database.Transaction<
    (userId: string, username: string, type: ActivityLogType, now: number) => void
  >;
  updateBatchTransaction: Database.Transaction<
    (messages: BatchMessageEntry[]) => void
  >;
  removeUserTransaction: Database.Transaction<
    (userId: string) => RemoveUserResult
  >;
}

const db = new Database(path.join(import.meta.dirname, "../data.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

const cooldownCache = new Map<string, number>();

let state: DbState | null = null;

function getState(): DbState {
  if (!state) {
    throw new Error(
      "Base de données non initialisée. Appelez initDb() d'abord.",
    );
  }
  return state;
}

function prepareStatements(): void {
  const stmts: DbStatements = {
    getTrackingStatus: db.prepare<[string], TrackingStatusRow>(
      "SELECT tracking_enabled FROM users WHERE user_id = ?",
    ),
    upsertUserActivity: db.prepare<[string, string, number]>(`
      INSERT INTO users (user_id, username, last_active_timestamp, tracking_enabled)
      VALUES (?, ?, ?, 1)
      ON CONFLICT(user_id) DO UPDATE SET
        last_active_timestamp = excluded.last_active_timestamp,
        username = excluded.username
    `),
    insertLog: db.prepare<[string, ActivityLogType, number]>(
      "INSERT INTO logs (user_id, type, timestamp) VALUES (?, ?, ?)",
    ),
    upsertUserBatch: db.prepare<[string, string, number]>(`
      INSERT INTO users (user_id, username, last_active_timestamp, tracking_enabled)
      VALUES (?, ?, ?, 1)
      ON CONFLICT(user_id) DO UPDATE SET
        last_active_timestamp = MAX(last_active_timestamp, excluded.last_active_timestamp),
        username = excluded.username
    `),
    setTrackingStatus: db.prepare<[string, number, number, number]>(`
      INSERT INTO users (user_id, username, last_active_timestamp, tracking_enabled)
      VALUES (?, 'Inconnu', ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET tracking_enabled = ?
    `),
    getUserLogCount: db.prepare<[string], CountRow>(
      "SELECT COUNT(*) as count FROM logs WHERE user_id = ?",
    ),
    getUserInfo: db.prepare<[string], UserInfoRow>(
      "SELECT last_active_timestamp, tracking_enabled FROM users WHERE user_id = ?",
    ),
    getUserWeightedScore: db.prepare<[string], ScoreRow>(`
      SELECT 
        SUM(CASE 
          WHEN l.type = 'message' THEN 2
          WHEN l.type = 'file' THEN 1
          WHEN l.type = 'reaction' THEN 1
          ELSE 1
        END) as score
      FROM logs l
      WHERE l.user_id = ?
    `),
    getInactiveUsersList: db.prepare<[number], InactiveUserListRow>(
      "SELECT user_id, username, last_active_timestamp FROM users WHERE tracking_enabled = 1 AND last_active_timestamp < ? ORDER BY last_active_timestamp ASC",
    ),
    getInactiveUsers: db.prepare<[number], InactiveUserRow>(
      "SELECT user_id, last_active_timestamp FROM users WHERE tracking_enabled = 1 AND last_active_timestamp < ?",
    ),
    pruneLogs: db.prepare<[number]>("DELETE FROM logs WHERE timestamp < ?"),
    deleteUserLogs: db.prepare<[string]>("DELETE FROM logs WHERE user_id = ?"),
    deleteUser: db.prepare<[string]>("DELETE FROM users WHERE user_id = ?"),
    deleteBirthday: db.prepare<[string]>(
      "DELETE FROM birthdays WHERE user_id = ?",
    ),
    getAllTrackedUserIds: db.prepare<[], UserIdRow>(
      "SELECT user_id FROM users UNION SELECT user_id FROM birthdays",
    ),
    setBirthday: db.prepare<[string, string, number, number]>(`
      INSERT INTO birthdays (user_id, username, day, month)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        username = excluded.username,
        day      = excluded.day,
        month    = excluded.month
    `),
    getAllBirthdays: db.prepare<[], BirthdayEntry>(`
      SELECT user_id, username, day, month
      FROM birthdays
      ORDER BY month ASC, day ASC
    `),
    getTodayBirthdays: db.prepare<[number, number], TodayBirthdayEntry>(`
      SELECT user_id, username
      FROM birthdays
      WHERE day = ? AND month = ?
    `),
    saveMonthWinner: db.prepare<
      [string, string, number, number, number, number]
    >(`
      INSERT INTO member_of_month_history (user_id, username, month, year, score, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `),
    getRecentWinners: db.prepare<[number], RecentWinnerEntry>(`
      SELECT user_id, month, year, score
      FROM member_of_month_history
      ORDER BY year DESC, month DESC
      LIMIT ?
    `),
    getAllWinnersHistory: db.prepare<[], WinnerHistoryEntry>(`
      SELECT user_id, username, month, year, score, timestamp
      FROM member_of_month_history
      ORDER BY year DESC, month DESC
    `),
    getTopUsersWithWeights: db.prepare<
      [number, number, number],
      TopUserWeightedRow
    >(`
      SELECT 
        u.user_id,
        u.username,
        SUM(CASE 
          WHEN l.type = 'message' THEN 2
          WHEN l.type = 'file' THEN 1
          WHEN l.type = 'reaction' THEN 1
          ELSE 1
        END) as score
      FROM logs l
      JOIN users u ON l.user_id = u.user_id
      WHERE l.timestamp >= ? AND l.timestamp <= ? AND u.tracking_enabled = 1
      GROUP BY u.user_id
      ORDER BY score DESC
      LIMIT ?
    `),
    getUserLastByType: db.prepare<[string], LastByTypeRow>(`
      SELECT type, MAX(timestamp) as last_ts
      FROM logs
      WHERE user_id = ?
      GROUP BY type
    `),
    getUserRecentReactions: db.prepare<[string, number], TimestampRow>(`
      SELECT timestamp
      FROM logs
      WHERE user_id = ? AND type = 'reaction'
      ORDER BY timestamp DESC
      LIMIT ?
    `),
  };

  const logTransaction = db.transaction(
    (userId: string, username: string, type: ActivityLogType, now: number) => {
      stmts.upsertUserActivity.run(userId, username, now);
      stmts.insertLog.run(userId, type, now);
    },
  );

  const updateBatchTransaction = db.transaction(
    (messages: BatchMessageEntry[]) => {
      for (const msg of messages) {
        stmts.upsertUserBatch.run(msg.userId, msg.username, msg.ts);
      }
    },
  );

  // logs doit impérativement être supprimé avant users pour respecter FOREIGN KEY(user_id)
  const removeUserTransaction = db.transaction(
    (userId: string): RemoveUserResult => {
      const logsResult = stmts.deleteUserLogs.run(userId);
      const userResult = stmts.deleteUser.run(userId);
      stmts.deleteBirthday.run(userId);
      return { logs: logsResult.changes, user: userResult.changes };
    },
  );

  state = {
    stmts,
    logTransaction,
    updateBatchTransaction,
    removeUserTransaction,
  };
}

function initDb(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      username TEXT,
      last_active_timestamp INTEGER,
      tracking_enabled INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      type TEXT,
      timestamp INTEGER,
      FOREIGN KEY(user_id) REFERENCES users(user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_logs_user ON logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_logs_time ON logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_logs_user_type_time ON logs(user_id, type, timestamp DESC);

    -- Table des anniversaires (jour/mois uniquement — l'année n'est jamais stockée)
    CREATE TABLE IF NOT EXISTS birthdays (
      user_id   TEXT PRIMARY KEY,
      username  TEXT,
      day       INTEGER NOT NULL,
      month     INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_birthdays_month_day ON birthdays(month, day);

    CREATE TABLE IF NOT EXISTS member_of_month_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      username TEXT,
      month INTEGER NOT NULL,
      year INTEGER NOT NULL,
      score INTEGER NOT NULL,
      timestamp INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_motm_date ON member_of_month_history(year, month);
    CREATE INDEX IF NOT EXISTS idx_motm_user ON member_of_month_history(user_id);
  `);

  try {
    db.prepare("SELECT tracking_enabled FROM users LIMIT 1").get();
  } catch {
    try {
      db.exec(
        "ALTER TABLE users ADD COLUMN tracking_enabled INTEGER DEFAULT 1",
      );
    } catch (e) {
      console.error("Erreur lors de la migration DB:", e);
    }
  }

  prepareStatements();
  console.log("Base de données chargée.");
}

// Nettoyage automatique du cache 1 fois par heure (supprime les utilisateurs inactifs depuis plus d'une heure)
setInterval(() => {
  const now = Date.now();
  for (const [userId, timestamp] of cooldownCache.entries()) {
    if (now - timestamp > 3600000) {
      cooldownCache.delete(userId);
    }
  }
}, 3600000).unref();

function logActivity(
  userId: string,
  username: string,
  type: ActivityLogType,
  cooldownMs = 60000,
): void {
  const { stmts, logTransaction } = getState();
  const now = Date.now();

  const lastActivity = cooldownCache.get(userId);
  if (lastActivity && now - lastActivity < cooldownMs) return;

  const userCheck = stmts.getTrackingStatus.get(userId);
  if (userCheck && userCheck.tracking_enabled === 0) return;

  try {
    logTransaction(userId, username, type, now);
    cooldownCache.set(userId, now);
  } catch (err) {
    console.error("Erreur écriture DB:", err);
  }
}

function updateBatch(messages: BatchMessageEntry[]): void {
  getState().updateBatchTransaction(messages);
}

function setTrackingStatus(userId: string, enabled: boolean): void {
  const status = enabled ? 1 : 0;
  getState().stmts.setTrackingStatus.run(userId, Date.now(), status, status);
}

function getUserStats(userId: string): UserStats {
  const { stmts } = getState();
  const count = stmts.getUserLogCount.get(userId);
  const user = stmts.getUserInfo.get(userId);
  return {
    count: count ? count.count : 0,
    lastActive: user ? user.last_active_timestamp : null,
    tracking: user ? user.tracking_enabled : 1,
  };
}

/**
 * Calcule le score pondéré d'un utilisateur spécifique
 * (message=2, file=1, reaction=1)
 */
function getUserWeightedScore(userId: string): UserWeightedScore {
  const { stmts } = getState();
  const scoreResult = stmts.getUserWeightedScore.get(userId);
  const user = stmts.getUserInfo.get(userId);

  return {
    score: scoreResult && scoreResult.score ? scoreResult.score : 0,
    lastActive: user ? user.last_active_timestamp : null,
    tracking: user ? user.tracking_enabled : 1,
  };
}

function getInactiveUsersList(days: number): InactiveUserListRow[] {
  const thresholdDate = Date.now() - days * 24 * 60 * 60 * 1000;
  return getState().stmts.getInactiveUsersList.all(thresholdDate);
}

function getInactiveUsers(daysThreshold: number): InactiveUserRow[] {
  const thresholdDate = Date.now() - daysThreshold * 24 * 60 * 60 * 1000;
  return getState().stmts.getInactiveUsers.all(thresholdDate);
}

function pruneLogs(daysRetention: number): number {
  const limitTimestamp = Date.now() - daysRetention * 24 * 60 * 60 * 1000;
  return getState().stmts.pruneLogs.run(limitTimestamp).changes;
}

function removeUserData(userId: string): RemoveUserResult | null {
  try {
    const result = getState().removeUserTransaction(userId);
    console.log(
      `[GDPR] Suppression user ${userId} : ${result.user} user, ${result.logs} logs.`,
    );

    if (cooldownCache.has(userId)) {
      cooldownCache.delete(userId);
    }

    return result;
  } catch (error) {
    console.error(`[DB Error] Échec suppression ${userId} :`, error);
    return null;
  }
}

function createBackup(destinationPath: string): Promise<Database.BackupMetadata> {
  return db.backup(destinationPath);
}

function getAllTrackedUserIds(): string[] {
  const rows = getState().stmts.getAllTrackedUserIds.all();
  return rows.map((row) => row.user_id);
}

// --- ANNIVERSAIRES ---

function setBirthday(
  userId: string,
  username: string,
  day: number,
  month: number,
): void {
  getState().stmts.setBirthday.run(userId, username, day, month);
}

function deleteBirthday(userId: string): number {
  return getState().stmts.deleteBirthday.run(userId).changes;
}

function getAllBirthdays(): BirthdayEntry[] {
  return getState().stmts.getAllBirthdays.all();
}

function getTodayBirthdays(day: number, month: number): TodayBirthdayEntry[] {
  return getState().stmts.getTodayBirthdays.all(day, month);
}

// --- MEMBRE DU MOIS ---

function saveMonthWinner(
  userId: string,
  username: string,
  month: number,
  year: number,
  score: number,
): Database.RunResult {
  const timestamp = Date.now();
  return getState().stmts.saveMonthWinner.run(
    userId,
    username,
    month,
    year,
    score,
    timestamp,
  );
}

function getRecentWinners(months: number): RecentWinnerEntry[] {
  return getState().stmts.getRecentWinners.all(months);
}

function getAllWinnersHistory(): WinnerHistoryEntry[] {
  return getState().stmts.getAllWinnersHistory.all();
}

/**
 * Calcule le top N avec pondération (message=2, file=1, reaction=1)
 */
function getTopUsersWithWeights(
  startTs: number,
  endTs: number,
  limit = 10,
): TopUserWeightedRow[] {
  return getState().stmts.getTopUsersWithWeights.all(startTs, endTs, limit);
}

/**
 * Calcule le gagnant avec malus dégressif
 * Malus : -40% (M+1), -20% (M+2), -10% (M+3)
 */
function calculateWinnerWithPenalty(
  startTs: number,
  endTs: number,
  currentMonth: number,
  currentYear: number,
): WinnerCandidate[] {
  const topUsers = getTopUsersWithWeights(startTs, endTs, 10);

  if (topUsers.length === 0) return [];

  const recentWinners = getRecentWinners(3);

  const penaltyMap = new Map<string, number>();
  recentWinners.forEach((winner) => {
    const monthsAgo =
      (currentYear - winner.year) * 12 + (currentMonth - winner.month);

    let penalty = 0;
    if (monthsAgo === 1) penalty = 0.4;
    else if (monthsAgo === 2) penalty = 0.2;
    else if (monthsAgo === 3) penalty = 0.1;

    if (penalty > 0 && !penaltyMap.has(winner.user_id)) {
      penaltyMap.set(winner.user_id, penalty);
    }
  });

  const results: WinnerCandidate[] = topUsers.map((user) => {
    const penalty = penaltyMap.get(user.user_id) || 0;
    const adjustedScore = Math.floor(user.score * (1 - penalty));

    return {
      user_id: user.user_id,
      username: user.username,
      rawScore: user.score,
      penalty: penalty,
      adjustedScore: adjustedScore,
    };
  });

  results.sort((a, b) => b.adjustedScore - a.adjustedScore);

  return results;
}

function resetUserInactivity(userId: string, username: string): void {
  const now = Date.now();
  getState().stmts.upsertUserActivity.run(userId, username || "Inconnu", now);
}

function getUserActivityDetails(
  userId: string,
  reactionLimit = 5,
): UserActivityDetails {
  const { stmts } = getState();
  const user = stmts.getUserInfo.get(userId);
  const byTypeRows = stmts.getUserLastByType.all(userId);

  const lastByType: Record<ActivityLogType, number | null> = {
    message: null,
    file: null,
    reaction: null,
  };

  for (const row of byTypeRows) {
    if (
      row.type === "message" ||
      row.type === "file" ||
      row.type === "reaction"
    ) {
      lastByType[row.type] = row.last_ts;
    }
  }

  const recentReactions = stmts.getUserRecentReactions
    .all(userId, reactionLimit)
    .map((r) => r.timestamp);

  return {
    lastActive: user ? user.last_active_timestamp : null,
    tracking: user ? user.tracking_enabled : 1,
    lastByType,
    recentReactions,
  };
}

function closeDb(): void {
  if (db.open) {
    db.close();
    console.log("Base de données fermée proprement.");
  }
}

export {
  initDb,
  logActivity,
  resetUserInactivity,
  updateBatch,
  setTrackingStatus,
  getUserStats,
  getUserWeightedScore,
  getInactiveUsers,
  getInactiveUsersList,
  pruneLogs,
  removeUserData,
  createBackup,
  getAllTrackedUserIds,
  setBirthday,
  deleteBirthday,
  getAllBirthdays,
  getTodayBirthdays,
  saveMonthWinner,
  getRecentWinners,
  getAllWinnersHistory,
  getTopUsersWithWeights,
  calculateWinnerWithPenalty,
  getUserActivityDetails,
  closeDb,
};
