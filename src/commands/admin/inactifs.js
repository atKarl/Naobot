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
        .setRequired(true)
    ),

  async execute(interaction) {
    // 1. Vérification Sécurité (Admin uniquement)
    if (
      !interaction.member.permissions.has(
        PermissionsBitField.Flags.Administrator
      )
    ) {
      return interaction.reply({
        content: "⛔ Cette commande est réservée aux administrateurs.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const days = interaction.options.getInteger("jours");

    // 2. Récupération des données (Liste complète sans limite)
    const list = db.getInactiveUsersList(days);

    if (list.length === 0) {
      return interaction.reply({
        content: `✅ Aucune inactivité détectée depuis ${days} jours. Tout le monde est actif !`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // 3. Construction du contenu du fichier texte
    let fileContent = `=== RAPPORT D'INACTIVITÉ ===\n`;
    fileContent += `Serveur : ${interaction.guild.name}\n`;
    fileContent += `Date du rapport : ${new Date().toLocaleString("fr-FR")}\n`;
    fileContent += `Critère : Aucune activité depuis ${days} jours\n`;
    fileContent += `Nombre total de membres trouvés : ${list.length}\n`;
    fileContent += `----------------------------------------------------\n\n`;

    list.forEach((u) => {
      // Conversion du timestamp en date lisible
      const dateStr = new Date(u.last_active_timestamp).toLocaleDateString(
        "fr-FR"
      );

      // Format de la ligne : [JJ/MM/AAAA] Pseudo (ID Discord)
      // On gère le cas où le pseudo serait null dans la DB
      const safeUsername = u.username || "Pseudo Inconnu";
      fileContent += `[Dernière vue : ${dateStr}] ${safeUsername} (ID: ${u.user_id})\n`;
    });

    fileContent += `\n----------------------------------------------------\n`;
    fileContent += `Fin du rapport.`;

    // 4. Création du fichier en mémoire (Buffer)
    const buffer = Buffer.from(fileContent, "utf-8");
    const attachment = new AttachmentBuilder(buffer, {
      name: `inactifs_${days}jours.txt`,
    });

    // 5. Envoi de la réponse avec le fichier
    await interaction.reply({
      content: `✅ **Rapport généré avec succès !**\nVoici la liste complète des ${list.length} membres inactifs sous forme de fichier texte.`,
      files: [attachment],
      flags: MessageFlags.Ephemeral, // Visible uniquement par vous
    });
  },
};
