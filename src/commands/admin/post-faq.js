const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  MessageFlags,
} = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("post-faq")
    .setDescription("ADMIN: Poste la FAQ officielle du bot dans ce salon")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const NANTES_COLOR = 0x00a650; 

    const faqEmbed = new EmbedBuilder()
      .setColor(NANTES_COLOR)
      .setTitle("🤖 FAQ Officielle : Fonctionnement de NaoBot")
      .setDescription(
        "Bienvenue ! Voici tout ce qu'il faut savoir sur le système d'activité et vos données sur ce serveur.",
      )
      .addFields(
        {
          name: "📈 Comment gagner des points ?",
          value:
            "Participez naturellement ! Chaque **message**, **réaction** ou **fichier partagé** vous rapporte des points. Un système anti-spam veille à ce que l'activité reste authentique.",
        },
        {
          name: "🏆 Membre du Mois",
          value:
            "Le 1er de chaque mois, le membre le plus actif du mois précédent reçoit le rôle **Membre du Mois** et une mise en avant automatique dans le salon d'annonces !",
        },
        {
          name: "💤 Gestion de l'inactivité",
          value:
            "Après **90 jours** sans aucune activité, le bot vous attribue le rôle **Inactif**. Il suffit de renvoyer un message pour redevenir actif !",
        },
        {
          name: "🛡️ Vie Privée & RGPD",
          value:
            "Nous ne stockons pas le contenu de vos messages. Si vous quittez le serveur, toutes vos données sont **supprimées instantanément**. Utilisez `/privacy` pour gérer votre suivi.",
        },
        {
          name: "⌨️ Commandes utiles",
          value:
            "• `/stats` : Voir votre score.\n• `/top` : Voir le classement.\n• `/privacy` : Activer/Désactiver le suivi.\n• `/help` : Obtenir de l'aide sur les commandes.",
        },
      )
      .setFooter({
        text: `Posté par le staff • ${interaction.guild.name}`,
        iconURL: interaction.guild.iconURL(),
      })
      .setTimestamp();

    // On envoie l'embed dans le salon actuel
    await interaction.channel.send({ embeds: [faqEmbed] });

    // On répond à l'admin de manière éphémère pour confirmer
    await interaction.reply({
      content: "✅ La FAQ a été postée avec succès dans ce salon !",
      flags: MessageFlags.Ephemeral,
    });
  },
};
