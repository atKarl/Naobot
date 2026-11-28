import {
  SlashCommandBuilder,
  InteractionContextType,
  PermissionFlagsBits,
  MessageFlags,
  AttachmentBuilder,
} from "discord.js";
import type { ChatInputCommandInteraction, Collection, GuildMember } from "discord.js";
import { getAllUsersTracking } from "../../database.ts";
import type { UserTrackingRow } from "../../types.ts";

interface InactiveEntry {
  member: GuildMember;
  timestamp: number;
  neverActive: boolean;
}

export const data = new SlashCommandBuilder()
  .setName("inactifs")
  .setDescription("ADMIN: Génère un fichier rapport des membres inactifs")
  .addIntegerOption((option) =>
    option
      .setName("jours")
      .setDescription("Nombre de jours sans activité")
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(3650),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild);

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<unknown> {
  if (!interaction.guild) return;

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({
      content: "⛔ Réservé aux membres du staff.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const days = interaction.options.getInteger("jours", true);

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  let currentMembers: Collection<string, GuildMember>;
  try {
    currentMembers = await interaction.guild.members.fetch();
  } catch (error) {
    console.error("Erreur lors du fetch des membres:", error);
    return interaction.editReply(
      "❌ Erreur technique lors de la récupération des membres Discord.",
    );
  }

  const usersMap = new Map<string, UserTrackingRow>();
  for (const row of getAllUsersTracking()) {
    usersMap.set(row.user_id, row);
  }

  const thresholdDate = Date.now() - days * 24 * 60 * 60 * 1000;
  const inactiveList: InactiveEntry[] = [];
  let optOutCount = 0;

  for (const member of currentMembers.values()) {
    if (member.user.bot) continue;

    const dbUser = usersMap.get(member.id);
    if (dbUser && dbUser.tracking_enabled === 0) {
      optOutCount++;
      continue;
    }

    if (dbUser && dbUser.last_active_timestamp !== null) {
      if (dbUser.last_active_timestamp < thresholdDate) {
        inactiveList.push({
          member,
          timestamp: dbUser.last_active_timestamp,
          neverActive: false,
        });
      }
    } else if (
      member.joinedTimestamp !== null &&
      member.joinedTimestamp < thresholdDate
    ) {
      inactiveList.push({
        member,
        timestamp: member.joinedTimestamp,
        neverActive: true,
      });
    }
  }

  inactiveList.sort((a, b) => a.timestamp - b.timestamp);

  const dayPlural = days > 1 ? "s" : "";

  if (inactiveList.length === 0) {
    return interaction.editReply({
      content: `✅ Aucun membre inactif depuis plus de **${days} jour${dayPlural}** sur le serveur.`,
    });
  }

  const neverActiveCount = inactiveList.filter((e) => e.neverActive).length;
  const count = inactiveList.length;

  let fileContent = `=== RAPPORT D'INACTIVITÉ ===\n`;
  fileContent += `Serveur : ${interaction.guild.name}\n`;
  fileContent += `Date du rapport : ${new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}\n`;
  fileContent += `Critère : Aucune activité depuis ${days} jour${dayPlural}\n`;
  fileContent += `Membres trouvés (Présents sur le serveur) : ${count}${neverActiveCount > 0 ? ` (dont ${neverActiveCount} sans activité enregistrée)` : ""}\n`;
  fileContent += `Note : Les membres ayant désactivé le suivi (/privacy) sont exclus${optOutCount > 0 ? ` (${optOutCount} membre${optOutCount > 1 ? "s" : ""})` : ""}.\n`;
  fileContent += `----------------------------------------------------\n\n`;

  for (const entry of inactiveList) {
    const dateStr = new Date(entry.timestamp).toLocaleDateString("fr-FR", {
      timeZone: "Europe/Paris",
    });

    const globalUsername = entry.member.user.username;
    const serverName = entry.member.displayName;

    const formattedName =
      serverName.toLowerCase() !== globalUsername.toLowerCase()
        ? `${serverName} (@${globalUsername})`
        : globalUsername;

    const label = entry.neverActive
      ? `[Jamais actif - Arrivé le : ${dateStr}]`
      : `[Dernière vue : ${dateStr}]`;

    fileContent += `${label} ${formattedName} (ID: ${entry.member.id})\n`;
  }

  fileContent += `\n----------------------------------------------------\n`;
  fileContent += `Fin du rapport.`;

  const buffer = Buffer.from(fileContent, "utf-8");
  const attachment = new AttachmentBuilder(buffer, {
    name: `inactifs_${days}jours.txt`,
  });

  const plural = count > 1 ? "s" : "";

  await interaction.editReply({
    content: `✅ **Rapport généré !**\n**${count}** membre${plural} inactif${plural} depuis plus de **${days} jour${dayPlural}** sur le serveur.`,
    files: [attachment],
  });
}
