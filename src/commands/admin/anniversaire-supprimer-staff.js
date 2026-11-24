const {
  SlashCommandBuilder,
  InteractionContextType,
  PermissionFlagsBits,
  MessageFlags,
} = require("discord.js");
const db = require("../../database");
const { refreshBirthdayMessage } = require("../../utils/birthday");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("anniversaire-supprimer-staff")
    .setDescription("ADMIN: Supprime l'anniversaire d'un autre membre")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addUserOption((opt) =>
      opt
        .setName("membre")
        .setDescription("Le membre dont il faut supprimer l'anniversaire")
        .setRequired(true),
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const targetUser = interaction.options.getUser("membre");

    const deleted = db.deleteBirthday(targetUser.id);

    if (deleted === 0) {
      return interaction.editReply({
        content: `ℹ️ **${targetUser.username}** n'a aucun anniversaire enregistré dans la base de données.`,
      });
    }

    // Mise à jour automatique du message persistant sur le serveur
    await refreshBirthdayMessage(interaction.guild);

    return interaction.editReply({
      content: `🗑️ L'anniversaire de **${targetUser.username}** a été supprimé avec succès.`,
    });
  },
};
