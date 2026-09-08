const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  ChannelType,
} = require("discord.js");
const db = require("../../database");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("scan")
    .setDescription("ADMIN: Scanne l'historique des salons")
    .addIntegerOption((option) =>
      option
        .setName("jours")
        .setDescription("Nombre de jours à scanner - 365 max")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(365),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    if (
      !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)
    ) {
      return interaction.reply({
        content: "⛔ Réservé aux membres du staff.",
        flags: MessageFlags.Ephemeral,
      });
    }

    if (typeof db.updateBatch !== "function") {
      return interaction.reply({
        content: "⛔ Erreur critique : fonction `updateBatch` manquante.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const days = interaction.options.getInteger("jours");
    const limitDate = Date.now() - days * 24 * 60 * 60 * 1000;

    await interaction.deferReply();
    await interaction.editReply(
      `🔄 **Deep Scan initialisé** (${days} jours)...\nRécupération de la liste des salons...`,
    );

    // Récupération de tous les types de salons textuels pertinents
    let allChannels;
    try {
      const channelsCollection = await interaction.guild.channels.fetch();
      allChannels = channelsCollection.filter(
        (c) =>
          c.type === ChannelType.GuildText ||
          c.type === ChannelType.GuildAnnouncement ||
          c.type === ChannelType.PublicThread ||
          c.type === ChannelType.PrivateThread ||
          c.type === ChannelType.GuildVoice,
      );
    } catch (e) {
      return interaction.editReply(
        "❌ Erreur lors de la récupération des salons.",
      );
    }

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    console.log(`[SCAN] Démarrage sur ${allChannels.size} canaux.`);

    await interaction.editReply(
      `🔄 **Deep Scan en cours**\n📂 ${allChannels.size} salons à analyser sur ${days} jours.`,
    );

    let totalMessages = 0;
    let channelsProcessed = 0;

    // --- Boucle sur chaque salon ---
    for (const [channelId, channel] of allChannels) {
      let lastMessageId = null;
      let keepScanning = true;

      // Skip si le bot n'a pas la permission de voir le salon
      if (!channel.viewable) {
        channelsProcessed++;
        continue;
      }

      // Boucle de pagination des messages
      while (keepScanning) {
        try {
          const options = { limit: 100 };
          if (lastMessageId) options.before = lastMessageId;

          const messages = await channel.messages.fetch(options);

          if (messages.size === 0) {
            keepScanning = false;
            break;
          }

          const batchData = [];

          for (const msg of messages.values()) {
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
          }

          if (batchData.length > 0) {
            db.updateBatch(batchData);
          }

          lastMessageId = messages.last().id;

          await sleep(600);
        } catch (err) {
          console.error(
            `[SCAN] Erreur critique sur le salon ${channel.name}: ${err.message}`,
          );
          keepScanning = false;
          break;
        }
      }

      channelsProcessed++;

      if (channelsProcessed % 5 === 0) {
        await interaction.editReply(
          `🔄 **Scan en cours...**\n📊 Progression : ${channelsProcessed}/${allChannels.size} salons.\n📨 Messages indexés : ${totalMessages}`,
        );
      }
    }

    await interaction.editReply(
      `✅ **Deep Scan Terminé !**\n\n📅 Période : ${days} jours\n📨 Total indexé : ${totalMessages} messages\n📚 Salons scannés : ${channelsProcessed}`,
    );
  },
};