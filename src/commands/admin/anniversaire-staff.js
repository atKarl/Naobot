const {
  SlashCommandBuilder,
  InteractionContextType,
  PermissionFlagsBits,
  MessageFlags,
} = require("discord.js");
const db = require("../../database");
const {
  isValidDate,
  refreshBirthdayMessage,
  MONTH_NAMES_CAP,
} = require("../../utils/birthday");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("anniversaire-staff")
    .setDescription("ADMIN: Définir l'anniversaire d'un membre")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addUserOption((opt) =>
      opt.setName("membre").setDescription("Le membre").setRequired(true),
    )
    .addIntegerOption((opt) =>
      opt
        .setName("jour")
        .setDescription("Jour (1-31)")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(31),
    )
    .addIntegerOption((opt) =>
      opt
        .setName("mois")
        .setDescription("Mois (1-12)")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(12),
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const targetUser = interaction.options.getUser("membre");
    const day = interaction.options.getInteger("jour");
    const month = interaction.options.getInteger("mois");

    if (targetUser.bot)
      return interaction.editReply({
        content: "❌ Pas pour les bots.",
      });
    if (!isValidDate(day, month))
      return interaction.editReply({
        content: "❌ Date invalide.",
      });

    const stats = db.getUserStats(targetUser.id);
    if (stats.tracking === 0)
      return interaction.editReply({
        content: "🛑 Ce membre a désactivé le suivi (Opt-out).",
      });

    let displayName = targetUser.username;
    try {
      const member = await interaction.guild.members.fetch(targetUser.id);
      displayName = member.displayName;
    } catch (_) {}

    db.setBirthday(targetUser.id, displayName, day, month);
    await refreshBirthdayMessage(interaction.guild);

    return interaction.editReply({
      content: `✅ Anniversaire de **${displayName}** défini au **${day} ${MONTH_NAMES_CAP[month]}**.`,
    });
  },
};
