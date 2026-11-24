import { REST, Routes } from "discord.js";
import { config } from "./src/config.ts";
import { loadCommands } from "./src/commands/loader.ts";

console.log("Lecture des commandes en cours...");

const loadedCommands = await loadCommands();
const commands = [...loadedCommands.values()].map((command) => {
  console.log(` -> Chargé : ${command.data.name}`);
  return command.data.toJSON();
});

const rest = new REST({ version: "10" }).setToken(config.token);

try {
  console.log(
    `Début du rafraîchissement de ${commands.length} commandes (/)`,
  );

  await rest.put(
    Routes.applicationGuildCommands(config.clientId, config.guildId),
    { body: commands },
  );

  console.log("✅ Commandes enregistrées avec succès !");
} catch (error) {
  console.error("❌ Erreur lors de l'enregistrement :", error);
  process.exit(1);
}
