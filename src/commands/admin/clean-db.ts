import {
  SlashCommandBuilder,
  InteractionContextType,
  PermissionFlagsBits,
  MessageFlags,
} from "discord.js";
import type { ChatInputCommandInteraction, Collection, GuildMember } from "discord.js";
import { getAllTrackedUserIds, removeUserData } from "../../database.ts";
import { refreshBirthdayMessage } from "../../utils/birthday.ts";

export const data = new SlashCommandBuilder()
  .setName("clean-db")
  .setDescription(
    "ADMIN: Supprime de la DB les membres qui ont quitté le serveur (Nettoyage Fantômes)",
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild);

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<unknown> {
  if (!interaction.guild) return;

  // Sécurité : Admin seulement
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({
      content: "⛔ Réservé au staff.",
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // 1. Récupération des données
  let discordMembers: Collection<string, GuildMember>;
  try {
    discordMembers = await interaction.guild.members.fetch();
  } catch {
    return interaction.editReply(
      "❌ Erreur critique : Impossible de récupérer la liste des membres Discord.",
    );
  }

  const dbUserIds = getAllTrackedUserIds();

  // 2. Identification des fantômes
  const ghosts = dbUserIds.filter((dbId) => !discordMembers.has(dbId));

  if (ghosts.length === 0) {
    return interaction.editReply(
      "✅ La base de données est déjà parfaitement synchronisée. Aucun fantôme trouvé.",
    );
  }

  await interaction.editReply(
    `🧹 **Nettoyage commencé...**\n👻 ${ghosts.length} utilisateurs fantômes détectés.\nSuppression en cours...`,
  );

  // 3. Suppression massive
  let deletedCount = 0;

  for (const userId of ghosts) {
    removeUserData(userId);
    deletedCount++;
  }

  if (deletedCount > 0) {
    await refreshBirthdayMessage(interaction.guild);
  }

  await interaction.editReply(
    `✅ **Nettoyage Terminé !**\n🗑️ **${deletedCount}** profils supprimés de la base de données (car ils ne sont plus sur le serveur).`,
  );
}
