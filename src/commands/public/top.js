const {
  SlashCommandBuilder,
  EmbedBuilder,
  escapeMarkdown,
} = require("discord.js");
const db = require("../../database");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("top")
    .setDescription("Affiche le classement des 10 membres les plus actifs"),

  async execute(interaction) {
    const topUsers = db.getTopUsers(10);

    const embed = new EmbedBuilder()
      .setColor(0xffd700)
      .setTitle("🏆 Classement Global")
      .setTimestamp()
      .setFooter({ text: "Classement basé sur les messages et réactions" });

    if (topUsers.length === 0) {
      embed.setDescription("Aucune donnée d'activité pour le moment.");
      return interaction.reply({ embeds: [embed] });
    }

    const description = topUsers
      .map((u, index) => {
        let rankEmoji = `**${index + 1}.**`;
        if (index === 0) rankEmoji = "🥇";
        if (index === 1) rankEmoji = "🥈";
        if (index === 2) rankEmoji = "🥉";

        // Nettoyage du pseudo pour éviter que les caractères spéciaux ne cassent l'affichage
        const cleanUsername = escapeMarkdown(u.username);

        return `${rankEmoji} **${cleanUsername}** — \`${u.score} pts\``;
      })
      .join("\n");

    embed.setDescription(description);

    await interaction.reply({ embeds: [embed] });
  },
};
