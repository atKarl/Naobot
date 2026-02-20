const {
  SlashCommandBuilder,
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
    .addUserOption((opt) =>
      opt.setName("membre").setDescription("Le membre").setRequired(true),
    )
    .addIntegerOption((opt) =>
      opt.setName("jour").setDescription("Jour (1-31)").setRequired(true),
    )
    .addIntegerOption((opt) =>
      opt.setName("mois").setDescription("Mois (1-12)").setRequired(true),
    ),

  async execute(interaction) {
    const targetUser = interaction.options.getUser("membre");
    const day = interaction.options.getInteger("jour");
    const month = interaction.options.getInteger("mois");

    if (targetUser.bot)
      return interaction.reply({
        content: "❌ Pas pour les bots.",
        flags: MessageFlags.Ephemeral,
      });
    if (!isValidDate(day, month))
      return interaction.reply({
        content: "❌ Date invalide.",
        flags: MessageFlags.Ephemeral,
      });

    const stats = db.getUserStats(targetUser.id);
    if (stats.tracking === 0)
      return interaction.reply({
        content: "🛑 Ce membre a désactivé le suivi (Opt-out).",
        flags: MessageFlags.Ephemeral,
      });

    let displayName = targetUser.username;
    try {
      const member = await interaction.guild.members.fetch(targetUser.id);
      displayName = member.displayName;
    } catch (_) {}

    db.setBirthday(targetUser.id, displayName, day, month);
    await refreshBirthdayMessage(interaction.guild);

    return interaction.reply({
      content: `✅ Anniversaire de **${displayName}** défini au **${day} ${MONTH_NAMES_CAP[month]}**.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
