const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const db = require("../../database");
const { isValidDate, refreshBirthdayMessage, MONTH_NAMES_CAP } = require("../../utils/birthday");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("anniversaire")
    .setDescription("Enregistre ta date d'anniversaire")
    .addIntegerOption((opt) =>
      opt.setName("jour").setDescription("Ton jour (1-31)").setRequired(true).setMinValue(1).setMaxValue(31)
    )
    .addIntegerOption((opt) =>
      opt.setName("mois").setDescription("Ton mois (1-12)").setRequired(true).setMinValue(1).setMaxValue(12)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const day = interaction.options.getInteger("jour");
    const month = interaction.options.getInteger("mois");
    const user = interaction.user;

    if (!isValidDate(day, month)) {
      return interaction.editReply({
        content: `❌ Date invalide (${day}/${month}).`,
      });
    }

    const stats = db.getUserStats(user.id);
    if (stats.tracking === 0) {
      return interaction.editReply({
        content: "🛑 Active ton suivi (`/privacy optin`) pour utiliser cette fonction.",
      });
    }

    db.setBirthday(user.id, user.username, day, month);
    await refreshBirthdayMessage(interaction.guild);

    return interaction.editReply({
      content: `✅ Anniversaire enregistré : **${day} ${MONTH_NAMES_CAP[month]}**.`,
    });
  },
};