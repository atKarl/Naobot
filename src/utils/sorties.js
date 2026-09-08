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
      content: `👋 Salut <@${thread.ownerId}> ! Souhaites-tu inscrire cette sortie au calendrier du serveur ?`,
      components: [row],
    });
  } catch (error) {
    console.error(
      "[SORTIES] Erreur lors de l'envoi du message d'assistance :",
      error,
    );
  }
}

/**
 * Gère le clic sur les boutons d'une sortie
 */
async function handleSortieButton(interaction) {
  const [, action, threadId] = interaction.customId.split("_");
  const thread = interaction.guild.channels.cache.get(threadId);

  const isAuthor = thread && interaction.user.id === thread.ownerId;
  const isStaff =
    interaction.member.permissions.has(PermissionFlagsBits.ManageEvents) ||
    interaction.member.permissions.has(PermissionFlagsBits.ManageGuild);

  if (!isAuthor && !isStaff) {
    return interaction.reply({
      content:
        "⛔ Seul l'organisateur de cette sortie ou un modérateur peut planifier cet événement.",
      flags: MessageFlags.Ephemeral,
    });
  }

  if (action === "dismiss") {
    await interaction.message.delete().catch(() => {});
    return;
  }

  if (action === "create") {
    const defaultTitle = thread ? thread.name.slice(0, 100) : "";

    const modal = new ModalBuilder()
      .setCustomId(`modal_sortie_${threadId}`)
      .setTitle("Ajouter la sortie au calendrier");

    // Champ 1 : Titre (max 100)
    const titleInput = new TextInputBuilder()
      .setCustomId("title")
      .setLabel("Titre de l'événement")
      .setStyle(TextInputStyle.Short)
      .setValue(defaultTitle)
      .setMaxLength(100)
      .setRequired(true);

    // Champ 2 : Date séparée (accepte 23/09, demain, vendredi...)
    const dateInput = new TextInputBuilder()
      .setCustomId("date")
      .setLabel("Date (ex: 23/09 ou Demain, Samedi)")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("23/09, demain, vendredi, 15/10...")
      .setMaxLength(20)
      .setRequired(true);

    // Champ 3 : Heure séparée (ex: 19h30, 20h)
    const timeInput = new TextInputBuilder()
      .setCustomId("time")
      .setLabel("Heure de début (ex: 19h30 ou 20h)")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("19h30, 20h, 14:00...")
      .setMaxLength(10)
      .setRequired(true);

    // Champ 4 : Durée
    const durationInput = new TextInputBuilder()
      .setCustomId("duration")
      .setLabel("Durée estimée (en heures)")
      .setStyle(TextInputStyle.Short)
      .setValue("2")
      .setMaxLength(5)
      .setRequired(true);

    // Champ 5 : Lieu
    const locationInput = new TextInputBuilder()
      .setCustomId("location")
      .setLabel("Lieu du rendez-vous")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("ex: Cinéma Katorza, Parc de Procé...")
      .setMaxLength(100)
      .setRequired(true);

    // Discord autorise exactement 5 lignes (ActionRows) par Modal
    modal.addComponents(
      new ActionRowBuilder().addComponents(titleInput),
      new ActionRowBuilder().addComponents(dateInput),
      new ActionRowBuilder().addComponents(timeInput),
      new ActionRowBuilder().addComponents(durationInput),
      new ActionRowBuilder().addComponents(locationInput),
    );

    await interaction.showModal(modal);
  }
}

/**
 * Analyse la date saisie (JJ/MM, demain, vendredi, etc.)
 */
function parseDateInput(dateStr) {
  const lower = dateStr.trim().toLowerCase();
  const now = new Date();
  const todayParis = new Date(
    now.toLocaleString("en-US", { timeZone: "Europe/Paris" }),
  );

  if (lower === "aujourd'hui" || lower === "ce soir") {
    return {
      day: todayParis.getDate(),
      month: todayParis.getMonth(),
      year: todayParis.getFullYear(),
    };
  }

  if (lower === "demain") {
    const tomorrow = new Date(todayParis);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return {
      day: tomorrow.getDate(),
      month: tomorrow.getMonth(),
      year: tomorrow.getFullYear(),
    };
  }

  const daysOfWeek = [
    "dimanche",
    "lundi",
    "mardi",
    "mercredi",
    "jeudi",
    "vendredi",
    "samedi",
  ];
  const targetDayIndex = daysOfWeek.indexOf(lower);
  if (targetDayIndex !== -1) {
    const currentDayIndex = todayParis.getDay();
    let diff = targetDayIndex - currentDayIndex;
    if (diff <= 0) diff += 7; // Prochain jour de la semaine
    const targetDate = new Date(todayParis);
    targetDate.setDate(targetDate.getDate() + diff);
    return {
      day: targetDate.getDate(),
      month: targetDate.getMonth(),
      year: targetDate.getFullYear(),
    };
  }

  // Format standard : JJ/MM ou JJ/MM/AAAA
  const match = lower.match(/^(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{4}))?$/);
  if (match) {
    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1;
    let year = match[3] ? parseInt(match[3], 10) : todayParis.getFullYear();

    // Si la date est déjà passée cette année, on reporte à l'année prochaine
    if (!match[3]) {
      const checkDate = new Date(year, month, day, 23, 59, 59);
      if (checkDate.getTime() < todayParis.getTime()) {
        year += 1;
      }
    }
    return { day, month, year };
  }

  return null;
}

/**
 * Analyse l'heure saisie (19h, 19h30, 19:30)
 */
function parseTimeInput(timeStr) {
  const match = timeStr
    .trim()
    .match(/^(\d{1,2})(?:[h:H](\d{1,2})?|:(\d{2}))?$/);
  if (!match) return null;

  const hours = parseInt(match[1], 10);
  const minutes = match[2]
    ? parseInt(match[2], 10)
    : match[3]
      ? parseInt(match[3], 10)
      : 0;

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

  return { hours, minutes };
}

/**
 * Crée un objet Date UTC correspondant exactement à l'heure locale de Paris
 * (Résout le bug des +2h sur les serveurs distants)
 */
function createDateInParisTime(day, month, year, hours, minutes) {
  const pad = (n) => String(n).padStart(2, "0");
  const isoNaive = `${year}-${pad(month + 1)}-${pad(day)}T${pad(hours)}:${pad(minutes)}:00`;

  const tempUtc = new Date(`${isoNaive}Z`);
  const parisString = tempUtc.toLocaleString("en-US", {
    timeZone: "Europe/Paris",
  });
  const parisParsed = new Date(parisString);
  const offsetMs = tempUtc.getTime() - parisParsed.getTime();

  return new Date(tempUtc.getTime() + offsetMs);
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
  const timeStr = interaction.fields.getTextInputValue("time");
  const durationStr = interaction.fields.getTextInputValue("duration");
  const location = interaction.fields.getTextInputValue("location");

  // 1. Validation de la date et de l'heure
  const dateInfo = parseDateInput(dateStr);
  if (!dateInfo) {
    return interaction.editReply(
      "❌ **Date invalide !**\nExemples : `23/09`, `demain`, `vendredi` ou `23/09/2026`.",
    );
  }

  const timeInfo = parseTimeInput(timeStr);
  if (!timeInfo) {
    return interaction.editReply(
      "❌ **Heure invalide !**\nExemples : `19h30`, `20h` ou `14:00`.",
    );
  }

  const startDate = createDateInParisTime(
    dateInfo.day,
    dateInfo.month,
    dateInfo.year,
    timeInfo.hours,
    timeInfo.minutes,
  );

  if (startDate.getTime() <= Date.now()) {
    return interaction.editReply(
      "❌ **La sortie doit être programmée dans le futur !**",
    );
  }

  // 2. Validation de la durée
  const durationHours = parseFloat(durationStr.replace(",", "."));
  if (isNaN(durationHours) || durationHours <= 0 || durationHours > 72) {
    return interaction.editReply(
      "❌ **Durée invalide !** Indiquez un nombre d'heures (ex: `2` ou `3.5`).",
    );
  }

  const endDate = new Date(
    startDate.getTime() + durationHours * 60 * 60 * 1000,
  );

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
      description: `🎉 Sortie proposée par <@${interaction.user.id}>\n\n🔗 **Lien du sujet pour s'organiser :**\n${eventUrl}`,
    });

    // 4. Métamorphose du message dans le fil
    if (interaction.message) {
      const confirmEmbed = new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle("📅 Sortie ajoutée au calendrier officiel !")
        .setDescription(
          `L'événement **[${scheduledEvent.name}](${scheduledEvent.url})** a été créé !\n` +
            `Retrouvez-le dans la section **Événements** en haut du serveur pour indiquer votre présence.`,
        )
        .addFields(
          {
            name: "🕒 Date & Heure",
            value: `<t:${Math.floor(startDate.getTime() / 1000)}:F>`,
            inline: true,
          },
          { name: "📍 Lieu", value: location, inline: true },
        )
        .setFooter({ text: "NaoBot • Événements communautaires" })
        .setTimestamp();

      await interaction.message.edit({
        content: null,
        embeds: [confirmEmbed],
        components: [],
      });
    }

    await interaction.editReply({
      content: `✅ **C'est tout bon !** L'événement est planifié à la bonne heure : [Voir l'événement](${scheduledEvent.url})`,
    });
  } catch (err) {
    console.error("[SORTIES] Erreur lors de la création de l'événement :", err);
    await interaction.editReply(
      "❌ **Erreur technique :** Impossible de créer l'événement. Vérifiez que le bot a bien la permission **Gérer les événements**.",
    );
  }
}

module.exports = {
  handleNewSortieThread,
  handleSortieButton,
  handleSortieModalSubmit,
};
