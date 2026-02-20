const db = require("../database");
const path = require("path");

const config = require("../../config.json");

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

function isValidDate(day, month) {
  if (month < 1 || month > 12) return false;
  const d = new Date(2000, month - 1, day);
  return d.getMonth() === month - 1 && d.getDate() === day;
}

async function buildBirthdayChunks(guild) {
  const all = db.getAllBirthdays();
  if (all.length === 0) return [];

  try {
    await guild.members.fetch();
  } catch (err) {
    console.warn("Fetch error");
  }

  const lines = [];
  let currentMonth = 0;

  for (const entry of all) {
    if (entry.month !== currentMonth) {
      currentMonth = entry.month;

      lines.push(`\n# ${MONTH_NAMES_CAP[entry.month]}`);
    }

    const member = guild.members.cache.get(entry.user_id);
    const nameDisplay = member ? `<@${entry.user_id}>` : entry.username;

    lines.push(
      `> ${String(entry.day).padStart(2, "0")}/${String(entry.month).padStart(2, "0")} — ${nameDisplay}`,
    );
  }

  const CHUNK_SIZE = 1900;
  const chunks = [];
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

async function refreshBirthdayMessage(guild) {
  const channelId = config.channels?.birthdays;
  if (!channelId || channelId === "ID_DU_SALON") return;

  let channel;
  try {
    channel = await guild.client.channels.fetch(channelId);
  } catch (_) {
    return;
  }

  const chunks = await buildBirthdayChunks(guild);
  const silenceOptions = { allowedMentions: { parse: [] } };
  const messages = await channel.messages.fetch({ limit: 10 });

  const botMessages = Array.from(
    messages
      .filter(
        (m) =>
          m.author.id === guild.client.user.id &&
          m.content.includes("Liste des Anniversaires"),
      )
      .values(),
  ).reverse();

  for (let i = 0; i < chunks.length; i++) {
    if (botMessages[i])
      await botMessages[i].edit({ content: chunks[i], ...silenceOptions });
    else await channel.send({ content: chunks[i], ...silenceOptions });
  }

  for (let i = chunks.length; i < botMessages.length; i++) {
    if (botMessages[i]) await botMessages[i].delete().catch(() => {});
  }
}

module.exports = { isValidDate, refreshBirthdayMessage, MONTH_NAMES_CAP };
