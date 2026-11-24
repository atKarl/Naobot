import {
  SlashCommandBuilder,
  InteractionContextType,
  EmbedBuilder,
  MessageFlags,
  escapeMarkdown,
} from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";
import { getUserWeightedScore } from "../../database.ts";

export const data = new SlashCommandBuilder()
  .setName("stats")
  .setDescription(
    "Affiche vos statistiques d'activité ou celles d'un autre membre",
  )
  .setContexts(InteractionContextType.Guild)
  .addUserOption((option) =>
    option
      .setName("target")
      .setDescription("L'utilisateur à vérifier (Optionnel)")
      .setRequired(false),
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<unknown> {
  const targetUser = interaction.options.getUser("target") ?? interaction.user;

  if (targetUser.bot) {
    return interaction.reply({
      content: "🤖 Les bots ne sont pas suivis par le système d'activité.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const stats = getUserWeightedScore(targetUser.id);
  const isSelf = targetUser.id === interaction.user.id;
  const isOptOut = stats.tracking === 0;

  const embed = new EmbedBuilder()
    .setColor(0x0099ff)
    .setThumbnail(targetUser.displayAvatarURL());

  if (isOptOut && !isSelf) {
    embed
      .setTitle(`Statistiques de ${escapeMarkdown(targetUser.username)}`)
      .setDescription(
        "🛑 **Cet utilisateur a désactivé le suivi d'activité.**\nSes statistiques sont privées.",
      )
      .setFooter({ text: "Respect de la vie privée" });

    return interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
    });
  }

  let lastActiveField = "Jamais";
  if (stats.lastActive) {
    const ts = Math.floor(stats.lastActive / 1000);
    lastActiveField = `<t:${ts}:f> (<t:${ts}:R>)`;
  }

  embed
    .setTitle(`Statistiques de ${escapeMarkdown(targetUser.username)}`)
    .addFields(
      {
        name: "📊 Score d'activité",
        value: `**${stats.score}** points`,
        inline: true,
      },
      { name: "🕒 Dernière vue", value: lastActiveField, inline: true },
    );

  if (isOptOut && isSelf) {
    embed.setFooter({
      text: "⚠️ Vous êtes en mode 'Opt-out'. Vous seul voyez ceci.",
    });
  }

  await interaction.reply({
    embeds: [embed],
    flags: isOptOut && isSelf ? MessageFlags.Ephemeral : undefined,
  });
}
