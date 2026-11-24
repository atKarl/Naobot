import {
  SlashCommandBuilder,
  InteractionContextType,
  MessageFlags,
} from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";
import { getUserStats, setBirthday } from "../../database.ts";
import {
  isValidDate,
  refreshBirthdayMessage,
  MONTH_NAMES_CAP,
} from "../../utils/birthday.ts";

export const data = new SlashCommandBuilder()
  .setName("anniversaire")
  .setDescription("Enregistre ta date d'anniversaire")
  .setContexts(InteractionContextType.Guild)
  .addIntegerOption((opt) =>
    opt
      .setName("jour")
      .setDescription("Ton jour (1-31)")
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(31),
  )
  .addIntegerOption((opt) =>
    opt
      .setName("mois")
      .setDescription("Ton mois (1-12)")
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(12),
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<unknown> {
  if (!interaction.guild) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const day = interaction.options.getInteger("jour", true);
  const month = interaction.options.getInteger("mois", true);
  const user = interaction.user;

  if (!isValidDate(day, month)) {
    return interaction.editReply({
      content: `❌ Date invalide (${day}/${month}).`,
    });
  }

  const stats = getUserStats(user.id);
  if (stats.tracking === 0) {
    return interaction.editReply({
      content:
        "🛑 Active ton suivi (`/privacy optin`) pour utiliser cette fonction.",
    });
  }

  setBirthday(user.id, user.username, day, month);
  await refreshBirthdayMessage(interaction.guild);

  return interaction.editReply({
    content: `✅ Anniversaire enregistré : **${day} ${MONTH_NAMES_CAP[month]}**.`,
  });
}
