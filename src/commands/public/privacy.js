const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const db = require("../../database");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("privacy")
    .setDescription("Gérer vos préférences de suivi d'activité")
    .addStringOption((option) =>
      option
        .setName("action")
        .setDescription("Choisissez d'activer ou de désactiver votre suivi")
        .setRequired(true)
        .addChoices(
          {
            name: "✅ Activer le suivi (Vos nouvelles activités seront comptées)",
            value: "optin",
          },
          {
            name: "❌ Désactiver le suivi (Vous n'apparaîtrez plus dans le classement)",
            value: "optout",
          },
        ),
    ),

  async execute(interaction) {
    const action = interaction.options.getString("action");
    const userId = interaction.user.id;

    // 1. On récupère l'état actuel en BDD
    const stats = db.getUserStats(userId);
    const currentTracking = stats.tracking; // 1 pour actif, 0 pour inactif

    // 2. Vérification : Est-ce que l'utilisateur demande son état actuel ?
    if (action === "optin" && currentTracking === 1) {
      return interaction.reply({
        content: "ℹ️ Votre suivi d'activité est **déjà activé**.",
        flags: MessageFlags.Ephemeral,
      });
    }

    if (action === "optout" && currentTracking === 0) {
      return interaction.reply({
        content: "ℹ️ Votre suivi d'activité est **déjà désactivé**.",
        flags: MessageFlags.Ephemeral,
      });
    }

    // 3. Si l'état est différent, on procède au changement
    if (action === "optin") {
      db.setTrackingStatus(userId, true);
      await interaction.reply({
        content:
          "✅ **Préférence mise à jour : Opt-In.**\n\nLe bot recommence à compter votre activité. Merci de votre confiance !",
        flags: MessageFlags.Ephemeral,
      });
    } else {
      db.setTrackingStatus(userId, false);
      await interaction.reply({
        content:
          "❌ **Préférence mise à jour : Opt-Out.**\n\nSuivi désactivé. Vos données ne sont plus enregistrées.",
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
