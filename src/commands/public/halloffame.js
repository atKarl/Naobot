const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const db = require("../../database");

const MONTH_NAMES = [
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

module.exports = {
  data: new SlashCommandBuilder()
    .setName("halloffame")
    .setDescription("Affiche l'historique des membres du mois"),

  async execute(interaction) {
    const history = db.getAllWinnersHistory();

    if (history.length === 0) {
      return interaction.reply({
        content: "📊 Aucun historique disponible pour le moment.",
        ephemeral: true,
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
            const monthName = MONTH_NAMES[entry.month - 1];
            return `**${monthName} ${entry.year}** : <@${entry.user_id}> (${entry.score} points)`;
          })
          .join("\n"),
      )
      .setFooter({
        text: `Total : ${history.length} membre(s) du mois depuis le début`,
      })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};
