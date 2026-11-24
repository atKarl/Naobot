const {
  SlashCommandBuilder,
  InteractionContextType,
  PermissionFlagsBits,
  MessageFlags,
  ChannelType,
} = require("discord.js");
const db = require("../../database");
const config = require("../../../config.json");

let isScanning = false;

const SCANNABLE_TYPES = new Set([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
  ChannelType.AnnouncementThread,
  ChannelType.GuildVoice,
]);

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
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild),

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

    if (isScanning) {
      return interaction.reply({
        content:
          "⏳ Un scan est déjà en cours. Merci d'attendre qu'il se termine.",
        flags: MessageFlags.Ephemeral,
      });
    }

    isScanning = true;
    try {
      const days = interaction.options.getInteger("jours");
      const limitDate = Date.now() - days * 24 * 60 * 60 * 1000;

      await interaction.deferReply();

      let tokenExpired = false;
      async function safeUpdate(content) {
        if (!tokenExpired) {
          try {
            return await interaction.editReply(content);
          } catch (err) {
            if (err.code !== 50027) throw err;
            tokenExpired = true;
          }
        }
        return interaction.channel?.send(content).catch(() => {});
      }

      await safeUpdate(
        `🔄 **Deep Scan initialisé** (${days} jours)...\nRécupération de la liste des salons...`,
      );

      // Récupération de tous les types de salons textuels pertinents et des fils actifs
      const ignoredChannels = config.ignoredChannels ?? [];
      const allChannels = new Map();
      try {
        const [channelsCollection, activeThreads] = await Promise.all([
          interaction.guild.channels.fetch(),
          interaction.guild.channels.fetchActiveThreads().catch(() => null),
        ]);

        const addIfScannable = (c) => {
          if (!c || !SCANNABLE_TYPES.has(c.type)) return;
          const isIgnored =
            ignoredChannels.includes(c.id) ||
            (c.isThread?.() &&
              c.parentId &&
              ignoredChannels.includes(c.parentId));
          if (!isIgnored) {
            allChannels.set(c.id, c);
          }
        };

        for (const channel of channelsCollection.values()) {
          addIfScannable(channel);
        }
        if (activeThreads?.threads) {
          for (const thread of activeThreads.threads.values()) {
            addIfScannable(thread);
          }
        }
      } catch (e) {
        return safeUpdate("❌ Erreur lors de la récupération des salons.");
      }

      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      console.log(`[SCAN] Démarrage sur ${allChannels.size} canaux.`);

      await safeUpdate(
        `🔄 **Deep Scan en cours**\n📂 ${allChannels.size} salons à analyser sur ${days} jours.`,
      );

      let totalMessages = 0;
      let channelsProcessed = 0;

      // --- Boucle sur chaque salon ---
      for (const [, channel] of allChannels) {
        let lastMessageId = null;
        let keepScanning = true;

        // Skip si le bot n'a pas les permissions requises sur le salon
        const perms = channel.permissionsFor(interaction.guild.members.me);
        if (
          !perms?.has([
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.ReadMessageHistory,
          ])
        ) {
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
          await safeUpdate(
            `🔄 **Scan en cours...**\n📊 Progression : ${channelsProcessed}/${allChannels.size} salons.\n📨 Messages indexés : ${totalMessages}`,
          );
        }
      }

      await safeUpdate(
        `✅ **Deep Scan Terminé !**\n\n📅 Période : ${days} jours\n📨 Total indexé : ${totalMessages} messages\n📚 Salons scannés : ${channelsProcessed}`,
      );
    } finally {
      isScanning = false;
    }
  },
};