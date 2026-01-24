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

    // Message d'attente car le fetch des membres peut être long
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // 2. Récupération de la liste brute depuis la DB
    const dbList = db.getInactiveUsersList(days);

    if (dbList.length === 0) {
      return interaction.editReply({
        content: `✅ Aucune inactivité détectée depuis ${days} jours selon la base de données.`,
      });
    }

    // 3. Récupération des membres ACTUELS du serveur Discord
    let currentMembers;
    try {
      // On force le chargement de tous les membres du serveur
      currentMembers = await interaction.guild.members.fetch();
    } catch (error) {
      console.error("Erreur lors du fetch des membres:", error);
      return interaction.editReply(
        "❌ Erreur technique lors de la récupération des membres Discord.",
      );
    }

    // 4. Filtrage : On ne garde que ceux qui sont dans la DB ET sur le serveur
    const verifiedList = dbList.filter((u) => {
      const member = currentMembers.get(u.user_id);
      return member && !member.user.bot;
    });

    if (verifiedList.length === 0) {
      return interaction.editReply({
        content: `✅ Après vérification, tous les membres inactifs de la base de données ont déjà quitté le serveur.`,
      });
    }

    // 5. Construction du contenu du fichier texte
    let fileContent = `=== RAPPORT D'INACTIVITÉ ===\n`;
    fileContent += `Serveur : ${interaction.guild.name}\n`;
    fileContent += `Date du rapport : ${new Date().toLocaleString("fr-FR")}\n`;
    fileContent += `Critère : Aucune activité depuis ${days} jours\n`;
    fileContent += `Membres trouvés (Présents sur le serveur) : ${verifiedList.length}\n`;
    fileContent += `----------------------------------------------------\n\n`;

    verifiedList.forEach((u) => {
      const dateStr = new Date(u.last_active_timestamp).toLocaleDateString(
        "fr-FR",
      );
      // On essaie de récupérer le pseudo actuel sur le serveur, sinon celui de la DB
      const member = currentMembers.get(u.user_id);
      const currentUsername = member ? member.user.username : u.username;

      fileContent += `[Dernière vue : ${dateStr}] ${currentUsername} (ID: ${u.user_id})\n`;
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
