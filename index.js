const { Client, GatewayIntentBits, Partials, ActivityType } = require('discord.js');
const express = require('express');
require('dotenv').config();

// Initialisation du Client avec les Intents et Partials requis
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildBans
    ],
    partials: [Partials.Message, Partials.Channel, Partials.GuildMember]
});

// ==========================================
// 📌 GESTION DE LA MÉMOIRE ET ÉTATS GLOBAUX
// ==========================================
client.isLockdown = false;
client.spamTracker = new Map(); // userID -> { count, firstMsgTime, warns }

// ==========================================
// 📦 IMPORT DES MODULES ET ÉVÉNEMENTS
// ==========================================
const guildMemberAdd = require('./events/guildMemberAdd');
const messageCreate = require('./events/messageCreate');
const antiNuke = require('./modules/antiNuke');

// ==========================================
// 🚀 ÉVÉNEMENT : BOT PRÊT (clientReady)
// ==========================================
client.once('clientReady', (c) => {
    console.log(`\n==========================================`);
    console.log(`✅ [TEAM HELORIA FORTRESS] Connecté avec succès en tant que : ${c.user.tag}`);
    console.log(`🛡️  Système de Protection : Opérationnel`);
    console.log(`==========================================\n`);

    // Initialisation de l'Anti-Nuke
    antiNuke(client);

    // 🎭 GESTION DU STATUT INACTIF & ACTIVITÉ
    client.user.setPresence({
        activities: [{ name: 'Dev par Logs', type: ActivityType.Custom }],
        status: 'invisible' // Statut Inactif / Hors-ligne
    });
});

// ==========================================
// 📡 ÉCOUTEURS D'ÉVÉNEMENTS
// ==========================================
client.on('guildMemberAdd', (member) => guildMemberAdd(client, member));
client.on('messageCreate', (message) => messageCreate(client, message));

// ==========================================
// 🌐 SERVEUR EXPRESS (FIX RENDER PORT TIMEOUT)
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('🛡️ Team HeLoRiA Fortress Bot est 100% en ligne !');
});

app.listen(PORT, () => {
    console.log(`🌐 [Render WebServer] Serveur web actif sur le port ${PORT}`);
});

// ==========================================
// 🛡️ SÉCURITÉ ANTI-CRASH (Évite l'arrêt du bot)
// ==========================================
process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ [Anti-Crash] Rejet non géré :', reason);
});

process.on('uncaughtException', (err, origin) => {
    console.error('⚠️ [Anti-Crash] Exception non capturée :', err);
});

// Connexion au Token Discord
client.login(process.env.DISCORD_TOKEN);