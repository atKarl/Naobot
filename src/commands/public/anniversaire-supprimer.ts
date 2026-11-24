import {
  SlashCommandBuilder,
  InteractionContextType,
  MessageFlags,
} from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";
import { deleteBirthday } from "../../database.ts";
import { refreshBirthdayMessage } from "../../utils/birthday.ts";

export const data = new SlashCommandBuilder()
  .setName("anniversaire-supprimer")
  .setDescription("Supprime ton anniversaire de la liste")
  .setContexts(InteractionContextType.Guild);

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<unknown> {
  if (!interaction.guild) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const deleted = deleteBirthday(interaction.user.id);

  if (deleted === 0) {
    return interaction.editReply({
      content: "ℹ️ Tu n'avais pas d'anniversaire enregistré.",
    });
  }

  await refreshBirthdayMessage(interaction.guild);

  return interaction.editReply({
    content: "🗑️ Ton anniversaire a été supprimé.",
  });
}
