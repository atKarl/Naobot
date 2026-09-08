const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  GuildScheduledEventPrivacyLevel,
  GuildScheduledEventEntityType,
  PermissionFlagsBits,
  MessageFlags,
} = require("discord.js");

/**
 * Envoie le message d'assistance dans le nouveau fil de discussion
 */
async function handleNewSortieThread(thread) {
  try {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`sortie_create_${thread.id}`)
        .setLabel("📅 Ajouter au calendrier")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`sortie_dismiss_${thread.id}`)
        .setLabel("✕ Ignorer")
        .setStyle(ButtonStyle.Secondary),
    );

    await thread.send({
      content:
        `👋 Salut <@${thread.ownerId}> ! Super initiative pour cette sortie.\n` +
        `Souhaites-tu **l'inscrire au calendrier officiel** du serveur ? Les membres intéressés pourront s'y inscrire et recevoir une notification avant l'événement !`,
      components: [row],
    });
  } catch (error) {
    console.error("[SORTIES] Erreur lors de l'envoi du message d'assistance :", error);
  }
}

/**
 * Gère le clic sur les boutons d'une sortie
 */
async function handleSortieButton(interaction) {
  const [, action, threadId] = interaction.customId.split("_");
  const thread = interaction.guild.channels.cache.get(threadId);

  // Vérification de sécurité : Seul l'auteur du post ou le staff peut interagir
  const isAuthor = thread && interaction.user.id === thread.ownerId;
  const isStaff =
    interaction.member.permissions.has(PermissionFlagsBits.ManageEvents) ||
    interaction.member.permissions.has(PermissionFlagsBits.ManageGuild);

  if (!isAuthor && !isStaff) {
    return interaction.reply({
      content: "⛔ Seul l'organisateur de cette sortie ou un modérateur peut planifier cet événement.",
      flags: MessageFlags.Ephemeral,
    });
  }

  // 1. Action "Ignorer" -> Supprime le message du bot
  if (action === "dismiss") {
    await interaction.message.delete().catch(() => {});
    return;
  }

  // 2. Action "Créer" -> Ouvre le Modal (formulaire)
  if (action === "create") {
    const defaultTitle = thread ? thread.name.slice(0, 100) : "";

    const modal = new ModalBuilder()
      .setCustomId(`modal_sortie_${threadId}`)
      .setTitle("Ajouter la sortie au calendrier");

    const titleInput = new TextInputBuilder()
      .setCustomId("title")
      .setLabel("Titre de l'événement")
      .setStyle(TextInputStyle.Short)
      .setValue(defaultTitle)
      .setMaxLength(100)
      .setRequired(true);

    const dateInput = new TextInputBuilder()
      .setCustomId("date")
      .setLabel("Date et heure de début")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("JJ/MM/AAAA HH:mm (ex: 25/09 19:30)")
      .setMaxLength(20)
      .setRequired(true);

    const durationInput = new TextInputBuilder()
      .setCustomId("duration")
      .setLabel("Durée estimée (en heures)")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("ex: 2 (pour 2h) ou 3.5")
      .setValue("2")
      .setMaxLength(5)
      .setRequired(true);

    const locationInput = new TextInputBuilder()
      .setCustomId("location")
      .setLabel("Lieu du rendez-vous")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("ex: Cinéma Katorza, Parc de Procé, Bar Le KréGrand...")
      .setMaxLength(100)
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder().addComponents(titleInput),
      new ActionRowBuilder().addComponents(dateInput),
      new ActionRowBuilder().addComponents(durationInput),
      new ActionRowBuilder().addComponents(locationInput),
    );

    await interaction.showModal(modal);
  }
}

/**
 * Analyse une saisie de date en français (ex: "25/09 19:30" ou "25/09/2026 20h00")
 */
function parseFrenchDate(dateStr) {
  const match = dateStr.trim().match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\s+(\d{1,2})[h:](\d{2})$/i);
  if (!match) return null;

  const day = parseInt(match[1], 10);
  const month = parseInt(match[2], 10) - 1; // 0-11 en JS
  const year = match[3] ? parseInt(match[3], 10) : new Date().getFullYear();
  const hours = parseInt(match[4], 10);
  const minutes = parseInt(match[5], 10);

  const parsedDate = new Date(year, month, day, hours, minutes, 0);

  // Vérification de validité de la date (ex: éviter le 31 février)
  if (
    parsedDate.getDate() !== day ||
    parsedDate.getMonth() !== month ||
    isNaN(parsedDate.getTime())
  ) {
    return null;
  }

  return parsedDate;
}

/**
 * Traite la soumission du formulaire et crée l'événement Discord
 */
async function handleSortieModalSubmit(interaction) {
  const threadId = interaction.customId.replace("modal_sortie_", "");
  const thread = interaction.guild.channels.cache.get(threadId);

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const title = interaction.fields.getTextInputValue("title");
  const dateStr = interaction.fields.getTextInputValue("date");
  const durationStr = interaction.fields.getTextInputValue("duration");
  const location = interaction.fields.getTextInputValue("location");

  // 1. Validation de la date
  const startDate = parseFrenchDate(dateStr);
  if (!startDate) {
    return interaction.editReply(
      "❌ **Format de date invalide !**\nMerci d'utiliser le format : `JJ/MM HH:mm` (ex: `25/09 19:30` ou `25/09/2026 20h00`).",
    );
  }

  if (startDate.getTime() <= Date.now()) {
    return interaction.editReply("❌ **La date et l'heure doivent se situer dans le futur !**");
  }

  // 2. Validation de la durée
  const durationHours = parseFloat(durationStr.replace(",", "."));
  if (isNaN(durationHours) || durationHours <= 0 || durationHours > 72) {
    return interaction.editReply("❌ **Durée invalide !** Indiquez un nombre d'heures (ex: `2` ou `3.5`).");
  }

  const endDate = new Date(startDate.getTime() + durationHours * 60 * 60 * 1000);

  // 3. Création de l'événement Discord
  try {
    const eventUrl = thread
      ? `https://discord.com/channels/${interaction.guild.id}/${thread.id}`
      : "";

    const scheduledEvent = await interaction.guild.scheduledEvents.create({
      name: title,
      scheduledStartTime: startDate,
      scheduledEndTime: endDate,
      privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
      entityType: GuildScheduledEventEntityType.External,
      entityMetadata: { location: location.slice(0, 100) },
      description: `🎉 Sortie proposée par <@${interaction.user.id}>\n\n🔗 **Lien du sujet pour participer et s'organiser :**\n${eventUrl}`,
    });

    // 4. Métamorphose du message dans le fil de discussion
    if (interaction.message) {
      const confirmEmbed = new EmbedBuilder()
        .setColor(0x57f287) // Vert succès Discord
        .setTitle("📅 Sortie ajoutée au calendrier !")
        .setDescription(
          `L'événement **[${scheduledEvent.name}](${scheduledEvent.url})** est planifié !\n` +
          `Retrouvez-le dans la section **Événements** en haut du serveur.`
        )
        .addFields(
          { name: "🕒 Date & Heure", value: `<t:${Math.floor(startDate.getTime() / 1000)}:F>`, inline: true },
          { name: "📍 Lieu", value: location, inline: true }
        )
        .setFooter({ text: "NaoBot • Événements communautaires" })
        .setTimestamp();

      await interaction.message.edit({
        content: null,
        embeds: [confirmEmbed],
        components: [], // On retire les boutons pour garder le fil propre
      });
    }

    await interaction.editReply({
      content: `✅ **C'est tout bon !** La sortie a été ajoutée au calendrier Discord : [Voir l'événement](${scheduledEvent.url})`,
    });
  } catch (err) {
    console.error("[SORTIES] Erreur lors de la création de l'événement :", err);
    await interaction.editReply(
      "❌ **Erreur technique :** Impossible de créer l'événement. Vérifiez que le bot a bien la permission **Gérer les événements** sur le serveur.",
    );
  }
}

module.exports = {
  handleNewSortieThread,
  handleSortieButton,
  handleSortieModalSubmit,
};