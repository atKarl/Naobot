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

    await interaction.deferReply();

    const descriptionLines = await Promise.all(
      topUsers.map(async (u, index) => {
        let rankEmoji = `**${index + 1}.**`;
        if (index === 0) rankEmoji = "🥇";
        if (index === 1) rankEmoji = "🥈";
        if (index === 2) rankEmoji = "🥉";

        let displayName = u.username;

        try {
          const member = await interaction.guild.members.fetch(u.user_id);
          displayName = member.displayName; // C'est le "Surnom" sur le serveur
        } catch (e) {
          // Si le membre a quitté le serveur, le fetch échoue.
          // On garde le u.username de la base de données dans ce cas.
        }

        // Nettoyage du pseudo pour éviter que les caractères spéciaux ne cassent l'affichage
        const cleanName = escapeMarkdown(displayName);

        return `${rankEmoji} **${cleanName}** — \`${u.score} pts\``;
      }),
    );

    embed.setDescription(descriptionLines.join("\n"));

    await interaction.editReply({ embeds: [embed] });
  },
};
