import type {
  ChatInputCommandInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";

export interface BotConfig {
  token: string;
  clientId: string;
  guildId: string;
  roles: {
    inactive?: string;
    activeOfMonth?: string;
  };
  channels: {
    announcement?: string;
    backups?: string;
    birthdays?: string;
    sortiesForum?: string;
  };
  ignoredChannels: string[];
  cooldown: number;
  inactivityDays: number;
}

export interface SlashCommand {
  data: {
    name: string;
    toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody;
  };
  execute: (interaction: ChatInputCommandInteraction) => Promise<unknown>;
}

export type ActivityLogType = "message" | "file" | "reaction";

export interface UserStats {
  count: number;
  lastActive: number | null;
  tracking: number;
}

export interface UserWeightedScore {
  score: number;
  lastActive: number | null;
  tracking: number;
}

export interface BirthdayEntry {
  user_id: string;
  username: string;
  day: number;
  month: number;
}

export interface TodayBirthdayEntry {
  user_id: string;
  username: string;
}

export interface WinnerHistoryEntry {
  user_id: string;
  username: string;
  month: number;
  year: number;
  score: number;
  timestamp: number;
}

export interface RecentWinnerEntry {
  user_id: string;
  month: number;
  year: number;
  score: number;
}

export interface TopUserWeightedRow {
  user_id: string;
  username: string;
  score: number;
}

export interface WinnerCandidate {
  user_id: string;
  username: string;
  rawScore: number;
  penalty: number;
  adjustedScore: number;
}

export interface InactiveUserRow {
  user_id: string;
  last_active_timestamp: number;
}

export interface UserTrackingRow {
  user_id: string;
  last_active_timestamp: number | null;
  tracking_enabled: number;
}

export interface UserActivityDetails {
  lastActive: number | null;
  tracking: number;
  lastByType: Record<ActivityLogType, number | null>;
  recentReactions: number[];
}

export interface BatchMessageEntry {
  userId: string;
  username: string;
  ts: number;
}

export interface RemoveUserResult {
  logs: number;
  user: number;
}
