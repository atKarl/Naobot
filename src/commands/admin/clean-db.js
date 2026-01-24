const {
  SlashCommandBuilder,
  PermissionsBitField,
  MessageFlags,
} = require("discord.js");
const db = require("../../database");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("clean-db")
    .setDescription(
      "ADMIN: Supprime de la DB les membres qui ont quitté le serveur (Nettoyage Fantômes)",
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild),

  async execute(interaction) {
    // Sécurité : Admin seulement
    if (
      !interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)
    ) {
      return interaction.reply({
        content: "⛔ Réservé au staff.",
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // 1. Récupération des données
    let discordMembers;
    try {
      discordMembers = await interaction.guild.members.fetch();
    } catch (e) {
      return interaction.editReply(
        "❌ Erreur critique : Impossible de récupérer la liste des membres Discord.",
      );
    }

    const dbUserIds = db.getAllUserIds();

    // 2. Identification des fantômes
    const ghosts = dbUserIds.filter((dbId) => !discordMembers.has(dbId));

    if (ghosts.length === 0) {
      return interaction.editReply(
        "✅ La base de données est déjà parfaitement synchronisée. Aucun fantôme trouvé.",
      );
    }

    await interaction.editReply(
      `🧹 **Nettoyage commencé...**\n👻 ${ghosts.length} utilisateurs fantômes détectés.\nSuppression en cours...`,
    );

    // 3. Suppression massive
    let deletedCount = 0;

    for (const userId of ghosts) {
      db.removeUserData(userId);
      deletedCount++;
    }

    await interaction.editReply(
      `✅ **Nettoyage Terminé !**\n🗑️ **${deletedCount}** profils supprimés de la base de données (car ils ne sont plus sur le serveur).`,
    );
  },
};
