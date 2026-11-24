import {
  SlashCommandBuilder,
  InteractionContextType,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";
import { getAllWinnersHistory } from "../../database.ts";

const MONTH_NAMES: readonly string[] = [
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
];

export const data = new SlashCommandBuilder()
  .setName("halloffame")
  .setDescription("Affiche l'historique des membres du mois")
  .setContexts(InteractionContextType.Guild);

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<unknown> {
  const history = getAllWinnersHistory();

  if (history.length === 0) {
    return interaction.reply({
      content: "📊 Aucun historique disponible pour le moment.",
      flags: MessageFlags.Ephemeral,
    });
  }

  // Limiter aux 12 derniers
  const recentHistory = history.slice(0, 12);

  const embed = new EmbedBuilder()
    .setColor(0xe91e63)
    .setTitle("🏆 Hall of Fame - Membres du Mois")
    .setDescription(
      recentHistory
        .map((entry) => {
          const monthName = MONTH_NAMES[entry.month - 1] ?? String(entry.month);
          return `**${monthName} ${entry.year}** : <@${entry.user_id}> (${entry.score} points)`;
        })
        .join("\n"),
    )
    .setFooter({
      text: `Total : ${history.length} membre(s) du mois depuis le début`,
    })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}
