const Database = require("better-sqlite3");
const path = require("path");

// Connexion à la base de données
const db = new Database(path.join(__dirname, "../data.db"), { verbose: null });
db.pragma("journal_mode = WAL");

// --- CACHE MÉMOIRE ANTI-SPAM ---
// Stocke { userId: timestamp } pour éviter de lire la DB à chaque message
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
    `);

  // Migration auto RGPD
  try {
    db.prepare("SELECT tracking_enabled FROM users LIMIT 1").get();
  } catch (error) {
    console.log("[MIGRATION] Ajout de la colonne tracking_enabled...");
    try {
      db.exec(
        "ALTER TABLE users ADD COLUMN tracking_enabled INTEGER DEFAULT 1"
      );
    } catch (e) {}
  }

  console.log("Base de données chargée (Mode WAL + Cache Mem).");
}

/**
 * LOG ACTIVITY OPTIMISÉ (Cache RAM)
 */
function logActivity(userId, username, type, cooldownMs = 60000) {
  const now = Date.now();

  // 1. VÉRIFICATION CACHE RAM (Ultra rapide, 0 accès disque)
  if (cooldownCache.has(userId)) {
    const lastTime = cooldownCache.get(userId);
    if (now - lastTime < cooldownMs) {
      return; // Spam détecté en RAM -> On arrête tout de suite
    }
  }

  // 2. CHECK RGPD (Accès DB nécessaire ici)
  const userCheck = db
    .prepare("SELECT tracking_enabled FROM users WHERE user_id = ?")
    .get(userId);
  if (userCheck && userCheck.tracking_enabled === 0) return;

  // 3. ÉCRITURE DB (Transaction atomique)
  const logTransaction = db.transaction(() => {
    // Upsert User
    db.prepare(
      `
            INSERT INTO users (user_id, username, last_active_timestamp, tracking_enabled)
            VALUES (?, ?, ?, 1)
            ON CONFLICT(user_id) DO UPDATE SET
                last_active_timestamp = excluded.last_active_timestamp,
                username = excluded.username
        `
    ).run(userId, username, now);

    // Insert Log
    db.prepare(
      "INSERT INTO logs (user_id, type, timestamp) VALUES (?, ?, ?)"
    ).run(userId, type, now);
  });

  try {
    logTransaction();

    // 4. MISE À JOUR CACHE RAM
    cooldownCache.set(userId, now);

    // Nettoyage automatique du cache après le temps de cooldown (pour libérer la RAM)
    setTimeout(() => cooldownCache.delete(userId), cooldownMs);
  } catch (err) {
    console.error("Erreur écriture DB:", err);
  }
}

// ... Le reste des fonctions (updateBatch, stats, etc.) reste identique ...
// Pour gagner de la place ici, je remets juste les exports et les fonctions critiques
// Copiez-collez vos fonctions existantes (updateBatch, getInactiveUsersList, etc.) ci-dessous.

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
    `
  ).run(userId, Date.now(), status, status);
}

function getUserStats(userId) {
  const count = db
    .prepare("SELECT COUNT(*) as count FROM logs WHERE user_id = ?")
    .get(userId);
  const user = db
    .prepare(
      "SELECT last_active_timestamp, tracking_enabled FROM users WHERE user_id = ?"
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
    `
    )
    .all(limit);
}

function getInactiveUsersList(days) {
  const thresholdDate = Date.now() - days * 24 * 60 * 60 * 1000;
  return db
    .prepare(
      `SELECT user_id, username, last_active_timestamp FROM users WHERE last_active_timestamp < ? ORDER BY last_active_timestamp ASC`
    )
    .all(thresholdDate);
}

function getInactiveUsers(daysThreshold) {
  const thresholdDate = Date.now() - daysThreshold * 24 * 60 * 60 * 1000;
  return db
    .prepare(
      `SELECT user_id, last_active_timestamp FROM users WHERE last_active_timestamp < ?`
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
    `
    )
    .get(startTs, endTs);
}

function pruneLogs(daysRetention) {
  const limitTimestamp = Date.now() - daysRetention * 24 * 60 * 60 * 1000;
  return db.prepare("DELETE FROM logs WHERE timestamp < ?").run(limitTimestamp)
    .changes;
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
};
