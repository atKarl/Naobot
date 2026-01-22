const fs = require("fs");
const path = require("path");
const {
  Client,
  GatewayIntentBits,
  Events,
  Collection,
  EmbedBuilder,
  AttachmentBuilder,
  ActivityType,
  MessageFlags,
} = require("discord.js");
const cron = require("node-cron");
const config = require("./config.json");
const db = require("./src/database");

db.initDb();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMembers,
  ],
});

// --- CHARGEMENT DES COMMANDES ---
client.commands = new Collection();
const foldersPath = path.join(__dirname, "src/commands");
const commandFolders = fs.readdirSync(foldersPath);

for (const folder of commandFolders) {
  const commandsPath = path.join(foldersPath, folder);
  const commandFiles = fs
    .readdirSync(commandsPath)
    .filter((file) => file.endsWith(".js"));
  for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    if ("data" in command && "execute" in command) {
      client.commands.set(command.data.name, command);
    }
  }
}

// --- ÉVÉNEMENTS DISCORD ---

client.once(Events.ClientReady, (c) => {
  console.log(`✅ Prêt ! Connecté en tant que ${c.user.tag}`);
  c.user.setPresence({
    activities: [
      {
        name: "/help pour avoir de l'aide",
        type: ActivityType.Watching,
      },
    ],
    status: "online",
  });
  console.log(`⏱️ Cooldown anti-spam : ${config.cooldown / 1000}s`);
  initCronJobs();
});

// Gestion des intéractions (Commandes Slash)
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`Erreur Commande ${interaction.commandName}:`, error);
    const errPayload = {
      content: "Une erreur interne est survenue.",
      flags: MessageFlags.Ephemeral,
    };
    if (interaction.replied || interaction.deferred)
      await interaction.followUp(errPayload);
    else await interaction.reply(errPayload);
  }
});

// Tracking des Messages
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  // Si le membre a le rôle inactif, on lui retire immédiatement
  if (
    message.guild &&
    message.member &&
    message.member.roles.cache.has(config.roles.inactive)
  ) {
    try {
      await message.member.roles.remove(config.roles.inactive);
      console.log(
        `[RÉVEIL] Le rôle inactif a été retiré à ${message.author.tag}`,
      );
    } catch (err) {
      console.error(
        `Impossible de retirer le rôle inactif à ${message.author.tag} :`,
        err.message,
      );
    }
  }

  // Vérification des salons ignorés
  if (
    config.ignoredChannels &&
    config.ignoredChannels.includes(message.channel.id)
  )
    return;

  let type = "message";
  if (message.attachments.size > 0) type = "file";

  // Log avec gestion du cooldown
  db.logActivity(
    message.author.id,
    message.author.username,
    type,
    config.cooldown,
  );
});

// Tracking des Réactions
client.on(Events.MessageReactionAdd, async (reaction, user) => {
  if (user.bot) return;

  // Gestion des messages partiels (vieux messages non cachés)
  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch (e) {
      return;
    }
  }

  // Retrait du rôle Inactif si l'utilisateur met une réaction
  if (reaction.message.guild) {
    try {
      // On doit récupérer le membre pour accéder à ses rôles
      const member = await reaction.message.guild.members.fetch(user.id);

      if (member.roles.cache.has(config.roles.inactive)) {
        await member.roles.remove(config.roles.inactive);
        console.log(
          `[RÉVEIL] Rôle inactif retiré via réaction pour ${user.tag}`,
        );
      }
    } catch (err) {
      // Erreur silencieuse (ex: membre a quitté le serveur entre temps)
    }
  }

  if (
    config.ignoredChannels &&
    config.ignoredChannels.includes(reaction.message.channel.id)
  )
    return;

  db.logActivity(user.id, user.username, "reaction", config.cooldown);
});

// Gestion des Départs (GDPR - Droit à l'oubli)
client.on(Events.GuildMemberRemove, async (member) => {
  if (member.user.bot) return;

  // Suppression immédiate de la BDD
  db.removeUserData(member.id);
});

// --- TÂCHES AUTOMATIQUES (CRON) ---

function initCronJobs() {
  console.log("📅 Tâches Cron initialisées.");

  // Tâche 1 : Vérification d'Inactivité (Minuit)
  cron.schedule("0 0 * * *", async () => {
    console.log("[CRON] Vérification d'inactivité...");
    const guild = client.guilds.cache.get(config.guildId);
    if (!guild) return;

    // Récupère les utilisateurs inactifs depuis plus de 90 jours
    const inactiveUsers = db.getInactiveUsers(90);
    if (inactiveUsers.length === 0) return;

    console.log(`[CRON] ${inactiveUsers.length} utilisateurs à traiter.`);

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    for (const userData of inactiveUsers) {
      try {
        let member = guild.members.cache.get(userData.user_id);

        // Si pas en cache, on fetch
        if (!member) {
          try {
            member = await guild.members.fetch(userData.user_id);
          } catch (e) {
            // Le membre a quitté le serveur, on passe au suivant
            continue;
          }
        }

        // Si a déjà le rôle, on passe
        if (member.roles.cache.has(config.roles.inactive)) continue;

        await member.roles.add(config.roles.inactive);
        console.log(`[INACTIVITÉ] +Rôle pour ${member.user.tag}`);

        // Pause de 1s pour éviter les Rate Limits de Discord
        await sleep(1000);
      } catch (err) {
        console.error(
          `Erreur traitement user ${userData.user_id}:`,
          err.message,
        );
      }
    }
    console.log("[CRON] Traitement inactivité terminé.");
  });

  // Tâche 2 : Membre du Mois (1er du mois à minuit)
  cron.schedule("0 0 1 * *", async () => {
    console.log("[CRON] Calcul Membre du Mois...");
    const guild = client.guilds.cache.get(config.guildId);
    if (!guild) return;

    // Calcul de la période (Mois précédent complet)
    const now = new Date();
    const startOfLastMonth = new Date(
      now.getFullYear(),
      now.getMonth() - 1,
      1,
    ).getTime();
    const endOfLastMonth = new Date(
      now.getFullYear(),
      now.getMonth(),
      0,
      23,
      59,
      59,
    ).getTime();

    const winnerData = db.getTopUserByPeriod(startOfLastMonth, endOfLastMonth);
    if (!winnerData) return console.log("Aucune activité ce mois-ci.");

    try {
      // Retrait du rôle à l'ancien gagnant
      const role = await guild.roles.fetch(config.roles.activeOfMonth);
      if (role) {
        for (const [id, member] of role.members) {
          await member.roles.remove(role);
        }
      }

      // Ajout du rôle au nouveau gagnant
      try {
        const winnerMember = await guild.members.fetch(winnerData.user_id);
        await winnerMember.roles.add(config.roles.activeOfMonth);

        const channel = guild.channels.cache.get(config.channels.announcement);
        if (channel) {
          const embed = new EmbedBuilder()
            .setColor(0xe91e63)
            .setTitle("🎉 Membre du Mois !")
            .setDescription(
              `Bravo <@${winnerData.user_id}> qui a été le plus actif le mois dernier !`,
            )
            .addFields({
              name: "Score",
              value: `${winnerData.score} points`,
              inline: true,
            })
            .setTimestamp();
          await channel.send({ embeds: [embed] });
        }
      } catch (e) {
        console.log("Le gagnant semble avoir quitté le serveur.");
      }
    } catch (err) {
      console.error(err);
    }
  });

  // Tâche 3: Maintenance Hebdomadaire (Dimanche à 04h00)
  // Nettoyage logs + Sauvegarde DB + Rotation fichiers
  cron.schedule("0 4 * * 0", async () => {
    console.log("[MAINTENANCE] 🔄 Démarrage de la procédure...");

    // Configuration des Backups
    const BACKUP_DIR = path.join(__dirname, "backups");
    const RETENTION_LIMIT = 5; // Nombre de backups conservés localement
    const BACKUP_CHANNEL_ID = config.channels.backups;

    // 1. Nettoyage de la BDD (Suppression logs > 365 jours)
    const deleted = db.pruneLogs(365);
    console.log(`[NETTOYAGE] ${deleted} anciens logs supprimés.`);

    // 2. Préparation des chemins
    const dbPath = path.join(__dirname, "data.db");
    const timestamp = Date.now();
    const fileName = `backup-${timestamp}.db`;
    const backupPath = path.join(BACKUP_DIR, fileName);

    // Création du dossier backups s'il n'existe pas
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }

    try {
      // --- ÉTAPE A : COPIE DU FICHIER ---
      await fs.promises.copyFile(dbPath, backupPath);
      console.log(`[BACKUP] ✅ Copie locale réussie : ${fileName}`);

      // --- ÉTAPE B : ENVOI SUR DISCORD ---
      if (!BACKUP_CHANNEL_ID || BACKUP_CHANNEL_ID === "ID_DU_SALON") {
        console.warn(
          "[BACKUP] ⚠️ Envoi annulé : Aucun ID de salon défini dans config.json.",
        );
      } else {
        const channel = await client.channels
          .fetch(BACKUP_CHANNEL_ID)
          .catch(() => null);

        if (channel) {
          const file = new AttachmentBuilder(backupPath, { name: fileName });
          await channel.send({
            content: `💾 **Sauvegarde Hebdomadaire**\n📅 <t:${Math.floor(timestamp / 1000)}:f>\n🧹 Logs purgés : ${deleted}`,
            files: [file],
          });
          console.log("[BACKUP] 📤 Sauvegarde envoyée sur Discord.");
        } else {
          console.warn(
            "[BACKUP] ⚠️ Salon de backup introuvable ou inaccessible (Vérifie l'ID).",
          );
        }
      }

      // --- ÉTAPE C : ROTATION (Suppression des vieux backups) ---
      const files = await fs.promises.readdir(BACKUP_DIR);

      // On récupère les stats (date de modif) pour chaque fichier .db
      const fileStats = await Promise.all(
        files
          .filter((f) => f.endsWith(".db"))
          .map(async (f) => {
            const stats = await fs.promises.stat(path.join(BACKUP_DIR, f));
            return { name: f, time: stats.mtime.getTime() };
          }),
      );

      fileStats.sort((a, b) => b.time - a.time);

      // Si on dépasse la limite, on supprime les vieux fichiers
      if (fileStats.length > RETENTION_LIMIT) {
        const filesToDelete = fileStats.slice(RETENTION_LIMIT);
        for (const file of filesToDelete) {
          await fs.promises.unlink(path.join(BACKUP_DIR, file.name));
          console.log(
            `[BACKUP] Suppression ancienne sauvegarde : ${file.name}`,
          );
        }
      }
    } catch (error) {
      console.error("[MAINTENANCE] Erreur critique :", error);
    }
  });
}

client.login(config.token);
