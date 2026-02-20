const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const db = require("../../database");
const { refreshBirthdayMessage } = require("../../utils/birthday");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("anniversaire-supprimer")
    .setDescription("Supprime ton anniversaire de la liste"),

  async execute(interaction) {
    const deleted = db.deleteBirthday(interaction.user.id);

    if (deleted === 0) {
      return interaction.reply({
        content: "ℹ️ Tu n'avais pas d'anniversaire enregistré.",
        flags: MessageFlags.Ephemeral,
      });
    }

    await refreshBirthdayMessage(interaction.guild);

    return interaction.reply({
      content: "🗑️ Ton anniversaire a été supprimé.",
      flags: MessageFlags.Ephemeral,
    });
  },
};
