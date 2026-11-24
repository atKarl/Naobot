const {
  SlashCommandBuilder,
  InteractionContextType,
  EmbedBuilder,
  escapeMarkdown,
} = require("discord.js");
const db = require("../../database");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("top")
    .setDescription("Affiche le classement des 10 membres les plus actifs")
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    // Utiliser le système de pondération pour cohérence avec le membre du mois
    // On récupère tous les logs depuis le début (timestamp 0 jusqu'à maintenant)
    const topUsers = db.getTopUsersWithWeights(0, Date.now(), 10);

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
      .filter((id) => !interaction.guild.members.cache.has(id));

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

      const member = interaction.guild.members.cache.get(u.user_id);
      const displayName = member ? member.displayName : u.username;
      const cleanName = escapeMarkdown(displayName);

      return `${rankEmoji} **${cleanName}** — \`${u.score} pts\``;
    });

    embed.setDescription(descriptionLines.join("\n"));

    await interaction.editReply({ embeds: [embed] });
  },
};
