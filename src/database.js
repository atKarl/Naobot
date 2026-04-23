const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(path.join(__dirname, "../data.db"), { verbose: null });
db.pragma("journal_mode = WAL");

const cooldownCache = new Map();

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

  // Insérer l'historique existant si la table est vide
  try {
    const historyCount = db.prepare("SELECT COUNT(*) as count FROM member_of_month_history").get();
    if (historyCount.count === 0) {
      db.prepare(`
        INSERT INTO member_of_month_history (user_id, username, month, year, score, timestamp) VALUES
        ('692790029260685489', 'Flavien', 2, 2026, 443, 1709251200000),
        ('692790029260685489', 'Flavien', 3, 2026, 524, 1711929600000)
      `).run();
      console.log("Historique membre du mois initialisé.");
    }
  } catch (error) {
    console.error("Erreur lors de l'initialisation de l'historique:", error);
  }

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

  console.log("Base de données chargée.");
}

function logActivity(userId, username, type, cooldownMs = 60000) {
  const now = Date.now();

  if (cooldownCache.has(userId)) {
    const lastTime = cooldownCache.get(userId);
    if (now - lastTime < cooldownMs) return;
  }

  const userCheck = db
    .prepare("SELECT tracking_enabled FROM users WHERE user_id = ?")
    .get(userId);
  if (userCheck && userCheck.tracking_enabled === 0) return;

  const logTransaction = db.transaction(() => {
    db.prepare(
      `
      INSERT INTO users (user_id, username, last_active_timestamp, tracking_enabled)
      VALUES (?, ?, ?, 1)
      ON CONFLICT(user_id) DO UPDATE SET
        last_active_timestamp = excluded.last_active_timestamp,
        username = excluded.username
    `,
    ).run(userId, username, now);

    db.prepare(
      "INSERT INTO logs (user_id, type, timestamp) VALUES (?, ?, ?)",
    ).run(userId, type, now);
  });

  try {
    logTransaction();
    cooldownCache.set(userId, now);
    setTimeout(() => cooldownCache.delete(userId), cooldownMs);
  } catch (err) {
    console.error("Erreur écriture DB:", err);
  }
}

const updateBatch = db.transaction((messages) => {
  const stmt = db.prepare(`
    INSERT INTO users (user_id, username, last_active_timestamp, tracking_enabled)
    VALUES (?, ?, ?, 1)
    ON CONFLICT(user_id) DO UPDATE SET
      last_active_timestamp = MAX(last_active_timestamp, excluded.last_active_timestamp),
      username = excluded.username
  `);
  for (const msg of messages) {
    stmt.run(msg.userId, msg.username, msg.ts);
  }
});

function setTrackingStatus(userId, enabled) {
  const status = enabled ? 1 : 0;
  db.prepare(
    `
    INSERT INTO users (user_id, username, last_active_timestamp, tracking_enabled)
    VALUES (?, 'Inconnu', ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET tracking_enabled = ?
  `,
  ).run(userId, Date.now(), status, status);
}

function getUserStats(userId) {
  const count = db
    .prepare("SELECT COUNT(*) as count FROM logs WHERE user_id = ?")
    .get(userId);
  const user = db
    .prepare(
      "SELECT last_active_timestamp, tracking_enabled FROM users WHERE user_id = ?",
    )
    .get(userId);
  return {
    count: count ? count.count : 0,
    lastActive: user ? user.last_active_timestamp : null,
    tracking: user ? user.tracking_enabled : 1,
  };
}

function getTopUsers(limit = 10) {
  return db
    .prepare(
      `
    SELECT u.username, u.user_id, COUNT(l.id) as score
    FROM users u JOIN logs l ON u.user_id = l.user_id
    WHERE u.tracking_enabled = 1
    GROUP BY u.user_id ORDER BY score DESC LIMIT ?
  `,
    )
    .all(limit);
}

function getInactiveUsersList(days) {
  const thresholdDate = Date.now() - days * 24 * 60 * 60 * 1000;
  return db
    .prepare(
      `SELECT user_id, username, last_active_timestamp FROM users WHERE last_active_timestamp < ? ORDER BY last_active_timestamp ASC`,
    )
    .all(thresholdDate);
}

function getInactiveUsers(daysThreshold) {
  const thresholdDate = Date.now() - daysThreshold * 24 * 60 * 60 * 1000;
  return db
    .prepare(
      `SELECT user_id, last_active_timestamp FROM users WHERE last_active_timestamp < ?`,
    )
    .all(thresholdDate);
}

function getTopUserByPeriod(startTs, endTs) {
  return db
    .prepare(
      `
    SELECT u.user_id, COUNT(l.id) as score FROM logs l JOIN users u ON l.user_id = u.user_id
    WHERE l.timestamp >= ? AND l.timestamp <= ? AND u.tracking_enabled = 1
    GROUP BY u.user_id ORDER BY score DESC LIMIT 1
  `,
    )
    .get(startTs, endTs);
}

function pruneLogs(daysRetention) {
  const limitTimestamp = Date.now() - daysRetention * 24 * 60 * 60 * 1000;
  return db.prepare("DELETE FROM logs WHERE timestamp < ?").run(limitTimestamp)
    .changes;
}

/**
 * Supprime toutes les données d'un utilisateur (RGPD + départ serveur).
 */
function removeUserData(userId) {
  const deleteLogs = db.prepare("DELETE FROM logs WHERE user_id = ?");
  const deleteUser = db.prepare("DELETE FROM users WHERE user_id = ?");
  const deleteBirthday = db.prepare("DELETE FROM birthdays WHERE user_id = ?");

  const transaction = db.transaction(() => {
    const logsResult = deleteLogs.run(userId);
    const userResult = deleteUser.run(userId);
    deleteBirthday.run(userId);
    return { logs: logsResult.changes, user: userResult.changes };
  });

  try {
    const result = transaction();
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

function getAllUserIds() {
  const rows = db.prepare("SELECT user_id FROM users").all();
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
  db.prepare(
    `
    INSERT INTO birthdays (user_id, username, day, month)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      username = excluded.username,
      day      = excluded.day,
      month    = excluded.month
  `,
  ).run(userId, username, day, month);
}

/**
 * Supprime l'anniversaire d'un utilisateur.
 *
 * @param {string} userId
 * @returns {number} Nombre de lignes supprimées (0 ou 1)
 */
function deleteBirthday(userId) {
  return db.prepare("DELETE FROM birthdays WHERE user_id = ?").run(userId)
    .changes;
}

/**
 * Récupère l'anniversaire d'un utilisateur.
 *
 * @param {string} userId
 * @returns {{ user_id, username, day, month } | undefined}
 */
function getBirthday(userId) {
  return db.prepare("SELECT * FROM birthdays WHERE user_id = ?").get(userId);
}

/**
 * Retourne tous les anniversaires triés chronologiquement.
 *
 * @returns {Array<{ user_id, username, day, month }>}
 */
function getAllBirthdays() {
  return db
    .prepare(
      `
    SELECT user_id, username, day, month
    FROM birthdays
    ORDER BY month ASC, day ASC
  `,
    )
    .all();
}

/**
 * Retourne les anniversaires du jour (pour le cron d'annonces).
 *
 * @param {number} day
 * @param {number} month
 * @returns {Array<{ user_id, username }>}
 */
function getTodayBirthdays(day, month) {
  return db
    .prepare(
      `
    SELECT user_id, username
    FROM birthdays
    WHERE day = ? AND month = ?
  `,
    )
    .all(day, month);
}

// ========== MEMBRE DU MOIS ==========

/**
 * Sauvegarde un gagnant dans l'historique
 */
function saveMonthWinner(userId, username, month, year, score) {
  const timestamp = Date.now();
  return db
    .prepare(
      `
    INSERT INTO member_of_month_history (user_id, username, month, year, score, timestamp)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
    )
    .run(userId, username, month, year, score, timestamp);
}

/**
 * Récupère les N derniers gagnants (pour calcul du malus)
 */
function getRecentWinners(months) {
  return db
    .prepare(
      `
    SELECT user_id, month, year, score
    FROM member_of_month_history
    ORDER BY year DESC, month DESC
    LIMIT ?
  `,
    )
    .all(months);
}

/**
 * Récupère tout l'historique (pour la commande)
 */
function getAllWinnersHistory() {
  return db
    .prepare(
      `
    SELECT user_id, username, month, year, score, timestamp
    FROM member_of_month_history
    ORDER BY year DESC, month DESC
  `,
    )
    .all();
}

/**
 * Calcule le top N avec pondération (message=2, file=1, reaction=1)
 */
function getTopUsersWithWeights(startTs, endTs, limit = 10) {
  return db
    .prepare(
      `
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
  `,
    )
    .all(startTs, endTs, limit);
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
    if (monthsAgo === 1) penalty = 0.4; // -40%
    else if (monthsAgo === 2) penalty = 0.2; // -20%
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

module.exports = {
  initDb,
  logActivity,
  updateBatch,
  setTrackingStatus,
  getUserStats,
  getTopUsers,
  getInactiveUsers,
  getInactiveUsersList,
  getTopUserByPeriod,
  pruneLogs,
  removeUserData,
  createBackup,
  getAllUserIds,
  setBirthday,
  deleteBirthday,
  getBirthday,
  getAllBirthdays,
  getTodayBirthdays,
  saveMonthWinner,
  getRecentWinners,
  getAllWinnersHistory,
  getTopUsersWithWeights,
  calculateWinnerWithPenalty,
};
