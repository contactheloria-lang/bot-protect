const { Client, GatewayIntentBits, Partials, ActivityType } = require('discord.js');
const express = require('express');
require('dotenv').config();

// Initialisation du Client avec TOUS les Intents et Partials nécessaires (y compris MP pour ModMail)
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildBans,
        GatewayIntentBits.DirectMessages // Nécessaire pour le module ModMail
    ],
    partials: [
        Partials.Message, 
        Partials.Channel, 
        Partials.GuildMember
    ]
});

// ==========================================
// 📌 GESTION DE LA MÉMOIRE ET ÉTATS GLOBAUX
// ==========================================
client.isLockdown = false;
client.spamTracker = new Map();

// ==========================================
// 📦 IMPORT DES MODULES
// ==========================================
const { processHeatSpam } = require('./modules/heatEngine');
const { handleJoinGate } = require('./modules/joinGate');
const { initAntiNuke } = require('./modules/antiNuke');
const { handleModMail, handleStaffCommands } = require('./modules/modMail');

// ==========================================
// 🚀 ÉVÉNEMENT : BOT PRÊT (ready)
// ==========================================
client.once('ready', (c) => {
    console.log(`\n==========================================`);
    console.log(`✅ [TEAM HELORIA FORTRESS] Connecté en tant que : ${c.user.tag}`);
    console.log(`🛡️  Systèmes Anti-Spam, JoinGate, Anti-Nuke & ModMail : Opérationnels`);
    console.log(`==========================================\n`);

    // Initialisation du module Anti-Nuke
    initAntiNuke(client);

    // ==========================================
    // 🎭 CONFIGURATION DU STATUT ET DE L'ACTIVITÉ
    // ==========================================
    // Options pour 'status' : 'online' (En ligne), 'idle' (Inactif), 'dnd' (Ne pas déranger), 'invisible' (Masqué)
    // Options pour 'type'   : ActivityType.Playing, ActivityType.Streaming, ActivityType.Listening, ActivityType.Watching, ActivityType.Competing, ActivityType.Custom

    client.user.setPresence({
        status: 'online', // Changez ici selon votre préférence ('online', 'idle', 'dnd', 'invisible')
        activities: [
            {
                name: '🛡️ Protection Fortress V2 | /help',
                type: ActivityType.Custom
            }
        ]
    });
});

// ==========================================
// 📡 ÉCOUTEURS D'ÉVÉNEMENTS
// ==========================================

// 1. Filtrage aux entrées (JoinGate / Anti-Raid / Anti-Bot)
client.on('guildMemberAdd', async (member) => {
    await handleJoinGate(client, member);
});

// 2. Traitement des messages (Anti-Spam Heat Engine & ModMail)
client.on('messageCreate', async (message) => {
    // Évite les boucles avec d'autres bots
    if (message.author.bot) return;

    // Gestion des Messages Privés (ModMail)
    if (!message.guild) {
        await handleModMail(client, message);
        return;
    }

    // Gestion des commandes Staff dans les salons ModMail (!reply, !close)
    await handleStaffCommands(client, message);

    // Moteur Anti-Spam (Heat Engine)
    await processHeatSpam(client, message);
});

// ==========================================
// 🌐 SERVEUR EXPRESS (Fix Render Port Timeout)
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
// 🛡️ SÉCURITÉ ANTI-CRASH
// ==========================================
process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ [Anti-Crash] Rejet non géré :', reason);
});

process.on('uncaughtException', (err, origin) => {
    console.error('⚠️ [Anti-Crash] Exception non capturée :', err);
});

// Connexion au Token Discord
client.login(process.env.DISCORD_TOKEN);