# 🤖 Bot d'Activité Communautaire

Un bot Discord fait maison pour animer notre serveur, suivre l'activité des membres et récompenser les plus présents !

## ✨ Fonctionnalités
- 📊 **Tracking d'activité** : Compte les messages, les réactions et les fichiers partagés.
- 🏆 **Membre du Mois** : Elit automatiquement le membre le plus actif chaque 1er du mois.
- 💤 **Gestion d'inactivité** : Attribue un rôle "Inactif" après 90 jours sans nouvelles.
- 🛡️ **Respect de la vie privée** : Commande `/privacy` pour activer/désactiver son propre suivi (RGPD).
- ⚙️ **Outils Admin** : Scan profond de l'historique et rapports d'inactivité en format .txt.

## 🚀 Installation
1. Installez [Node.js](https://nodejs.org/) (v16.11.0+).
2. Clonez ce dépôt.
3. Installez les dépendances : `npm install`.
4. Copiez `config.json.example` vers `config.json` et remplissez vos infos.
5. Enregistrez les commandes : `node deploy-commands.js`.
6. Lancez le bot : `node index.js`.

## 🛠️ Stack Technique
- **Langage** : JavaScript (Node.js)
- **Librairie** : Discord.js v14
- **Base de données** : SQLite (via better-sqlite3)
- **Planification** : Node-cron