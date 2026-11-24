const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  MessageFlags,
  escapeMarkdown,
} = require("discord.js");
const db = require("../../database");
const config = require("../../../config.json");

const INACTIVE_THRESHOLD_DAYS = config.inactivityDays ?? 90;
const DAY_MS = 24 * 60 * 60 * 1000;

function formatTimestamp(ms, emptyText = "*Aucune (sur les 365 derniers jours)*") {
  if (!ms) return emptyText;
  const sec = Math.floor(ms / 1000);
  return `<t:${sec}:f> (<t:${sec}:R>)`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("activite")
    .setDescription(
      "ADMIN: Affiche la dernière activité connue d'un membre (réactions, fichiers, messages)",
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((option) =>
      option
        .setName("membre")
        .setDescription("Le membre à vérifier")
        .setRequired(true),
    ),

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({
        content: "⛔ Réservé aux membres du staff.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const targetUser = interaction.options.getUser("membre");

    if (targetUser.bot) {
      return interaction.reply({
        content: "🤖 Les bots ne sont pas suivis par le système d'activité.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const member = await interaction.guild.members
      .fetch(targetUser.id)
      .catch(() => null);

    const details = db.getUserActivityDetails(targetUser.id, 5);
    const isOptOut = details.tracking === 0;
    const hasInactiveRole =
      Boolean(config.roles?.inactive) &&
      Boolean(member?.roles.cache.has(config.roles.inactive));

    // Calcul du statut d'inactivité
    let inactivityStatus;
    if (!member) {
      inactivityStatus = "⚪ Membre absent du serveur";
    } else if (hasInactiveRole) {
      inactivityStatus = "🔴 Possède actuellement le rôle **Inactif**";
    } else if (isOptOut) {
      inactivityStatus =
        "⚪ Suivi désactivé (exempté du rôle **Inactif** automatique)";
    } else if (details.lastActive) {
      const elapsedDays = Math.floor((Date.now() - details.lastActive) / DAY_MS);
      const remainingDays = INACTIVE_THRESHOLD_DAYS - elapsedDays;

      if (remainingDays > 0) {
        inactivityStatus = `🟢 Actif — rôle *Inactif* dans **${remainingDays} jour${remainingDays > 1 ? "s" : ""}**`;
      } else {
        inactivityStatus = `🟠 Seuil des ${INACTIVE_THRESHOLD_DAYS}j dépassé (${elapsedDays}j) — rôle attribué au prochain cron`;
      }
    } else {
      inactivityStatus = "⚪ Aucune activité enregistrée en base";
    }

    const displayName = member ? member.displayName : targetUser.username;
    const headerName =
      displayName.toLowerCase() !== targetUser.username.toLowerCase()
        ? `${escapeMarkdown(displayName)} (@${escapeMarkdown(targetUser.username)})`
        : escapeMarkdown(targetUser.username);

    const reactionsList =
      details.recentReactions.length > 0
        ? details.recentReactions
            .map((ts) => `• ${formatTimestamp(ts)}`)
            .join("\n")
        : "*Aucune réaction enregistrée sur les 365 derniers jours*";

    const embedColor = hasInactiveRole
      ? 0xe74c3c
      : isOptOut
        ? 0x95a5a6
        : 0x00a650;

    const embed = new EmbedBuilder()
      .setColor(embedColor)
      .setTitle(`📋 Activité de ${headerName}`)
      .setThumbnail(targetUser.displayAvatarURL())
      .setDescription(
        [
          `**Statut :** ${inactivityStatus}`,
          `**Suivi RGPD (\`/privacy\`) :** ${isOptOut ? "🛑 Désactivé (Opt-out)" : "✅ Activé"}`,
          member?.joinedTimestamp
            ? `**Arrivée sur le serveur :** <t:${Math.floor(member.joinedTimestamp / 1000)}:D> (<t:${Math.floor(member.joinedTimestamp / 1000)}:R>)`
            : null,
        ]
          .filter(Boolean)
          .join("\n"),
      )
      .addFields(
        {
          name: `⏳ Dernière activité retenue (compteur ${INACTIVE_THRESHOLD_DAYS} jours)`,
          value: formatTimestamp(
            details.lastActive,
            "*Jamais enregistrée*",
          ),
        },
        {
          name: "📌 Dernière interaction par type",
          value: [
            `👍 **Réaction :** ${formatTimestamp(details.lastByType.reaction)}`,
            `📎 **Fichier :** ${formatTimestamp(details.lastByType.file)}`,
            `💬 **Message :** ${formatTimestamp(details.lastByType.message)}`,
          ].join("\n"),
        },
        {
          name: "👍 5 dernières réactions enregistrées",
          value: reactionsList,
        },
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};