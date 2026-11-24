const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
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
 * Résout un thread depuis l'interaction courante ou via fetch() s'il est absent du cache
 */
async function resolveThread(interaction, threadId) {
  if (interaction.channel?.id === threadId) {
    return interaction.channel;
  }
  return interaction.guild.channels.fetch(threadId).catch(() => null);
}

/**
 * Gère le clic sur les boutons d'une sortie
 */
async function handleSortieButton(interaction) {
  const [, action, threadId] = interaction.customId.split("_");
  const thread = await resolveThread(interaction, threadId);

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
    await interaction.deferUpdate();
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
      .setStyle(TextInputStyle.Short)
      .setValue(defaultTitle)
      .setMaxLength(100)
      .setRequired(true);

    // Champ 2 : Date séparée (accepte 23/09, demain, vendredi...)
    const dateInput = new TextInputBuilder()
      .setCustomId("date")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("23/09, demain, vendredi, 15/10...")
      .setMaxLength(20)
      .setRequired(true);

    // Champ 3 : Heure séparée (ex: 19h30, 20h)
    const timeInput = new TextInputBuilder()
      .setCustomId("time")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("19h30, 20h, 14:00...")
      .setMaxLength(10)
      .setRequired(true);

    // Champ 4 : Durée (menu déroulant)
    const durationSelect = new StringSelectMenuBuilder()
      .setCustomId("duration")
      .setRequired(true)
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel("1 heure").setValue("1"),
        new StringSelectMenuOptionBuilder()
          .setLabel("2 heures")
          .setValue("2")
          .setDefault(true),
        new StringSelectMenuOptionBuilder().setLabel("3 heures").setValue("3"),
        new StringSelectMenuOptionBuilder()
          .setLabel("4 heures (Soirée)")
          .setValue("4"),
        new StringSelectMenuOptionBuilder().setLabel("6 heures").setValue("6"),
        new StringSelectMenuOptionBuilder()
          .setLabel("8 heures (Journée)")
          .setValue("8"),
      );

    // Champ 5 : Lieu
    const locationInput = new TextInputBuilder()
      .setCustomId("location")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("ex: Cinéma Katorza, Parc de Procé...")
      .setMaxLength(100)
      .setRequired(true);

    modal.addLabelComponents(
      new LabelBuilder()
        .setLabel("Titre de l'événement")
        .setTextInputComponent(titleInput),
      new LabelBuilder()
        .setLabel("Date")
        .setDescription(
          "Formats acceptés : 23/09, demain, vendredi, 23/09/2026",
        )
        .setTextInputComponent(dateInput),
      new LabelBuilder()
        .setLabel("Heure de début")
        .setDescription("Formats acceptés : 19h30, 20h, 14:00")
        .setTextInputComponent(timeInput),
      new LabelBuilder()
        .setLabel("Durée estimée")
        .setStringSelectMenuComponent(durationSelect),
      new LabelBuilder()
        .setLabel("Lieu du rendez-vous")
        .setDescription("Ex : Cinéma Katorza, Parc de Procé...")
        .setTextInputComponent(locationInput),
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

    if (month < 0 || month > 11 || day < 1 || day > 31) {
      return null;
    }

    const isValidCalendarDate = (y, m, d) => {
      const check = new Date(Date.UTC(y, m, d));
      return (
        check.getUTCFullYear() === y &&
        check.getUTCMonth() === m &&
        check.getUTCDate() === d
      );
    };

    if (match[3]) {
      if (!isValidCalendarDate(year, month, day)) return null;
      return { day, month, year };
    }

    // Rejeter immédiatement les dates impossibles même en année bissextile (ex: 31/02)
    if (!isValidCalendarDate(2000, month, day)) return null;

    // Si la date est déjà passée cette année, on reporte à l'année prochaine
    const todayMonth = todayParis.getMonth();
    const todayDay = todayParis.getDate();
    if (month < todayMonth || (month === todayMonth && day < todayDay)) {
      year += 1;
    }

    // Vérifier la validité calendaire pour l'année retenue (ex: 29/02 sur année non bissextile)
    if (!isValidCalendarDate(year, month, day)) return null;

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
 * Calcule le décalage UTC <-> Europe/Paris en millisecondes à un instant donné
 */
function getParisOffsetMs(utcMs) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(utcMs));
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  );
  return asUtc - utcMs;
}

/**
 * Calcule l'heure UTC exacte correspondant à l'heure locale de Paris (gère été/hiver et transitions DST)
 */
function createDateInParisTime(day, month, year, hours, minutes) {
  const targetUtc = Date.UTC(year, month, day, hours, minutes, 0);
  const offset1 = getParisOffsetMs(targetUtc);
  const approxUtc = targetUtc - offset1;
  const offset2 = getParisOffsetMs(approxUtc);
  return new Date(targetUtc - offset2);
}

/**
 * Traite la soumission du formulaire et crée l'événement Discord
 */
async function handleSortieModalSubmit(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const threadId = interaction.customId.replace("modal_sortie_", "");
  const thread = await resolveThread(interaction, threadId);

  const title = interaction.fields.getTextInputValue("title");
  const dateStr = interaction.fields.getTextInputValue("date");
  const timeStr = interaction.fields.getTextInputValue("time");
  const durationStr = interaction.fields.getStringSelectValues("duration")[0];
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

  // Sécurité anti-crash
  if (isNaN(startDate.getTime())) {
    return interaction.editReply(
      "❌ **Erreur d'analyse de la date.** Vérifiez votre saisie.",
    );
  }

  if (startDate.getTime() <= Date.now()) {
    return interaction.editReply(
      "❌ **La sortie doit être programmée dans le futur !**",
    );
  }

  // 2. Validation de la durée
  const durationHours = parseFloat((durationStr ?? "").replace(",", "."));
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

    // 4. Nettoyage du message d'invitation initial
    if (interaction.message) {
      await interaction.message.delete().catch(() => {});
    }

    await interaction.editReply({
      content: `✅ **C'est tout bon !** L'événement est planifié au calendrier officiel : [Voir l'événement](${scheduledEvent.url})`,
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
  parseDateInput,
  createDateInParisTime,
};