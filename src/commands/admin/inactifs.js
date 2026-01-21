const {
  SlashCommandBuilder,
  PermissionsBitField,
  MessageFlags,
  AttachmentBuilder,
} = require("discord.js");
const db = require("../../database");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("inactifs")
    .setDescription("ADMIN: Génère un fichier rapport des membres inactifs")
    .addIntegerOption((option) =>
      option
        .setName("jours")
        .setDescription("Nombre de jours sans activité")
        .setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild),

  async execute(interaction) {
    if (
      !interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)
    ) {
      return interaction.reply({
        content: "⛔ Réservé aux membres du staff.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const days = interaction.options.getInteger("jours");

    // Récupération de la liste complète
    const list = db.getInactiveUsersList(days);

    if (list.length === 0) {
      return interaction.reply({
        content: `✅ Aucune inactivité détectée depuis ${days} jours. Tout le monde est actif !`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // Construction du contenu du fichier texte
    let fileContent = `=== RAPPORT D'INACTIVITÉ ===\n`;
    fileContent += `Serveur : ${interaction.guild.name}\n`;
    fileContent += `Date du rapport : ${new Date().toLocaleString("fr-FR")}\n`;
    fileContent += `Critère : Aucune activité depuis ${days} jours\n`;
    fileContent += `Nombre total de membres trouvés : ${list.length}\n`;
    fileContent += `----------------------------------------------------\n\n`;

    list.forEach((u) => {
      const dateStr = new Date(u.last_active_timestamp).toLocaleDateString(
        "fr-FR",
      );
      const safeUsername = u.username || "Pseudo Inconnu";
      fileContent += `[Dernière vue : ${dateStr}] ${safeUsername} (ID: ${u.user_id})\n`;
    });

    fileContent += `\n----------------------------------------------------\n`;
    fileContent += `Fin du rapport.`;

    // Création du fichier en mémoire (Buffer) pour l'envoi
    const buffer = Buffer.from(fileContent, "utf-8");
    const attachment = new AttachmentBuilder(buffer, {
      name: `inactifs_${days}jours.txt`,
    });

    await interaction.reply({
      content: `✅ **Rapport généré avec succès !**\nVoici la liste complète des ${list.length} membres inactifs.`,
      files: [attachment],
      flags: MessageFlags.Ephemeral,
    });
  },
};
