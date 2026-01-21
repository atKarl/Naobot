const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const db = require("../../database");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("privacy")
    .setDescription("Gérer vos préférences de tracking (RGPD)")
    .addSubcommand((sub) =>
      sub
        .setName("optout")
        .setDescription(
          "Désactiver le suivi (Vous n'apparaîtrez plus dans le classement)"
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("optin")
        .setDescription(
          "Réactiver le suivi (Vos nouvelles activités seront comptées)"
        )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    if (typeof db.setTrackingStatus !== "function") {
      return interaction.reply({
        content: "⚠️ Erreur technique : Fonction database manquante.",
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === "optout") {
      db.setTrackingStatus(userId, false);
      await interaction.reply({
        content:
          "✅ **Préférence enregistrée : Opt-Out.**\n\nVous ne serez plus comptabilisé dans les statistiques ni dans le classement.",
        flags: MessageFlags.Ephemeral,
      });
    } else if (sub === "optin") {
      db.setTrackingStatus(userId, true);
      await interaction.reply({
        content:
          "✅ **Préférence enregistrée : Opt-In.**\n\nLe bot recommence à compter votre activité à partir de maintenant.",
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};