const {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("Guide du serveur : Points, Rangs et Vie Privée"),

  async execute(interaction) {
    const THEME_COLOR = 0x00a650;

    const embed = new EmbedBuilder()
      .setColor(THEME_COLOR)
      .setTitle("🔰 Guide NaoBot")
      .setDescription(
        `Bonjour ${interaction.user} ! Je suis le bot qui anime la communauté. Voici comment je fonctionne :`,
      )
      .addFields(
        {
          name: "📈 Système de Points",
          value: `Gagnez des points en participant :\n• **Messages** : Discutez dans les salons publics.\n• **Réactions** : Réagissez aux messages.\n\n*Anti-spam actif : Les messages trop rapides ne comptent pas.*`,
        },
        {
          name: "🏆 Membre du Mois",
          value: `Le **1er de chaque mois**, le membre le plus actif du mois précédent reçoit un rôle exclusif et une mise en avant !`,
        },
        {
          name: "🛡️ Vie Privée & RGPD",
          value: `• Vos données servent uniquement aux statistiques.\n• **Si vous quittez le serveur**, tout est supprimé instantanément.\n• Commande \`/privacy\` pour activer/désactiver votre suivi.`,
        },
        {
          name: "🤖 Commandes",
          value: `\`/stats\` : Voir vos points.\n\`/top\` : Voir le classement.\n\`/halloffame\` : Voir l'historique des membres du mois.\n\`/privacy\` : Gérer vos données.\n\`/anniversaire\` : Ajouter votre date d'anniversaire au calendrier du serveur.\n\`/anniversaire-supprimer\` : Supprimer votre anniversaire de la liste.\n\`/help\` : Afficher ce guide.`,
        },
      )
      .setFooter({
        text: "NaoBot • Guide du serveur",
        iconURL: interaction.guild.iconURL(),
      })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
