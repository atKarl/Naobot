const {
  SlashCommandBuilder,
  EmbedBuilder,
  escapeMarkdown,
} = require("discord.js");
const db = require("../../database");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("stats")
    .setDescription(
      "Affiche vos statistiques d'activité ou celles d'un autre membre"
    )
    .addUserOption((option) =>
      option
        .setName("target")
        .setDescription("L'utilisateur à vérifier (Optionnel)")
        .setRequired(false)
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

    // CAS 1 : L'utilisateur cible est en OPT-OUT et ce n'est pas moi
    // On protège sa vie privée, on ne montre rien.
    if (isOptOut && !isSelf) {
      embed
        .setTitle(`Statistiques de ${targetUser.username}`)
        .setDescription(
          "🛑 **Cet utilisateur a désactivé le suivi d'activité.**\nSes statistiques sont privées."
        )
        .setFooter({ text: "Respect de la vie privée (RGPD)" });

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // CAS 2 : Affichage normal (Moi-même ou utilisateur Opt-in)

    // Formatage Discord dynamique (s'adapte au fuseau horaire du lecteur)
    // <t:timestamp:f> donne "20 janvier 2026 15:30"
    // <t:timestamp:R> donne "il y a 2 heures"
    let lastActiveField = "Jamais";
    if (stats.lastActive) {
      const ts = Math.floor(stats.lastActive / 1000); // Discord veut des secondes
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
        { name: "🕒 Dernière vue", value: lastActiveField, inline: true }
      );

    // Si c'est moi et que je suis opt-out, on me prévient
    if (isOptOut && isSelf) {
      embed.setFooter({
        text: "⚠️ Vous êtes en mode 'Opt-out'. Vous seul voyez ceci.",
      });
    }

    // Si c'est pour moi-même, je peux le garder privé (ephemeral)
    // Sinon c'est public
    await interaction.reply({ embeds: [embed], ephemeral: isOptOut && isSelf });
  },
};
