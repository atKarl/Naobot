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

    // Construction de la liste
    // Utilisation de .map().join() plus propre que foreach +=
    const description = topUsers
      .map((u, index) => {
        let rankEmoji = `**${index + 1}.**`;
        if (index === 0) rankEmoji = "🥇";
        if (index === 1) rankEmoji = "🥈";
        if (index === 2) rankEmoji = "🥉";

        // IMPORTANT : escapeMarkdown empêche les pseudos comme "*Test*" de casser le gras
        const cleanUsername = escapeMarkdown(u.username);

        return `${rankEmoji} **${cleanUsername}** — \`${u.score} pts\``;
      })
      .join("\n");

    embed.setDescription(description);

    await interaction.reply({ embeds: [embed] });
  },
};
