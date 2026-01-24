# 🤖 Bot d'Activité Communautaire

Un bot Discord fait maison pour animer notre serveur, suivre l'activité des membres et récompenser les plus présents !

## ✨ Fonctionnalités

- 📊 **Tracking d'activité** : Compte les messages, les réactions et les fichiers partagés.
- 🏆 **Membre du Mois** : Elit automatiquement le membre le plus actif chaque 1er du mois.
- 💤 **Gestion d'inactivité** : Attribue un rôle "Inactif" après 90 jours sans nouvelles.
- 🛡️ **Respect de la vie privée** : Commande `/privacy` pour activer/désactiver son propre suivi.
- ⚙️ **Outils Admin** : Scan profond de l'historique et rapports d'inactivité en format .txt.

## 🚀 Installation

### 1. Configuration Discord

1. Créez une application sur le [Discord Developer Portal](https://discord.com/developers/applications).
2. **Bot** : Activez impérativement les 3 **Privileged Intents** (_Presence_, _Server Members_, _Message Content_).
3. **OAuth2** : Générez un lien d'invitation avec :
   - Scopes : `bot` + `applications.commands`
   - Permissions : _Manage Roles, View Channels, Send Messages, Embed Links, Attach Files, Read History_.
4. Invitez le bot sur votre serveur.

### 2. Setup Technique

```bash
git clone https://github.com/atKarl/Naobot
cd naobot
npm install
cp config.json.example config.json
```

### 3. Lancement

Renommez config.json.example en config.json et remplissez le avec vos IDs (Token, GuildID, Rôles...), puis exécutez :

```bash
node deploy-commands.js  # Enregistre les commandes (/)

node index.js            # Lance le bot (ou pm2 start index.js en production)
```

⚠️ Note importante : Dans les paramètres de votre serveur Discord, placez le rôle du bot tout en haut de la liste (au-dessus des rôles "Inactif" et "Membre du Mois") pour qu'il puisse les gérer sans erreur de permission.

## 🛠️ Stack Technique

- **Langage** : JavaScript (Node.js)
- **Librairie** : Discord.js v14
- **Base de données** : SQLite (via better-sqlite3)
- **Planification** : Node-cron
