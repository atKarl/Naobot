import fs from "node:fs";
import path from "node:path";
import {
  Client,
  GatewayIntentBits,
  Events,
  EmbedBuilder,
  Partials,
  AttachmentBuilder,
  ActivityType,
  MessageFlags,
} from "discord.js";
import type { GuildMember } from "discord.js";
import cron from "node-cron";
import type { TaskOptions } from "node-cron";
import { config } from "./src/config.ts";
import * as db from "./src/database.ts";
import { loadCommands } from "./src/commands/loader.ts";
import { refreshBirthdayMessage } from "./src/utils/birthday.ts";
import {
  handleNewSortieThread,
  handleSortieButton,
  handleSortieModalSubmit,
  createDateInParisTime,
} from "./src/utils/sorties.ts";
import type { WinnerCandidate } from "./src/types.ts";

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const INACTIVITY_DAYS = config.inactivityDays;

db.initDb();

process.on("unhandledRejection", (reason) => {
  console.error("❌ [ANTI-CRASH] Promesse non gérée (unhandledRejection) :");
  console.error(reason);
});

process.on("uncaughtExceptionMonitor", (error, origin) => {
  console.error("❌ [ANTI-CRASH] Exception surveillée :", error, origin);
});

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

let isShuttingDown = false;

async function shutdown(signal: string, exitCode = 0): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`🛑 Arrêt du bot (${signal})...`);

  const forceExitTimer = setTimeout(() => {
    console.error("⏱️ Timeout lors de l'arrêt propre, sortie forcée.");
    process.exit(exitCode || 1);
  }, 5000);
  forceExitTimer.unref();

  try {
    cron.getTasks().forEach((task) => task.stop());
    await client.destroy();
  } catch (err) {
    console.error("Erreur lors de l'arrêt du client Discord :", err);
  } finally {
    clearTimeout(forceExitTimer);
    try {
      db.closeDb();
    } catch (err) {
      console.error("Erreur lors de la fermeture SQLite :", err);
    }
    process.exit(exitCode);
  }
}

process.on("SIGINT", () => {
  void shutdown("SIGINT", 0);
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM", 0);
});
process.on("uncaughtException", (error) => {
  console.error(
    "❌ [ANTI-CRASH] Exception non interceptée (uncaughtException) :",
  );
  console.error(error);
  void shutdown("uncaughtException", 1);
});

// --- CHARGEMENT DES COMMANDES ---
const commands = await loadCommands();

// --- ÉVÉNEMENTS DISCORD ---

client.on(Events.Error, (error) => {
  console.error("❌ [DISCORD ERROR] Erreur de passerelle / client :", error);
});

client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Prêt ! Connecté en tant que ${c.user.tag}`);
  c.user.setPresence({
    activities: [
      { name: "/help pour avoir de l'aide", type: ActivityType.Watching },
    ],
    status: "online",
  });
  console.log(`⏱️ Cooldown anti-spam : ${config.cooldown / 1000}s`);
  initCronJobs();

  // Rafraîchissement de la liste des anniversaires au démarrage
  try {
    const guild = c.guilds.cache.get(config.guildId);
    if (guild) {
      await refreshBirthdayMessage(guild);
      console.log(
        "[ANNIVERSAIRES] ✅ Liste persistante rafraîchie au démarrage.",
      );
    }
  } catch (err) {
    console.error("[ANNIVERSAIRES] Erreur au démarrage :", getErrorMessage(err));
  }
});

// Gestion des interactions (Commandes Slash, Boutons, Modals)
client.on(Events.InteractionCreate, async (interaction) => {
  const errPayload = {
    content: "Une erreur interne est survenue.",
    flags: MessageFlags.Ephemeral,
  } as const;

  // 1. Boutons du module Sorties
  if (interaction.isButton() && interaction.customId.startsWith("sortie_")) {
    try {
      await handleSortieButton(interaction);
    } catch (error) {
      console.error("Erreur Bouton Sortie:", error);
      try {
        if (interaction.replied) await interaction.followUp(errPayload);
        else if (interaction.deferred)
          await interaction.editReply({ content: errPayload.content });
        else await interaction.reply(errPayload);
      } catch {}
    }
    return;
  }

  // 2. Modals du module Sorties
  if (
    interaction.isModalSubmit() &&
    interaction.customId.startsWith("modal_sortie_")
  ) {
    try {
      await handleSortieModalSubmit(interaction);
    } catch (error) {
      console.error("Erreur Modal Sortie:", error);
      try {
        if (interaction.replied) await interaction.followUp(errPayload);
        else if (interaction.deferred)
          await interaction.editReply({ content: errPayload.content });
        else await interaction.reply(errPayload);
      } catch {}
    }
    return;
  }

  // 3. Commandes Slash
  if (!interaction.isChatInputCommand()) return;
  const command = commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`Erreur Commande ${interaction.commandName}:`, error);
    if (interaction.replied || interaction.deferred)
      await interaction.followUp(errPayload);
    else await interaction.reply(errPayload);
  }
});

// Tracking des Messages
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.guild) return;

  // Retrait immédiat du rôle Inactif si présent
  if (
    config.roles.inactive &&
    message.member?.roles.cache.has(config.roles.inactive)
  ) {
    try {
      await message.member.roles.remove(config.roles.inactive);
      console.log(`[RÉVEIL] Rôle inactif retiré à ${message.author.tag}`);
    } catch (err) {
      console.error(
        `Impossible de retirer le rôle inactif à ${message.author.tag} :`,
        getErrorMessage(err),
      );
    }
  }

  if (config.ignoredChannels.includes(message.channel.id)) return;

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
    } catch {
      return;
    }
  }

  if (!reaction.message.guild) return;

  if (config.roles.inactive) {
    try {
      const member = await reaction.message.guild.members.fetch(user.id);
      if (member.roles.cache.has(config.roles.inactive)) {
        await member.roles.remove(config.roles.inactive);
        console.log(
          `[RÉVEIL] Rôle inactif retiré via réaction pour ${user.tag ?? user.id}`,
        );
      }
    } catch (err) {
      console.error(
        `[RÉVEIL] Erreur fetch membre ${user.id}:`,
        getErrorMessage(err),
      );
    }
  }

  if (config.ignoredChannels.includes(reaction.message.channel.id)) return;

  db.logActivity(
    user.id,
    user.username ?? "Inconnu",
    "reaction",
    config.cooldown,
  );
});

// Gestion des Départs : suppression données + anniversaire + mise à jour liste
client.on(Events.GuildMemberRemove, async (member) => {
  if (member.user.bot) return;

  db.removeUserData(member.id);

  // Mise à jour de la liste persistante des anniversaires
  try {
    await refreshBirthdayMessage(member.guild);
  } catch (err) {
    console.error(
      "[ANNIVERSAIRES] Erreur rafraîchissement après départ :",
      getErrorMessage(err),
    );
  }
});

// Détection du retrait manuel du rôle Inactif (réinitialise le cooldown d'inactivité)
client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  const inactiveRoleId = config.roles.inactive;
  if (!inactiveRoleId) return;

  const hadRole = oldMember.roles.cache.has(inactiveRoleId);
  const hasRole = newMember.roles.cache.has(inactiveRoleId);

  // Détecte si le rôle vient d'être retiré
  if (hadRole && !hasRole) {
    db.resetUserInactivity(newMember.id, newMember.user.username);
    console.log(
      `[INACTIVITÉ] Rôle inactif retiré pour ${newMember.user.tag}. Cooldown de ${INACTIVITY_DAYS} jours réinitialisé.`,
    );
  }
});

// Détection des nouvelles sorties dans le salon Forum
client.on(Events.ThreadCreate, async (thread, newlyCreated) => {
  if (!newlyCreated) return;

  // On vérifie que le thread est bien dans le salon forum des sorties
  if (
    config.channels.sortiesForum &&
    thread.parentId === config.channels.sortiesForum
  ) {
    // Petit délai de 1 sec pour s'assurer que Discord a bien finalisé la création du fil
    setTimeout(() => {
      void handleNewSortieThread(thread);
    }, 1000);
  }
});

// --- TÂCHES AUTOMATIQUES (CRON) ---

const CRON_OPTIONS: TaskOptions = {
  timezone: "Europe/Paris",
  noOverlap: true,
};

function getParisDateParts(date = new Date()): {
  year: number;
  month: number;
  day: number;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
  };
}

function initCronJobs(): void {
  console.log("📅 Tâches Cron initialisées.");

  // Tâche 1 : Vérification d'Inactivité (Minuit)
  cron.schedule(
    "0 0 * * *",
    async () => {
      console.log("[CRON] Vérification d'inactivité...");
      const guild = client.guilds.cache.get(config.guildId);
      if (!guild) return;
      const inactiveRoleId = config.roles.inactive;
      if (!inactiveRoleId) return;

      const inactiveUsers = db.getInactiveUsers(INACTIVITY_DAYS);
      if (inactiveUsers.length === 0) return;

      console.log(`[CRON] ${inactiveUsers.length} utilisateurs à traiter.`);
      const sleep = (ms: number): Promise<void> =>
        new Promise((r) => setTimeout(r, ms));

      for (const userData of inactiveUsers) {
        try {
          let member = guild.members.cache.get(userData.user_id);
          if (!member) {
            try {
              member = await guild.members.fetch(userData.user_id);
            } catch {
              continue;
            }
          }

          if (member.roles.cache.has(inactiveRoleId)) continue;

          await member.roles.add(inactiveRoleId);
          console.log(`[INACTIVITÉ] +Rôle pour ${member.user.tag}`);
          await sleep(1000);
        } catch (err) {
          console.error(
            `Erreur traitement user ${userData.user_id}:`,
            getErrorMessage(err),
          );
        }
      }
      console.log("[CRON] Traitement inactivité terminé.");
    },
    CRON_OPTIONS,
  );

  // Tâche 2 : Membre du Mois (1er du mois à minuit)
  cron.schedule(
    "0 0 1 * *",
    async () => {
      console.log("[MEMBRE DU MOIS] Calcul en cours...");
      const guild = client.guilds.cache.get(config.guildId);
      if (!guild) return;

      const { year: currentYear, month: currentMonth } = getParisDateParts();
      const lastMonth = currentMonth === 1 ? 12 : currentMonth - 1;
      const lastMonthYear = currentMonth === 1 ? currentYear - 1 : currentYear;

      const startOfLastMonth = createDateInParisTime(
        1,
        lastMonth - 1,
        lastMonthYear,
        0,
        0,
      ).getTime();
      const startOfCurrentMonth = createDateInParisTime(
        1,
        currentMonth - 1,
        currentYear,
        0,
        0,
      ).getTime();
      const endOfLastMonth = startOfCurrentMonth - 1;

      // Calculer le top 10 avec malus
      const candidates = db.calculateWinnerWithPenalty(
        startOfLastMonth,
        endOfLastMonth,
        lastMonth, // Mois 1-12
        lastMonthYear,
      );

      if (candidates.length === 0) {
        console.log("[MEMBRE DU MOIS] Aucune activité ce mois-ci.");
        return;
      }

      console.log(`[MEMBRE DU MOIS] Top 3 candidats :`);
      candidates.slice(0, 3).forEach((c, i) => {
        const penaltyText =
          c.penalty > 0 ? ` (malus -${c.penalty * 100}%)` : "";
        console.log(
          `  ${i + 1}. ${c.username}: ${c.rawScore} pts → ${c.adjustedScore} pts${penaltyText}`,
        );
      });

      // Trouver le premier candidat encore sur le serveur
      let winner: WinnerCandidate | null = null;
      let winnerMember: GuildMember | null = null;

      for (const candidate of candidates) {
        try {
          const member = await guild.members.fetch(candidate.user_id);
          winner = candidate;
          winnerMember = member;
          console.log(
            `[MEMBRE DU MOIS] Gagnant trouvé : ${candidate.username}`,
          );
          break;
        } catch {
          console.log(
            `[MEMBRE DU MOIS] ${candidate.username} a quitté le serveur, passage au suivant...`,
          );
        }
      }

      if (!winner || !winnerMember) {
        console.log(
          "[MEMBRE DU MOIS] Aucun gagnant disponible (tous ont quitté).",
        );
        return;
      }

      try {
        await guild.members.fetch();

        const activeRoleId = config.roles.activeOfMonth;
        if (activeRoleId) {
          // Retirer le rôle aux anciens gagnants
          const role = await guild.roles.fetch(activeRoleId);
          if (role) {
            for (const [, member] of role.members) {
              await member.roles.remove(role);
            }
          }

          // Attribuer le rôle au nouveau gagnant
          await winnerMember.roles.add(activeRoleId);
        }

        // Sauvegarder dans l'historique
        db.saveMonthWinner(
          winner.user_id,
          winner.username,
          lastMonth,
          lastMonthYear,
          winner.adjustedScore,
        );

        // Envoyer l'annonce
        const announcementChannelId = config.channels.announcement;
        const channel = announcementChannelId
          ? guild.channels.cache.get(announcementChannelId)
          : undefined;
        if (channel?.isSendable()) {
          const embed = new EmbedBuilder()
            .setColor(0xe91e63)
            .setTitle("🎉 Membre du Mois !")
            .setDescription(
              `Bravo <@${winner.user_id}> qui a été le plus actif le mois dernier !`,
            )
            .addFields({
              name: "Score",
              value: `${winner.adjustedScore} points`,
              inline: true,
            })
            .setTimestamp();
          await channel.send({ embeds: [embed] });
        }

        console.log(
          `[MEMBRE DU MOIS] ✅ ${winner.username} est le nouveau membre du mois !`,
        );
      } catch (err) {
        console.error("[MEMBRE DU MOIS] Erreur :", err);
      }
    },
    CRON_OPTIONS,
  );

  // Tâche 3 : Maintenance Hebdomadaire (Dimanche à 04h00)
  cron.schedule(
    "0 4 * * 0",
    async () => {
      console.log("[MAINTENANCE] 🔄 Démarrage de la procédure...");

      const BACKUP_DIR = path.join(import.meta.dirname, "backups");
      const RETENTION_LIMIT = 5;

      const deleted = db.pruneLogs(365);
      console.log(`[NETTOYAGE] ${deleted} anciens logs supprimés.`);

      const timestamp = Date.now();
      const fileName = `backup-${timestamp}.db`;
      const backupPath = path.join(BACKUP_DIR, fileName);

      if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
      }

      try {
        await db.createBackup(backupPath);
        console.log(`[BACKUP LOCAL] ✅ Copie réussie : ${fileName}`);

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
              `[BACKUP LOCAL] Suppression ancienne sauvegarde : ${file.name}`,
            );
          }
        }
      } catch (error) {
        console.error("[MAINTENANCE] Erreur critique :", error);
      }
    },
    CRON_OPTIONS,
  );

  // Tâche 4 : Backup Discord Mensuel (15 du mois à 04h00)
  cron.schedule(
    "0 4 15 * *",
    async () => {
      console.log("[BACKUP DISCORD] 🔄 Démarrage...");

      const BACKUP_DIR = path.join(import.meta.dirname, "backups");
      const BACKUP_CHANNEL_ID = config.channels.backups;

      if (!BACKUP_CHANNEL_ID || BACKUP_CHANNEL_ID === "ID_DU_SALON") {
        console.warn("[BACKUP DISCORD] ⚠️ Aucun ID de salon défini.");
        return;
      }

      const timestamp = Date.now();
      const fileName = `backup-${timestamp}.db`;
      const backupPath = path.join(BACKUP_DIR, fileName);

      if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
      }

      try {
        await db.createBackup(backupPath);
        console.log(`[BACKUP DISCORD] ✅ Fichier créé : ${fileName}`);

        const channel = await client.channels
          .fetch(BACKUP_CHANNEL_ID)
          .catch(() => null);

        if (channel?.isSendable()) {
          const file = new AttachmentBuilder(backupPath, { name: fileName });
          await channel.send({
            content: `💾 **Sauvegarde Mensuelle**\n📅 <t:${Math.floor(timestamp / 1000)}:f>`,
            files: [file],
          });
          console.log("[BACKUP DISCORD] 📤 Envoyé avec succès.");
        } else {
          console.warn("[BACKUP DISCORD] ⚠️ Salon introuvable.");
        }
      } catch (error) {
        console.error("[BACKUP DISCORD] Erreur :", error);
      } finally {
        try {
          await fs.promises.unlink(backupPath);
          console.log("[BACKUP DISCORD] 🗑️ Fichier temporaire supprimé.");
        } catch (unlinkErr) {
          const code =
            typeof unlinkErr === "object" &&
            unlinkErr !== null &&
            "code" in unlinkErr
              ? unlinkErr.code
              : undefined;
          if (code !== "ENOENT") {
            console.error(
              "[BACKUP DISCORD] Impossible de supprimer le fichier temporaire :",
              unlinkErr,
            );
          }
        }
      }
    },
    CRON_OPTIONS,
  );

  // ----------------------------------------------------------------
  // Tâche 5 : Annonces d'Anniversaires — Tous les jours à 09h00
  // ----------------------------------------------------------------
  cron.schedule(
    "0 9 * * *",
    async () => {
      try {
        console.log("[CRON] Vérification des anniversaires du jour...");

        const guild = client.guilds.cache.get(config.guildId);
        if (!guild) return;

        const { day, month, year } = getParisDateParts();

        let todayBirthdays = db.getTodayBirthdays(day, month);

        // --- FIX EDGE CASE 29 FÉVRIER ---
        const isLeapYear = (y: number): boolean =>
          (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

        // Si on est le 28 février d'une année normale, on intègre les natifs du 29
        if (day === 28 && month === 2 && !isLeapYear(year)) {
          const leapBirthdays = db.getTodayBirthdays(29, 2);
          todayBirthdays = todayBirthdays.concat(leapBirthdays);
        }

        if (todayBirthdays.length === 0) {
          console.log("[CRON] Aucun anniversaire aujourd'hui.");
          return;
        }

        const announcementChannelId = config.channels.announcement;
        const channel = announcementChannelId
          ? guild.channels.cache.get(announcementChannelId)
          : undefined;
        if (!channel?.isSendable()) {
          console.warn(
            "[CRON] Salon d'annonces introuvable :",
            announcementChannelId,
          );
          return;
        }

        // Construction des mentions @pseudo
        const mentions = todayBirthdays
          .map((u) => `<@${u.user_id}>`)
          .join(", ");
        const plural = todayBirthdays.length > 1;

        await channel.send(
          `🎉🎂 Joyeux anniversaire ${mentions} !\n` +
            `Le serveur entier ${plural ? "vous souhaite" : "te souhaite"} une merveilleuse journée ! 🥳`,
        );

        console.log(
          `[CRON] Annonce anniversaire envoyée pour : ${todayBirthdays.map((u) => u.username).join(", ")}`,
        );
      } catch (err) {
        console.error("[CRON] Erreur annonces anniversaires :", err);
      }
    },
    CRON_OPTIONS,
  );
}

void client.login(config.token);
