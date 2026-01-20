const {
  SlashCommandBuilder,
  PermissionsBitField,
  MessageFlags,
  ChannelType,
} = require("discord.js");
const db = require("../../database");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("scan")
    .setDescription(
      "ADMIN: Scanne l'historique des salons pour remplir la base de données"
    )
    .addIntegerOption((option) =>
      option
        .setName("jours")
        .setDescription("Combien de jours en arrière scanner ?")
        .setRequired(true)
    ),

  async execute(interaction) {
    // 1. Sécurité
    if (
      !interaction.member.permissions.has(
        PermissionsBitField.Flags.Administrator
      )
    ) {
      return interaction.reply({
        content: "⛔ Réservé aux administrateurs.",
        flags: MessageFlags.Ephemeral,
      });
    }

    if (typeof db.updateBatch !== "function") {
      return interaction.reply({
        content: "⛔ Erreur: `updateBatch` introuvable dans database.js.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const days = interaction.options.getInteger("jours");
    const limitDate = Date.now() - days * 24 * 60 * 60 * 1000;

    await interaction.deferReply();
    await interaction.editReply(
      `🔄 **Deep Scan initialisé** (${days} jours)...\nRécupération de la liste des salons...`
    );

    // 2. Récupération ROBUSTE des salons (API > Cache)
    let allChannels;
    try {
      const channelsCollection = await interaction.guild.channels.fetch();

      // Filtrage étendu (Text, Thread, Announcement, VoiceText)
      allChannels = channelsCollection.filter(
        (c) =>
          c.type === ChannelType.GuildText ||
          c.type === ChannelType.GuildAnnouncement || // <-- AJOUTÉ
          c.type === ChannelType.PublicThread ||
          c.type === ChannelType.PrivateThread ||
          c.type === ChannelType.GuildVoice // <-- AJOUTÉ (Text in Voice)
      );
    } catch (e) {
      return interaction.editReply(
        "❌ Erreur lors de la récupération des salons via l'API."
      );
    }

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    console.log(`[SCAN] Démarrage sur ${allChannels.size} canaux.`);

    await interaction.editReply(
      `🔄 **Deep Scan en cours**\n📂 ${allChannels.size} salons à analyser sur ${days} jours.`
    );

    let totalMessages = 0;
    let channelsProcessed = 0;

    // --- BOUCLE ---
    for (const [channelId, channel] of allChannels) {
      let lastMessageId = null;
      let keepScanning = true;
      let channelMsgCount = 0;

      // Skip si le bot ne peut pas voir le salon
      if (!channel.viewable) {
        channelsProcessed++;
        continue;
      }

      try {
        while (keepScanning) {
          const options = { limit: 100 };
          if (lastMessageId) options.before = lastMessageId;

          const messages = await channel.messages.fetch(options);

          if (messages.size === 0) {
            keepScanning = false;
            break;
          }

          const batchData = [];

          for (const msg of messages.values()) {
            // Arrêt si hors délai
            if (msg.createdTimestamp < limitDate) {
              keepScanning = false;
              break;
            }

            if (msg.author.bot) continue;

            batchData.push({
              userId: msg.author.id,
              username: msg.author.username,
              ts: msg.createdTimestamp,
            });

            totalMessages++;
            channelMsgCount++;
          }

          if (batchData.length > 0) {
            db.updateBatch(batchData);
          }

          lastMessageId = messages.last().id;

          // Anti-Rate Limit
          await sleep(600);
        }
      } catch (err) {
        console.log(`[SCAN] Erreur salon ${channel.name}: ${err.message}`);
      }

      channelsProcessed++;

      // Feedback visuel tous les 5 salons pour ne pas spammer l'API
      if (channelsProcessed % 5 === 0) {
        await interaction.editReply(
          `🔄 **Scan en cours...**\n📊 Progression : ${channelsProcessed}/${allChannels.size} salons.\n📨 Messages indexés : ${totalMessages}`
        );
      }
    }

    await interaction.editReply(
      `✅ **Deep Scan Terminé !**\n\n📅 Période : ${days} jours\n📨 Total indexé : ${totalMessages} messages\n📚 Salons scannés : ${channelsProcessed}`
    );
  },
};
