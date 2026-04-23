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

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const dbList = db.getInactiveUsersList(days);

    if (dbList.length === 0) {
      return interaction.editReply({
        content: `✅ Aucune inactivité détectée depuis ${days} jours selon la base de données.`,
      });
    }

    let currentMembers;
    try {
      currentMembers = await interaction.guild.members.fetch();
    } catch (error) {
      console.error("Erreur lors du fetch des membres:", error);
      return interaction.editReply(
        "❌ Erreur technique lors de la récupération des membres Discord.",
      );
    }

    const verifiedList = dbList.filter((u) => {
      const member = currentMembers.get(u.user_id);
      return member && !member.user.bot;
    });

    if (verifiedList.length === 0) {
      return interaction.editReply({
        content: `✅ Après vérification, tous les membres inactifs de la base de données ont déjà quitté le serveur.`,
      });
    }

    let fileContent = `=== RAPPORT D'INACTIVITÉ ===\n`;
    fileContent += `Serveur : ${interaction.guild.name}\n`;
    fileContent += `Date du rapport : ${new Date().toLocaleString("fr-FR")}\n`;
    fileContent += `Critère : Aucune activité depuis ${days} jours\n`;
    fileContent += `Membres trouvés (Présents sur le serveur) : ${verifiedList.length}\n`;
    fileContent += `----------------------------------------------------\n\n`;

    verifiedList.forEach((u) => {
      const dateStr = new Date(u.last_active_timestamp).toLocaleDateString("fr-FR");
      const member = currentMembers.get(u.user_id);

      if (!member) return; // Sécurité si le membre vient de partir

      const globalUsername = member.user.username; 
      
      const serverName = member.displayName; 

      const formattedName = (serverName.toLowerCase() !== globalUsername.toLowerCase())
        ? `${serverName} (@${globalUsername})`
        : globalUsername;

      fileContent += `[Dernière vue : ${dateStr}] ${formattedName} (ID: ${u.user_id})\n`;
    });

    fileContent += `\n----------------------------------------------------\n`;
    fileContent += `Fin du rapport.`;

    // Création du fichier
    const buffer = Buffer.from(fileContent, "utf-8");
    const attachment = new AttachmentBuilder(buffer, {
      name: `inactifs_${days}jours.txt`,
    });

    await interaction.editReply({
      content: `✅ **Rapport généré avec succès !**\nVoici la liste des **${verifiedList.length}** membres réellement présents sur le serveur et inactifs.`,
      files: [attachment],
    });
  },
};
