const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(path.join(__dirname, "../data.db"), { verbose: null });
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

const cooldownCache = new Map();

let stmts = {};
let logTransaction = null;
let updateBatchTransaction = null;
let removeUserTransaction = null;

function prepareStatements() {
  stmts = {
    getTrackingStatus: db.prepare(
      "SELECT tracking_enabled FROM users WHERE user_id = ?",
    ),
    upsertUserActivity: db.prepare(`
      INSERT INTO users (user_id, username, last_active_timestamp, tracking_enabled)
      VALUES (?, ?, ?, 1)
      ON CONFLICT(user_id) DO UPDATE SET
        last_active_timestamp = excluded.last_active_timestamp,
        username = excluded.username
    `),
    insertLog: db.prepare(
      "INSERT INTO logs (user_id, type, timestamp) VALUES (?, ?, ?)",
    ),
    upsertUserBatch: db.prepare(`
      INSERT INTO users (user_id, username, last_active_timestamp, tracking_enabled)
      VALUES (?, ?, ?, 1)
      ON CONFLICT(user_id) DO UPDATE SET
        last_active_timestamp = MAX(last_active_timestamp, excluded.last_active_timestamp),
        username = excluded.username
    `),
    setTrackingStatus: db.prepare(`
      INSERT INTO users (user_id, username, last_active_timestamp, tracking_enabled)
      VALUES (?, 'Inconnu', ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET tracking_enabled = ?
    `),
    getUserLogCount: db.prepare(
      "SELECT COUNT(*) as count FROM logs WHERE user_id = ?",
    ),
    getUserInfo: db.prepare(
      "SELECT last_active_timestamp, tracking_enabled FROM users WHERE user_id = ?",
    ),
    getUserWeightedScore: db.prepare(`
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
    getInactiveUsersList: db.prepare(
      "SELECT user_id, username, last_active_timestamp FROM users WHERE tracking_enabled = 1 AND last_active_timestamp < ? ORDER BY last_active_timestamp ASC",
    ),
    getInactiveUsers: db.prepare(
      "SELECT user_id, last_active_timestamp FROM users WHERE tracking_enabled = 1 AND last_active_timestamp < ?",
    ),
    pruneLogs: db.prepare("DELETE FROM logs WHERE timestamp < ?"),
    deleteUserLogs: db.prepare("DELETE FROM logs WHERE user_id = ?"),
    deleteUser: db.prepare("DELETE FROM users WHERE user_id = ?"),
    deleteBirthday: db.prepare("DELETE FROM birthdays WHERE user_id = ?"),
    getAllTrackedUserIds: db.prepare(
      "SELECT user_id FROM users UNION SELECT user_id FROM birthdays",
    ),
    setBirthday: db.prepare(`
      INSERT INTO birthdays (user_id, username, day, month)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        username = excluded.username,
        day      = excluded.day,
        month    = excluded.month
    `),
    getAllBirthdays: db.prepare(`
      SELECT user_id, username, day, month
      FROM birthdays
      ORDER BY month ASC, day ASC
    `),
    getTodayBirthdays: db.prepare(`
      SELECT user_id, username
      FROM birthdays
      WHERE day = ? AND month = ?
    `),
    saveMonthWinner: db.prepare(`
      INSERT INTO member_of_month_history (user_id, username, month, year, score, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `),
    getRecentWinners: db.prepare(`
      SELECT user_id, month, year, score
      FROM member_of_month_history
      ORDER BY year DESC, month DESC
      LIMIT ?
    `),
    getAllWinnersHistory: db.prepare(`
      SELECT user_id, username, month, year, score, timestamp
      FROM member_of_month_history
      ORDER BY year DESC, month DESC
    `),
    getTopUsersWithWeights: db.prepare(`
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
    getUserLastByType: db.prepare(`
      SELECT type, MAX(timestamp) as last_ts
      FROM logs
      WHERE user_id = ?
      GROUP BY type
    `),
    getUserRecentReactions: db.prepare(`
      SELECT timestamp
      FROM logs
      WHERE user_id = ? AND type = 'reaction'
      ORDER BY timestamp DESC
      LIMIT ?
    `),
  };

  logTransaction = db.transaction((userId, username, type, now) => {
    stmts.upsertUserActivity.run(userId, username, now);
    stmts.insertLog.run(userId, type, now);
  });

  updateBatchTransaction = db.transaction((messages) => {
    for (const msg of messages) {
      stmts.upsertUserBatch.run(msg.userId, msg.username, msg.ts);
    }
  });

  // logs doit impérativement être supprimé avant users pour respecter FOREIGN KEY(user_id)
  removeUserTransaction = db.transaction((userId) => {
    const logsResult = stmts.deleteUserLogs.run(userId);
    const userResult = stmts.deleteUser.run(userId);
    stmts.deleteBirthday.run(userId);
    return { logs: logsResult.changes, user: userResult.changes };
  });
}

function initDb() {
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
      day       INTEGER NOT NULL, -- Jour (1-31)
      month     INTEGER NOT NULL  -- Mois (1-12)
    );
    CREATE INDEX IF NOT EXISTS idx_birthdays_month_day ON birthdays(month, day);

    -- Table historique des membres du mois
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
  } catch (error) {
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

function logActivity(userId, username, type, cooldownMs = 60000) {
  const now = Date.now();

  const lastActivity = cooldownCache.get(userId);
  if (lastActivity && now - lastActivity < cooldownMs) return;

  const userCheck = stmts.getTrackingStatus.get(userId);
  if (userCheck && userCheck.tracking_enabled === 0) return;

  try {
    logTransaction(userId, username, type, now);
    cooldownCache.set(userId, now); // Enregistre simplement le timestamp
  } catch (err) {
    console.error("Erreur écriture DB:", err);
  }
}

function updateBatch(messages) {
  return updateBatchTransaction(messages);
}

function setTrackingStatus(userId, enabled) {
  const status = enabled ? 1 : 0;
  stmts.setTrackingStatus.run(userId, Date.now(), status, status);
}

function getUserStats(userId) {
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
function getUserWeightedScore(userId) {
  const scoreResult = stmts.getUserWeightedScore.get(userId);
  const user = stmts.getUserInfo.get(userId);

  return {
    score: scoreResult && scoreResult.score ? scoreResult.score : 0,
    lastActive: user ? user.last_active_timestamp : null,
    tracking: user ? user.tracking_enabled : 1,
  };
}

function getInactiveUsersList(days) {
  const thresholdDate = Date.now() - days * 24 * 60 * 60 * 1000;
  return stmts.getInactiveUsersList.all(thresholdDate);
}

function getInactiveUsers(daysThreshold) {
  const thresholdDate = Date.now() - daysThreshold * 24 * 60 * 60 * 1000;
  return stmts.getInactiveUsers.all(thresholdDate);
}

function pruneLogs(daysRetention) {
  const limitTimestamp = Date.now() - daysRetention * 24 * 60 * 60 * 1000;
  return stmts.pruneLogs.run(limitTimestamp).changes;
}

/**
 * Supprime toutes les données d'un utilisateur (RGPD + départ serveur).
 */
function removeUserData(userId) {
  try {
    const result = removeUserTransaction(userId);
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

function createBackup(destinationPath) {
  return db.backup(destinationPath);
}

function getAllTrackedUserIds() {
  const rows = stmts.getAllTrackedUserIds.all();
  return rows.map((row) => row.user_id);
}

// ========== ANNIVERSAIRES ==========

/**
 * Enregistre ou met à jour l'anniversaire d'un utilisateur.
 * L'année n'est jamais stockée.
 *
 * @param {string} userId
 * @param {string} username
 * @param {number} day    - 1-31
 * @param {number} month  - 1-12
 */
function setBirthday(userId, username, day, month) {
  stmts.setBirthday.run(userId, username, day, month);
}

/**
 * Supprime l'anniversaire d'un utilisateur.
 *
 * @param {string} userId
 * @returns {number} Nombre de lignes supprimées (0 ou 1)
 */
function deleteBirthday(userId) {
  return stmts.deleteBirthday.run(userId).changes;
}

/**
 * Retourne tous les anniversaires triés chronologiquement.
 *
 * @returns {Array<{ user_id, username, day, month }>}
 */
function getAllBirthdays() {
  return stmts.getAllBirthdays.all();
}

/**
 * Retourne les anniversaires du jour (pour le cron d'annonces).
 *
 * @param {number} day
 * @param {number} month
 * @returns {Array<{ user_id, username }>}
 */
function getTodayBirthdays(day, month) {
  return stmts.getTodayBirthdays.all(day, month);
}

// ========== MEMBRE DU MOIS ==========

/**
 * Sauvegarde un gagnant dans l'historique
 */
function saveMonthWinner(userId, username, month, year, score) {
  const timestamp = Date.now();
  return stmts.saveMonthWinner.run(
    userId,
    username,
    month,
    year,
    score,
    timestamp,
  );
}

/**
 * Récupère les N derniers gagnants (pour calcul du malus)
 */
function getRecentWinners(months) {
  return stmts.getRecentWinners.all(months);
}

/**
 * Récupère tout l'historique (pour la commande)
 */
function getAllWinnersHistory() {
  return stmts.getAllWinnersHistory.all();
}

/**
 * Calcule le top N avec pondération (message=2, file=1, reaction=1)
 */
function getTopUsersWithWeights(startTs, endTs, limit = 10) {
  return stmts.getTopUsersWithWeights.all(startTs, endTs, limit);
}

/**
 * Calcule le gagnant avec malus dégressif
 * Malus : -40% (M+1), -20% (M+2), -10% (M+3)
 */
function calculateWinnerWithPenalty(startTs, endTs, currentMonth, currentYear) {
  // 1. Récupérer le top 10 avec pondération
  const topUsers = getTopUsersWithWeights(startTs, endTs, 10);

  if (topUsers.length === 0) return [];

  // 2. Récupérer les 3 derniers gagnants
  const recentWinners = getRecentWinners(3);

  // 3. Créer une map des malus par user_id
  const penaltyMap = new Map();
  recentWinners.forEach((winner) => {
    // Calculer combien de mois se sont écoulés
    const monthsAgo =
      (currentYear - winner.year) * 12 + (currentMonth - winner.month);

    let penalty = 0;
    if (monthsAgo === 1)
      penalty = 0.4; // -40%
    else if (monthsAgo === 2)
      penalty = 0.2; // -20%
    else if (monthsAgo === 3) penalty = 0.1; // -10%

    if (penalty > 0 && !penaltyMap.has(winner.user_id)) {
      penaltyMap.set(winner.user_id, penalty);
    }
  });

  // 4. Appliquer les malus et calculer les scores ajustés
  const results = topUsers.map((user) => {
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

  // 5. Trier par score ajusté
  results.sort((a, b) => b.adjustedScore - a.adjustedScore);

  return results;
}

function resetUserInactivity(userId, username) {
  const now = Date.now();
  stmts.upsertUserActivity.run(userId, username || "Inconnu", now);
}

function getUserActivityDetails(userId, reactionLimit = 5) {
  const user = stmts.getUserInfo.get(userId);
  const byTypeRows = stmts.getUserLastByType.all(userId);

  const lastByType = {
    message: null,
    file: null,
    reaction: null,
  };

  for (const row of byTypeRows) {
    if (row.type in lastByType) {
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

function closeDb() {
  if (db.open) {
    db.close();
    console.log("Base de données fermée proprement.");
  }
}

module.exports = {
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
