import {
  SlashCommandBuilder,
  InteractionContextType,
  PermissionFlagsBits,
  MessageFlags,
} from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";
import { deleteBirthday } from "../../database.ts";
import { refreshBirthdayMessage } from "../../utils/birthday.ts";

export const data = new SlashCommandBuilder()
  .setName("anniversaire-supprimer-staff")
  .setDescription("ADMIN: Supprime l'anniversaire d'un autre membre")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild)
  .addUserOption((opt) =>
    opt
      .setName("membre")
      .setDescription("Le membre dont il faut supprimer l'anniversaire")
      .setRequired(true),
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<unknown> {
  if (!interaction.guild) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const targetUser = interaction.options.getUser("membre", true);

  const deleted = deleteBirthday(targetUser.id);

  if (deleted === 0) {
    return interaction.editReply({
      content: `ℹ️ **${targetUser.username}** n'a aucun anniversaire enregistré dans la base de données.`,
    });
  }

  // Mise à jour automatique du message persistant sur le serveur
  await refreshBirthdayMessage(interaction.guild);

  return interaction.editReply({
    content: `🗑️ L'anniversaire de **${targetUser.username}** a été supprimé avec succès.`,
  });
}
