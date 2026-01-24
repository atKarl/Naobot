const Database = require("better-sqlite3");
const path = require("path");

// Connexion à la base de données (fichier data.db à la racine)
const db = new Database(path.join(__dirname, "../data.db"), { verbose: null });
// Mode WAL pour de meilleures performances en écriture simultanée
db.pragma("journal_mode = WAL");

// Cache en mémoire { userId: timestamp }
// Permet de vérifier le délai anti-spam sans lire le disque dur à chaque message
const cooldownCache = new Map();

function initDb() {
  // Initialisation des tables
  db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            user_id TEXT PRIMARY KEY,
            username TEXT,
            last_active_timestamp INTEGER,
            tracking_enabled INTEGER DEFAULT 1 -- 1 = Suivi activé (RGPD), 0 = Désactivé
        );
        CREATE TABLE IF NOT EXISTS logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT,
            type TEXT, -- 'message', 'reaction', 'file'
            timestamp INTEGER,
            FOREIGN KEY(user_id) REFERENCES users(user_id)
        );
        -- Index pour accélérer les recherches et classements
        CREATE INDEX IF NOT EXISTS idx_logs_user ON logs(user_id);
        CREATE INDEX IF NOT EXISTS idx_logs_time ON logs(timestamp);
    `);

  // Vérification et ajout de la colonne tracking_enabled si elle manque (Migration)
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

/**
 * Enregistre une activité utilisateur
 * Utilise un cache mémoire pour réduire les I/O disque
 */
function logActivity(userId, username, type, cooldownMs = 60000) {
  const now = Date.now();

  // 1. Vérification rapide via le Cache RAM
  if (cooldownCache.has(userId)) {
    const lastTime = cooldownCache.get(userId);
    if (now - lastTime < cooldownMs) {
      return; // Délai non écoulé, on ignore
    }
  }

  // 2. Vérification du statut RGPD (Lecture DB nécessaire)
  const userCheck = db
    .prepare("SELECT tracking_enabled FROM users WHERE user_id = ?")
    .get(userId);
  if (userCheck && userCheck.tracking_enabled === 0) return;

  // 3. Écriture en base via une Transaction (Atomique)
  const logTransaction = db.transaction(() => {
    // Création ou mise à jour de l'utilisateur
    db.prepare(
      `
            INSERT INTO users (user_id, username, last_active_timestamp, tracking_enabled)
            VALUES (?, ?, ?, 1)
            ON CONFLICT(user_id) DO UPDATE SET
                last_active_timestamp = excluded.last_active_timestamp,
                username = excluded.username
        `,
    ).run(userId, username, now);

    // Enregistrement de l'événement
    db.prepare(
      "INSERT INTO logs (user_id, type, timestamp) VALUES (?, ?, ?)",
    ).run(userId, type, now);
  });

  try {
    logTransaction();

    // 4. Mise à jour du cache RAM
    cooldownCache.set(userId, now);

    // Nettoyage automatique de la clé cache après expiration du délai
    setTimeout(() => cooldownCache.delete(userId), cooldownMs);
  } catch (err) {
    console.error("Erreur écriture DB:", err);
  }
}

/**
 * Transaction par lot pour le scan d'historique
 * Écrit plusieurs entrées en une seule opération pour la performance
 */
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

// Active ou désactive le suivi pour un utilisateur (RGPD)
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

// Supprime les logs plus vieux que X jours pour limiter la taille de la DB
function pruneLogs(daysRetention) {
  const limitTimestamp = Date.now() - daysRetention * 24 * 60 * 60 * 1000;
  return db.prepare("DELETE FROM logs WHERE timestamp < ?").run(limitTimestamp)
    .changes;
}

// Supprime toutes les données d'un utilisateur si il quitte le serveur (RGPD)
function removeUserData(userId) {
  const deleteLogs = db.prepare("DELETE FROM logs WHERE user_id = ?");
  const deleteUser = db.prepare("DELETE FROM users WHERE user_id = ?");

  const transaction = db.transaction(() => {
    const logsResult = deleteLogs.run(userId);
    const userResult = deleteUser.run(userId);
    return { logs: logsResult.changes, user: userResult.changes };
  });

  try {
    const result = transaction();
    console.log(
      `[GDPR] Suppression user ${userId} : ${result.user} user, ${result.logs} logs.`,
    );

    // Nettoyage du cache RAM si présent
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
};
