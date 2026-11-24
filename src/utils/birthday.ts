import { MessageFlags, escapeMarkdown } from "discord.js";
import type { Guild, MessageMentionTypes } from "discord.js";
import { config } from "../config.ts";
import { getAllBirthdays } from "../database.ts";

const MONTH_NAMES_CAP: readonly string[] = [
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

function isValidDate(day: number, month: number): boolean {
  if (month < 1 || month > 12) return false;
  // Année 2000 (bissextile) pour accepter le 29 février sans stocker l'année de naissance
  const d = new Date(2000, month - 1, day);
  return d.getMonth() === month - 1 && d.getDate() === day;
}

async function buildBirthdayChunks(guild: Guild): Promise<string[]> {
  const all = getAllBirthdays();
  if (all.length === 0) return [];

  // Récupère uniquement les membres manquants dans le cache (évite le rate-limit Gateway Opcode 8)
  try {
    const missingIds = all
      .map((entry) => entry.user_id)
      .filter((id) => !guild.members.cache.has(id));
    if (missingIds.length > 0) {
      await guild.members.fetch({ user: missingIds });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[ANNIVERSAIRES] Erreur fetch membres ciblés :", message);
  }

  const lines: string[] = [];
  let currentMonth = 0;

  for (const entry of all) {
    if (entry.month !== currentMonth) {
      currentMonth = entry.month;

      lines.push(`\n# ${MONTH_NAMES_CAP[entry.month]}`);
    }

    const member = guild.members.cache.get(entry.user_id);
    const displayName = member ? member.displayName : entry.username;

    const nameDisplay = `**${escapeMarkdown(displayName)}** - <@${entry.user_id}>`;

    lines.push(
      `• ${String(entry.day).padStart(2, "0")}/${String(entry.month).padStart(2, "0")} — ${nameDisplay}`,
    );
  }

  const CHUNK_SIZE = 1900;
  const chunks: string[] = [];
  let current = "## 🎂 Liste des Anniversaires\n";
  let page = 1;

  for (const line of lines) {
    if ((current + "\n" + line).length > CHUNK_SIZE) {
      chunks.push(current);
      page++;
      current = `## 🎂 Liste des Anniversaires *(Partie ${page})*\n` + line;
    } else {
      current += "\n" + line;
    }
  }
  if (current) chunks.push(current);

  return chunks;
}

async function refreshBirthdayMessage(guild: Guild): Promise<void> {
  const channelId = config.channels.birthdays;
  if (!channelId || channelId === "ID_DU_SALON") return;

  let channel;
  try {
    channel = await guild.client.channels.fetch(channelId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ANNIVERSAIRES] Erreur fetch salon:", message);
    return;
  }

  if (!channel || !channel.isSendable()) return;

  const botUserId = guild.client.user?.id;
  if (!botUserId) return;

  const chunks = await buildBirthdayChunks(guild);
  const messageOptions = {
    // Évite de notifier tous les membres à chaque mise à jour de la liste
    allowedMentions: { parse: [] as MessageMentionTypes[] },
    flags: MessageFlags.SuppressEmbeds as const,
  };
  const messages = await channel.messages.fetch({ limit: 10 });

  const botMessages = Array.from(
    messages
      .filter(
        (m) =>
          m.author.id === botUserId &&
          m.content.includes("Liste des Anniversaires"),
      )
      .values(),
  ).reverse();

  for (let i = 0; i < chunks.length; i++) {
    const existing = botMessages[i];
    if (existing) {
      await existing.edit({ content: chunks[i], ...messageOptions });
    } else {
      await channel.send({ content: chunks[i], ...messageOptions });
    }
  }

  for (let i = chunks.length; i < botMessages.length; i++) {
    const extra = botMessages[i];
    if (extra) await extra.delete().catch(() => {});
  }
}

export { isValidDate, refreshBirthdayMessage, MONTH_NAMES_CAP };
