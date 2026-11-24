import {
  SlashCommandBuilder,
  InteractionContextType,
  EmbedBuilder,
  escapeMarkdown,
} from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";
import { getTopUsersWithWeights } from "../../database.ts";

export const data = new SlashCommandBuilder()
  .setName("top")
  .setDescription("Affiche le classement des 10 membres les plus actifs")
  .setContexts(InteractionContextType.Guild);

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<unknown> {
  if (!interaction.guild) return;

  // Pondération identique à Membre du Mois, sur tout l'historique
  const topUsers = getTopUsersWithWeights(0, Date.now(), 10);

  const embed = new EmbedBuilder()
    .setColor(0xffd700)
    .setTitle("🏆 Classement Global")
    .setTimestamp()
    .setFooter({ text: "Classement basé sur les messages et réactions" });

  if (topUsers.length === 0) {
    embed.setDescription("Aucune donnée d'activité pour le moment.");
    return interaction.reply({ embeds: [embed] });
  }

  await interaction.deferReply();

  const missingIds = topUsers
    .map((u) => u.user_id)
    .filter((id) => !interaction.guild!.members.cache.has(id));

  if (missingIds.length > 0) {
    await interaction.guild.members
      .fetch({ user: missingIds })
      .catch(() => {});
  }

  const descriptionLines = topUsers.map((u, index) => {
    let rankEmoji = `**${index + 1}.**`;
    if (index === 0) rankEmoji = "🥇";
    if (index === 1) rankEmoji = "🥈";
    if (index === 2) rankEmoji = "🥉";

    const member = interaction.guild!.members.cache.get(u.user_id);
    const displayName = member ? member.displayName : u.username;
    const cleanName = escapeMarkdown(displayName);

    return `${rankEmoji} **${cleanName}** — \`${u.score} pts\``;
  });

  embed.setDescription(descriptionLines.join("\n"));

  await interaction.editReply({ embeds: [embed] });
}
