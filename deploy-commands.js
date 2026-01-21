const { REST, Routes } = require("discord.js");
const config = require("./config.json");
const fs = require("fs");
const path = require("path");

const commands = [];
const foldersPath = path.join(__dirname, "src/commands");
const commandFolders = fs.readdirSync(foldersPath);

console.log("Lecture des commandes en cours...");

// 1. Parcours des sous-dossiers (admin, public...)
for (const folder of commandFolders) {
  const commandsPath = path.join(foldersPath, folder);
  const commandFiles = fs
    .readdirSync(commandsPath)
    .filter((file) => file.endsWith(".js"));

  // 2. Chargement des fichiers de commande
  for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);

    if ("data" in command && "execute" in command) {
      commands.push(command.data.toJSON());
      console.log(` -> Chargé : ${command.data.name}`);
    } else {
      console.log(`[AVERTISSEMENT] La commande à ${filePath} est incomplète.`);
    }
  }
}

const rest = new REST({ version: "10" }).setToken(config.token);

(async () => {
  try {
    console.log(
      `Début du rafraîchissement de ${commands.length} commandes (/)`
    );

    await rest.put(
      Routes.applicationGuildCommands(config.clientId, config.guildId),
      { body: commands }
    );

    console.log("✅ Commandes enregistrées avec succès !");
  } catch (error) {
    console.error("❌ Erreur lors de l'enregistrement :", error);
  }
})();
