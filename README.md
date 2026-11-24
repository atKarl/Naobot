# 🤖 Bot d'Activité Communautaire

Un bot Discord fait maison pour animer notre serveur, suivre l'activité des membres et récompenser les plus présents !

## ✨ Fonctionnalités

- 📊 **Tracking d'activité** : Compte les messages, les réactions et les fichiers partagés (`/stats`, `/top`).
- 🏆 **Membre du Mois** : Élit automatiquement le membre le plus actif chaque 1er du mois avec historique (`/halloffame`).
- 🎂 **Anniversaires** : Liste persistante mise à jour automatiquement et annonces chaque matin à 09h00 (`/anniversaire`, `/anniversaire-supprimer`).
- 📅 **Sorties calendrier** : Détection des nouveaux fils du forum dédié et création d'événements Discord via modal interactif.
- 💤 **Gestion d'inactivité** : Attribue un rôle "Inactif" après 90 jours sans nouvelles (seuil configurable via `inactivityDays`).
- 🛡️ **Respect de la vie privée** : Commande `/privacy` pour activer/désactiver son propre suivi et suppression automatique des données au départ du serveur.
- ⚙️ **Outils Admin** : Consultation détaillée (`/activite`), scan profond (`/scan`), rapports d'inactivité (`/inactifs`), nettoyage DB (`/clean-db`), FAQ (`/post-faq`) et gestion staff des anniversaires.

## 🚀 Installation

### 1. Configuration Discord

1. Créez une application sur le [Discord Developer Portal](https://discord.com/developers/applications).
2. **Bot** : Activez impérativement les 2 **Privileged Intents** nécessaires (**_Server Members_** et **_Message Content_**).
3. **OAuth2** : Générez un lien d'invitation avec :
   - Scopes : `bot` + `applications.commands`
   - Permissions : _Manage Roles, Manage Events, View Channels, Send Messages, Send Messages in Threads, Manage Messages, Embed Links, Attach Files, Read Message History_.
4. Invitez le bot sur votre serveur.

### 2. Setup Technique

**Prérequis** : **Node.js ≥ 24** (exécution native de TypeScript sans étape de build).

```bash
git clone https://github.com/atKarl/Naobot
cd naobot
npm install
cp config.json.example config.json
```

### 3. Lancement

Renommez `config.json.example` en `config.json` et remplissez-le avec vos IDs (Token, GuildID, Rôles, Salons...), puis exécutez :

```bash
npm run typecheck # Vérifie les types TypeScript (tsc --noEmit)

npm run deploy    # Enregistre les commandes (/) via node deploy-commands.ts

npm start         # Lance le bot via node index.ts
```

En production avec PM2 :

```bash
pm2 start index.ts --interpreter node --name naobot
# En cas de mise à jour depuis une ancienne installation JS :
# pm2 delete naobot && pm2 start index.ts --interpreter node --name naobot && pm2 save
```

⚠️ Note importante : Dans les paramètres de votre serveur Discord, placez le rôle du bot tout en haut de la liste (au-dessus des rôles "Inactif" et "Membre du Mois") pour qu'il puisse les gérer sans erreur de permission.

## 🛠️ Stack Technique

- **Langage** : TypeScript (Node.js ≥ 24, exécution native sans build)
- **Librairie** : Discord.js v14
- **Base de données** : SQLite (via better-sqlite3)
- **Planification** : Node-cron
