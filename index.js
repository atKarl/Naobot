const fs = require("fs");
const path = require("path");
const {
  Client,
  GatewayIntentBits,
  Events,
  Collection,
  EmbedBuilder,
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
      ephemeral: true,
    };
    if (interaction.replied || interaction.deferred)
      await interaction.followUp(errPayload);
    else await interaction.reply(errPayload);
  }
});

// Tracking des Messages
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
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
    config.cooldown
  );
});

// Tracking des Réactions
client.on(Events.MessageReactionAdd, async (reaction, user) => {
  if (user.bot) return;
  if (reaction.partial)
    try {
      await reaction.fetch();
    } catch (e) {
      return;
    }

  if (
    config.ignoredChannels &&
    config.ignoredChannels.includes(reaction.message.channel.id)
  )
    return;

  db.logActivity(user.id, user.username, "reaction", config.cooldown);
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
            // Le membre a quitté le serveur
            continue;
          }
        }

        if (member.roles.cache.has(config.roles.inactive)) continue;

        await member.roles.add(config.roles.inactive);
        console.log(`[INACTIVITÉ] +Rôle pour ${member.user.tag}`);

        // Pause pour éviter les Rate Limits de Discord
        await sleep(1000);
      } catch (err) {
        console.error(
          `Erreur traitement user ${userData.user_id}:`,
          err.message
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
      1
    ).getTime();
    const endOfLastMonth = new Date(
      now.getFullYear(),
      now.getMonth(),
      0,
      23,
      59,
      59
    ).getTime();

    const winnerData = db.getTopUserByPeriod(startOfLastMonth, endOfLastMonth);
    if (!winnerData) return console.log("Aucune activité.");

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
            .setDescription(`Bravo <@${winnerData.user_id}> !`)
            .addFields({
              name: "Score",
              value: `${winnerData.score} pts`,
              inline: true,
            })
            .setTimestamp();
          await channel.send({ embeds: [embed] });
        }
      } catch (e) {
        console.log("Gagnant parti du serveur.");
      }
    } catch (err) {
      console.error(err);
    }
  });

  // Tâche 3 : Nettoyage BDD (Tous les dimanches à 4h00)
  cron.schedule("0 4 * * 0", () => {
    const deleted = db.pruneLogs(365);
    console.log(`[NETTOYAGE] ${deleted} logs supprimés.`);
  });
}

client.login(config.token);
