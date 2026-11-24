import fs from "node:fs";
import path from "node:path";
import type { BotConfig } from "./types.ts";

interface RawBotConfig {
  token?: string;
  clientId?: string;
  guildId?: string;
  roles?: {
    inactive?: string;
    activeOfMonth?: string;
  };
  channels?: {
    announcement?: string;
    backups?: string;
    birthdays?: string;
    sortiesForum?: string;
  };
  ignoredChannels?: string[];
  cooldown?: number;
  inactivityDays?: number;
}

function loadConfig(): BotConfig {
  try {
    const configPath = path.join(import.meta.dirname, "../config.json");
    const raw = JSON.parse(fs.readFileSync(configPath, "utf8")) as RawBotConfig;

    if (!raw.token || raw.token === "TOKEN_ICI") {
      console.error(
        "❌ Erreur Config : Le token Discord est manquant ou invalide",
      );
      process.exit(1);
    }
    if (!raw.guildId || raw.guildId === "ID_DU_SERVEUR") {
      console.error("❌ Erreur Config : Le guildId est manquant ou invalide");
      process.exit(1);
    }
    if (!raw.clientId || raw.clientId === "ID_DU_BOT") {
      console.error("❌ Erreur Config : Le clientId est manquant ou invalide");
      process.exit(1);
    }

    console.log("✅ Configuration chargée et validée");

    return {
      token: raw.token,
      clientId: raw.clientId,
      guildId: raw.guildId,
      roles: raw.roles ?? {},
      channels: raw.channels ?? {},
      ignoredChannels: Array.isArray(raw.ignoredChannels)
        ? raw.ignoredChannels
        : [],
      cooldown: raw.cooldown ?? 60000,
      inactivityDays: raw.inactivityDays ?? 90,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("❌ Erreur lors du chargement de config.json :", message);
    console.error(
      "💡 Assurez-vous que config.json existe et est valide (voir config.json.example)",
    );
    process.exit(1);
  }
}

export const config: BotConfig = loadConfig();
