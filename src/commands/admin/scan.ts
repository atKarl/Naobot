import {
  SlashCommandBuilder,
  InteractionContextType,
  PermissionFlagsBits,
  MessageFlags,
  ChannelType,
} from "discord.js";
import type {
  ChatInputCommandInteraction,
  FetchMessagesOptions,
  GuildBasedChannel,
  GuildTextBasedChannel,
} from "discord.js";
import { updateBatch } from "../../database.ts";
import { config } from "../../config.ts";
import type { BatchMessageEntry } from "../../types.ts";

let isScanning = false;

const SCANNABLE_TYPES = new Set<ChannelType>([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
  ChannelType.AnnouncementThread,
  ChannelType.GuildVoice,
]);

export const data = new SlashCommandBuilder()
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
  .setContexts(InteractionContextType.Guild);

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<unknown> {
  if (!interaction.guild) return;

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({
      content: "⛔ Réservé aux membres du staff.",
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
    const guild = interaction.guild;
    const days = interaction.options.getInteger("jours", true);
    const limitDate = Date.now() - days * 24 * 60 * 60 * 1000;

    await interaction.deferReply();

    let tokenExpired = false;
    async function safeUpdate(content: string): Promise<unknown> {
      if (!tokenExpired) {
        try {
          return await interaction.editReply(content);
        } catch (err) {
          const code =
            typeof err === "object" && err !== null && "code" in err
              ? err.code
              : undefined;
          // 50027 = token d'interaction expiré (> 15 min) : repli sur channel.send
          if (code !== 50027) throw err;
          tokenExpired = true;
        }
      }
      if (interaction.channel?.isSendable()) {
        return interaction.channel.send(content).catch(() => {});
      }
      return undefined;
    }

    await safeUpdate(
      `🔄 **Deep Scan initialisé** (${days} jours)...\nRécupération de la liste des salons...`,
    );

    const ignoredChannels = config.ignoredChannels;
    const allChannels = new Map<string, GuildTextBasedChannel>();
    try {
      const [channelsCollection, activeThreads] = await Promise.all([
        guild.channels.fetch(),
        guild.channels.fetchActiveThreads().catch(() => null),
      ]);

      const addIfScannable = (c: GuildBasedChannel | null): void => {
        if (!c || !SCANNABLE_TYPES.has(c.type) || !c.isTextBased()) return;
        const isIgnored =
          ignoredChannels.includes(c.id) ||
          (c.isThread() &&
            c.parentId !== null &&
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
    } catch {
      return safeUpdate("❌ Erreur lors de la récupération des salons.");
    }

    const me = guild.members.me;
    if (!me) {
      return safeUpdate(
        "❌ Impossible de vérifier les permissions du bot sur ce serveur.",
      );
    }

    const sleep = (ms: number): Promise<void> =>
      new Promise((r) => setTimeout(r, ms));
    console.log(`[SCAN] Démarrage sur ${allChannels.size} canaux.`);

    await safeUpdate(
      `🔄 **Deep Scan en cours**\n📂 ${allChannels.size} salons à analyser sur ${days} jours.`,
    );

    let totalMessages = 0;
    let channelsProcessed = 0;

    for (const [, channel] of allChannels) {
      let lastMessageId: string | null = null;
      let keepScanning = true;

      const perms = channel.permissionsFor(me);
      if (
        !perms?.has([
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.ReadMessageHistory,
        ])
      ) {
        channelsProcessed++;
        continue;
      }

      while (keepScanning) {
        try {
          const options: FetchMessagesOptions = { limit: 100 };
          if (lastMessageId) options.before = lastMessageId;

          const messages = await channel.messages.fetch(options);

          if (messages.size === 0) {
            keepScanning = false;
            break;
          }

          const batchData: BatchMessageEntry[] = [];

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
            updateBatch(batchData);
          }

          const lastMsg = messages.last();
          if (!lastMsg) {
            keepScanning = false;
            break;
          }
          lastMessageId = lastMsg.id;

          await sleep(600);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(
            `[SCAN] Erreur critique sur le salon ${channel.name}: ${message}`,
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
}
