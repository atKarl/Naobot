import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Collection } from "discord.js";
import type { SlashCommand } from "../types.ts";

export async function loadCommands(): Promise<
  Collection<string, SlashCommand>
> {
  const commands = new Collection<string, SlashCommand>();
  const folders = fs
    .readdirSync(import.meta.dirname, { withFileTypes: true })
    .filter((entry) => entry.isDirectory());

  for (const folder of folders) {
    const commandsPath = path.join(import.meta.dirname, folder.name);
    const commandFiles = fs
      .readdirSync(commandsPath)
      .filter((file) => file.endsWith(".ts") && !file.endsWith(".d.ts"));

    for (const file of commandFiles) {
      const filePath = path.join(commandsPath, file);
      const mod = (await import(
        pathToFileURL(filePath).href
      )) as Partial<SlashCommand>;

      if ("data" in mod && "execute" in mod && mod.data && mod.execute) {
        commands.set(mod.data.name, {
          data: mod.data,
          execute: mod.execute,
        });
      } else {
        console.warn(
          `[AVERTISSEMENT] La commande à ${filePath} est incomplète.`,
        );
      }
    }
  }

  return commands;
}
