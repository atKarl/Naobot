/**
 * src/commands/public/anniversaire.js
 *
 * Commande /anniversaire avec deux sous-commandes :
 * - set    : Un membre enregistre son propre anniversaire
 * - staff  : Un admin enregistre l'anniversaire d'un autre membre (ManageGuild)
 *
 * Règles :
 * - Toutes les réponses sont éphémères (invisible pour les autres)
 * - L'année n'est jamais demandée ni stockée
 * - Si la cible a désactivé son suivi (opt-out), l'enregistrement est refusé
 */

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
} = require("discord.js");
const db = require("../../database");

// Noms abrégés des mois pour les confirmations
const MONTH_NAMES = [
  "", // index 0 inutilisé (mois commence à 1)
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];

/**
 * Valide que la combinaison jour/mois est cohérente.
 * Utilise une année bissextile fictive (2000) pour valider le 29 février.
 *
 * @param {number} day
 * @param {number} month
 * @returns {boolean}
 */
function isValidDate(day, month) {
  if (month < 1 || month > 12) return false;
  // Date avec année bissextile pour autoriser le 29/02
  const d = new Date(2000, month - 1, day);
  return d.getMonth() === month - 1 && d.getDate() === day;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("anniversaire")
    .setDescription("Gestion des anniversaires du serveur")

    // --- Sous-commande : membre enregistre son propre anniversaire ---
    .addSubcommand((sub) =>
      sub
        .setName("set")
        .setDescription("Enregistre ton anniversaire (jour et mois uniquement)")
        .addIntegerOption((opt) =>
          opt
            .setName("jour")
            .setDescription("Ton jour de naissance (1-31)")
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(31),
        )
        .addIntegerOption((opt) =>
          opt
            .setName("mois")
            .setDescription("Ton mois de naissance (1-12)")
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(12),
        ),
    )

    // --- Sous-commande : staff enregistre l'anniversaire d'un autre membre ---
    .addSubcommand((sub) =>
      sub
        .setName("staff")
        .setDescription("ADMIN: Enregistre l'anniversaire d'un autre membre")
        .addUserOption((opt) =>
          opt
            .setName("membre")
            .setDescription("Le membre concerné")
            .setRequired(true),
        )
        .addIntegerOption((opt) =>
          opt
            .setName("jour")
            .setDescription("Jour de naissance (1-31)")
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(31),
        )
        .addIntegerOption((opt) =>
          opt
            .setName("mois")
            .setDescription("Mois de naissance (1-12)")
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(12),
        ),
    )

    // --- Sous-commande : supprimer son propre anniversaire ---
    .addSubcommand((sub) =>
      sub
        .setName("supprimer")
        .setDescription("Supprime ton anniversaire enregistré"),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    // ----------------------------------------------------------------
    // /anniversaire set
    // ----------------------------------------------------------------
    if (sub === "set") {
      const day = interaction.options.getInteger("jour");
      const month = interaction.options.getInteger("mois");
      const user = interaction.user;

      // Vérification de la date
      if (!isValidDate(day, month)) {
        return interaction.reply({
          content: `❌ La date **${day}/${month}** n'est pas valide. Merci de vérifier ton jour et ton mois.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      // Vérification du statut RGPD de l'utilisateur
      const stats = db.getUserStats(user.id);
      if (stats.tracking === 0) {
        return interaction.reply({
          content:
            "🛑 **Enregistrement impossible.**\n\n" +
            "Tu as désactivé le suivi d'activité (`/privacy optout`). " +
            "L'enregistrement de ton anniversaire fait partie du système de suivi.\n\n" +
            "Pour enregistrer ton anniversaire, réactive d'abord ton suivi avec `/privacy optin`, " +
            "ou consulte `/help` pour plus d'informations.",
          flags: MessageFlags.Ephemeral,
        });
      }

      // Enregistrement
      db.setBirthday(user.id, user.username, day, month);

      // Mise à jour du message persistant
      await refreshBirthdayMessage(interaction.guild);

      return interaction.reply({
        content: `🎂 **Anniversaire enregistré !** Le **${day} ${MONTH_NAMES[month]}**. Je m'en souviendrai !`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // ----------------------------------------------------------------
    // /anniversaire staff
    // ----------------------------------------------------------------
    if (sub === "staff") {
      // Vérification des permissions
      if (
        !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)
      ) {
        return interaction.reply({
          content: "⛔ Cette sous-commande est réservée au staff.",
          flags: MessageFlags.Ephemeral,
        });
      }

      const targetUser = interaction.options.getUser("membre");
      const day = interaction.options.getInteger("jour");
      const month = interaction.options.getInteger("mois");

      // Vérification de la date
      if (!isValidDate(day, month)) {
        return interaction.reply({
          content: `❌ La date **${day}/${month}** n'est pas valide.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      // Refus si le membre cible est un bot
      if (targetUser.bot) {
        return interaction.reply({
          content: "❌ Impossible d'enregistrer l'anniversaire d'un bot.",
          flags: MessageFlags.Ephemeral,
        });
      }

      // Vérification du statut RGPD de la cible
      const stats = db.getUserStats(targetUser.id);
      if (stats.tracking === 0) {
        return interaction.reply({
          content:
            `🛑 **Enregistrement refusé.**\n\n` +
            `<@${targetUser.id}> a désactivé le suivi d'activité (\`/privacy optout\`). ` +
            `Il n'est pas possible d'enregistrer ses données sans son consentement.\n\n` +
            `Invitez-le à utiliser \`/privacy optin\` s'il souhaite que son anniversaire soit géré par le bot. ` +
            `Consultez \`/help\` pour plus d'informations.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      // Récupération du pseudo serveur (DisplayName) si disponible
      let displayName = targetUser.username;
      try {
        const member = await interaction.guild.members.fetch(targetUser.id);
        displayName = member.displayName;
      } catch (_) {
        /* Le membre sera identifié par son username sinon */
      }

      // Enregistrement
      db.setBirthday(targetUser.id, displayName, day, month);

      // Mise à jour du message persistant
      await refreshBirthdayMessage(interaction.guild);

      return interaction.reply({
        content: `✅ Anniversaire de **${displayName}** enregistré pour le **${day} ${MONTH_NAMES[month]}**.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // ----------------------------------------------------------------
    // /anniversaire supprimer
    // ----------------------------------------------------------------
    if (sub === "supprimer") {
      const deleted = db.deleteBirthday(interaction.user.id);

      if (deleted === 0) {
        return interaction.reply({
          content: "ℹ️ Aucun anniversaire n'est enregistré pour toi.",
          flags: MessageFlags.Ephemeral,
        });
      }

      // Mise à jour du message persistant
      await refreshBirthdayMessage(interaction.guild);

      return interaction.reply({
        content: "🗑️ Ton anniversaire a été supprimé.",
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};

const MONTH_NAMES_CAP = [
  "",
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
];

/**
 * Génère le texte de la liste des anniversaires.
 * Retourne un tableau de chaînes (chunks ≤ 2000 caractères).
 *
 * @param {import("discord.js").Guild} guild  - Serveur Discord
 * @returns {Promise<string[]>}
 */
async function buildBirthdayChunks(guild) {
  const all = db.getAllBirthdays();

  // FIX 1 : On retourne bien un tableau vide (et non undefined)
  if (all.length === 0) {
    return [];
  }

  try {
    await guild.members.fetch();
  } catch (err) {
    console.warn(
      " Impossible de fetch les membres (DisplayNames potentiellement incomplets).",
    );
  }

  const lines = [];
  let currentMonth = 0;

  for (const entry of all) {
    if (entry.month !== currentMonth) {
      currentMonth = entry.month;
      lines.push(`\n── ${MONTH_NAMES_CAP[entry.month]} ──`);
    }

    let displayName = entry.username;
    const cachedMember = guild.members.cache.get(entry.user_id);
    if (cachedMember) displayName = cachedMember.displayName;

    lines.push(
      `  🎂 ${String(entry.day).padStart(2, "0")}/${String(entry.month).padStart(2, "0")} — ${displayName}`,
    );
  }

  const CHUNK_SIZE = 1900;
  const chunks = [];
  let current = "📅 **Liste des Anniversaires**\n";
  let page = 1;

  for (const line of lines) {
    if ((current + "\n" + line).length > CHUNK_SIZE) {
      chunks.push(current);
      page++;
      current =
        `📅 **Liste des Anniversaires** *(Suite - Partie ${page})*\n` + line;
    } else {
      current += "\n" + line;
    }
  }
  if (current) chunks.push(current);

  return chunks;
}

/**
 * Rafraîchit le/les messages persistants de la liste des anniversaires.
 *
 * @param {import("discord.js").Guild} guild
 */
async function refreshBirthdayMessage(guild) {
  const config = require("../../config.json");
  const channelId = config.channels?.birthdays;

  if (!channelId || channelId === "ID_DU_SALON") return;

  let channel;
  try {
    channel = await guild.client.channels.fetch(channelId);
  } catch (_) {
    console.warn(" Salon de liste introuvable :", channelId);
    return;
  }

  const chunks = await buildBirthdayChunks(guild);

  // 1. On récupère les 10 derniers messages du salon
  const messages = await channel.messages.fetch({ limit: 10 });

  // 2. On isole uniquement les messages postés par le bot contenant "Liste des Anniversaires"
  const botMessages = Array.from(
    messages
      .filter(
        (m) =>
          m.author.id === guild.client.user.id &&
          m.content.includes("Liste des Anniversaires"),
      )
      .values(),
  ).reverse();

  // 3. Boucle de mise à jour / Création
  // FIX 2 : Utilisation de l'index [i] pour manipuler chaque message et chunk individuellement
  for (let i = 0; i < chunks.length; i++) {
    if (botMessages[i]) {
      // Le bot a déjà un message ici, on l'édite avec le contenu du chunk correspondant
      await botMessages[i].edit({ content: chunks[i] });
    } else {
      // Pas assez de messages, on en crée un nouveau
      await channel.send({ content: chunks[i] });
    }
  }

  // 4. Nettoyage des messages en surplus
  // FIX 3 : Même chose, on s'assure d'appeler .delete() sur les objets Message et non sur le tableau
  for (let i = chunks.length; i < botMessages.length; i++) {
    if (botMessages[i]) {
      await botMessages[i].delete().catch(() => {});
    }
  }
}

// Export de la fonction pour pouvoir l'appeler depuis index.js
module.exports.refreshBirthdayMessage = refreshBirthdayMessage;
