const {
  SlashCommandBuilder,
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
    .addUserOption((opt) =>
      opt
        .setName("membre")
        .setDescription("Le membre dont il faut supprimer l'anniversaire")
        .setRequired(true),
    ),

  async execute(interaction) {
    const targetUser = interaction.options.getUser("membre");

    const deleted = db.deleteBirthday(targetUser.id);

    if (deleted === 0) {
      return interaction.reply({
        content: `ℹ️ **${targetUser.username}** n'a aucun anniversaire enregistré dans la base de données.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // Mise à jour automatique du message persistant sur le serveur
    await refreshBirthdayMessage(interaction.guild);

    return interaction.reply({
      content: `🗑️ L'anniversaire de **${targetUser.username}** a été supprimé avec succès.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
