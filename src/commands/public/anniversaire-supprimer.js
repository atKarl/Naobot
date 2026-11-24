const {
  SlashCommandBuilder,
  InteractionContextType,
  MessageFlags,
} = require("discord.js");
const db = require("../../database");
const { refreshBirthdayMessage } = require("../../utils/birthday");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("anniversaire-supprimer")
    .setDescription("Supprime ton anniversaire de la liste")
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const deleted = db.deleteBirthday(interaction.user.id);

    if (deleted === 0) {
      return interaction.editReply({
        content: "ℹ️ Tu n'avais pas d'anniversaire enregistré.",
      });
    }

    await refreshBirthdayMessage(interaction.guild);

    return interaction.editReply({
      content: "🗑️ Ton anniversaire a été supprimé.",
    });
  },
};
