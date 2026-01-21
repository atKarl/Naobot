const {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  escapeMarkdown,
} = require("discord.js");
const db = require("../../database");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("stats")
    .setDescription(
      "Affiche vos statistiques d'activité ou celles d'un autre membre",
    )
    .addUserOption((option) =>
      option
        .setName("target")
        .setDescription("L'utilisateur à vérifier (Optionnel)")
        .setRequired(false),
    ),

  async execute(interaction) {
    const targetUser =
      interaction.options.getUser("target") || interaction.user;
    const stats = db.getUserStats(targetUser.id);
    const isSelf = targetUser.id === interaction.user.id;
    const isOptOut = stats.tracking === 0;

    const embed = new EmbedBuilder()
      .setColor(0x0099ff)
      .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }));

    // Si l'utilisateur cible a désactivé le suivi (Opt-out)
    if (isOptOut && !isSelf) {
      embed
        .setTitle(`Statistiques de ${targetUser.username}`)
        .setDescription(
          "🛑 **Cet utilisateur a désactivé le suivi d'activité.**\nSes statistiques sont privées.",
        )
        .setFooter({ text: "Respect de la vie privée" });

      return interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral,
      });
    }

    // Utilisation des Timestamps dynamiques Discord
    // <t:X:f> = Date complète, <t:X:R> = Temps relatif ("il y a X jours")
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
          value: `**${stats.count}** actions`,
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
  },
};
