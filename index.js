const fs = require("fs");
const path = require("path");
const {
  Client,
  GatewayIntentBits,
  Events,
  Collection,
  EmbedBuilder,
  Partials,
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
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
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
      { name: "/help pour avoir de l'aide", type: ActivityType.Watching },
    ],
    status: "online",
  });
  console.log(`⏱️ Cooldown anti-spam : ${config.cooldown / 1000}s`);
  initCronJobs();

  // Rafraîchissement de la liste des anniversaires au démarrage.
  // Délai de 3s pour s'assurer que le cache des membres est chargé.
  setTimeout(async () => {
    try {
      const guild = c.guilds.cache.get(config.guildId);
      if (guild) {
        const { refreshBirthdayMessage } = require("./src/utils/birthday");
        await refreshBirthdayMessage(guild);
        console.log(
          "[ANNIVERSAIRES] ✅ Liste persistante rafraîchie au démarrage.",
        );
      }
    } catch (err) {
      console.error("[ANNIVERSAIRES] Erreur au démarrage :", err.message);
    }
  }, 3000);
});

// Gestion des interactions (Commandes Slash)
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
  if (message.author.bot || !message.guild) return;

  // Retrait immédiat du rôle Inactif si présent
  if (message.member?.roles.cache.has(config.roles.inactive)) {
    try {
      await message.member.roles.remove(config.roles.inactive);
      console.log(`[RÉVEIL] Rôle inactif retiré à ${message.author.tag}`);
    } catch (err) {
      console.error(
        `Impossible de retirer le rôle inactif à ${message.author.tag} :`,
        err.message,
      );
    }
  }

  if (config.ignoredChannels?.includes(message.channel.id)) return;

  const type = message.attachments.size > 0 ? "file" : "message";
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

  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch (e) {
      return;
    }
  }

  if (reaction.message.guild) {
    try {
      const member = await reaction.message.guild.members.fetch(user.id);
      if (member.roles.cache.has(config.roles.inactive)) {
        await member.roles.remove(config.roles.inactive);
        console.log(
          `[RÉVEIL] Rôle inactif retiré via réaction pour ${user.tag}`,
        );
      }
    } catch (_) {
      /* Membre parti */
    }
  }

  if (config.ignoredChannels?.includes(reaction.message.channel.id)) return;

  db.logActivity(user.id, user.username, "reaction", config.cooldown);
});

// Gestion des Départs : suppression données + anniversaire + mise à jour liste
client.on(Events.GuildMemberRemove, async (member) => {
  if (member.user.bot) return;

  db.removeUserData(member.id);

  // Mise à jour de la liste persistante des anniversaires
  try {
    const { refreshBirthdayMessage } = require("./src/utils/birthday");
    await refreshBirthdayMessage(member.guild);
  } catch (err) {
    console.error(
      "[ANNIVERSAIRES] Erreur rafraîchissement après départ :",
      err.message,
    );
  }
});

// --- TÂCHES AUTOMATIQUES (CRON) ---

function initCronJobs() {
  console.log("📅 Tâches Cron initialisées.");

  // Tâche 1 : Vérification d'Inactivité (Minuit)
  cron.schedule("0 0 * * *", async () => {
    console.log("[CRON] Vérification d'inactivité...");
    const guild = client.guilds.cache.get(config.guildId);
    if (!guild) return;

    const inactiveUsers = db.getInactiveUsers(90);
    if (inactiveUsers.length === 0) return;

    console.log(`[CRON] ${inactiveUsers.length} utilisateurs à traiter.`);
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    for (const userData of inactiveUsers) {
      try {
        let member = guild.members.cache.get(userData.user_id);
        if (!member) {
          try {
            member = await guild.members.fetch(userData.user_id);
          } catch (e) {
            continue;
          }
        }

        if (member.roles.cache.has(config.roles.inactive)) continue;

        await member.roles.add(config.roles.inactive);
        console.log(`[INACTIVITÉ] +Rôle pour ${member.user.tag}`);
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
      const role = await guild.roles.fetch(config.roles.activeOfMonth);
      if (role) {
        for (const [, member] of role.members) {
          await member.roles.remove(role);
        }
      }

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

  // Tâche 3 : Maintenance Hebdomadaire (Dimanche à 04h00)
  cron.schedule("0 4 * * 0", async () => {
    console.log("[MAINTENANCE] 🔄 Démarrage de la procédure...");

    const BACKUP_DIR = path.join(__dirname, "backups");
    const RETENTION_LIMIT = 5;
    const BACKUP_CHANNEL_ID = config.channels.backups;

    const deleted = db.pruneLogs(365);
    console.log(`[NETTOYAGE] ${deleted} anciens logs supprimés.`);

    const dbPath = path.join(__dirname, "data.db");
    const timestamp = Date.now();
    const fileName = `backup-${timestamp}.db`;
    const backupPath = path.join(BACKUP_DIR, fileName);

    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }

    try {
      await db.createBackup(backupPath);
      console.log(`[BACKUP] ✅ Copie locale réussie : ${fileName}`);

      if (!BACKUP_CHANNEL_ID || BACKUP_CHANNEL_ID === "ID_DU_SALON") {
        console.warn("[BACKUP] ⚠️ Envoi annulé : Aucun ID de salon défini.");
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
          console.warn("[BACKUP] ⚠️ Salon de backup introuvable.");
        }
      }

      const files = await fs.promises.readdir(BACKUP_DIR);
      const fileStats = await Promise.all(
        files
          .filter((f) => f.endsWith(".db"))
          .map(async (f) => {
            const stats = await fs.promises.stat(path.join(BACKUP_DIR, f));
            return { name: f, time: stats.mtime.getTime() };
          }),
      );

      fileStats.sort((a, b) => b.time - a.time);

      if (fileStats.length > RETENTION_LIMIT) {
        const toDelete = fileStats.slice(RETENTION_LIMIT);
        for (const file of toDelete) {
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

  // ----------------------------------------------------------------
  // Tâche 4 : Annonces d'Anniversaires — Tous les jours à 09h00
  // ----------------------------------------------------------------
  cron.schedule(
    "0 9 * * *",
    async () => {
      console.log(" Vérification des anniversaires du jour...");

      const guild = client.guilds.cache.get(config.guildId);
      if (!guild) return;

      const now = new Date();
      const day = now.getDate();
      const month = now.getMonth() + 1;
      const year = now.getFullYear();

      let todayBirthdays = db.getTodayBirthdays(day, month);

      // --- FIX EDGE CASE 29 FÉVRIER ---
      const isLeapYear = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

      // Si on est le 28 février d'une année normale, on intègre les natifs du 29
      if (day === 28 && month === 2 && !isLeapYear(year)) {
        const leapBirthdays = db.getTodayBirthdays(29, 2);
        todayBirthdays = todayBirthdays.concat(leapBirthdays);
      }

      if (todayBirthdays.length === 0) {
        console.log("[CRON] Aucun anniversaire aujourd'hui.");
        return;
      }

      const channel = guild.channels.cache.get(config.channels.announcement);
      if (!channel) {
        console.warn(
          "[ANNIVERSAIRES] Salon d'annonces introuvable :",
          config.channels.announcement,
        );
        return;
      }

      // Construction des mentions @pseudo
      const mentions = todayBirthdays.map((u) => `<@${u.user_id}>`).join(", ");
      const plural = todayBirthdays.length > 1;

      await channel.send(
        `🎉🎂 Joyeux anniversaire ${mentions} !\n` +
          `Le serveur entier ${plural ? "vous souhaite" : "te souhaite"} une merveilleuse journée ! 🥳`,
      );

      console.log(
        `[CRON] Annonce anniversaire envoyée pour : ${todayBirthdays.map((u) => u.username).join(", ")}`,
      );
    },
    {
      timezone: "Europe/Paris",
    },
  );
}

client.login(config.token);
