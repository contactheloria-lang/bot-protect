const { Client, GatewayIntentBits, Partials, ActivityType } = require('discord.js');
const express = require('express');
require('dotenv').config();

// Initialisation du client avec l'intégralité des intents et partials requis
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildBans,
        GatewayIntentBits.DirectMessages
    ],
    partials: [
        Partials.Message, 
        Partials.Channel, 
        Partials.GuildMember
    ]
});

// État global du bot
client.isLockdown = false;
client.spamTracker = new Map();

// ==========================================
// 📦 IMPORTATION DES 4 MODULES DU DOSSIER
// ==========================================
const { processHeatSpam } = require('./modules/heatEngine');
const { handleAntiRaid } = require('./modules/antiRaid');
const { initAntiNuke } = require('./modules/antiNuke');
const { handleModMail, handleStaffCommands } = require('./modules/modMail');

// ==========================================
// 🚀 ÉVÉNEMENT : BOT PRÊT (Ready)
// ==========================================
client.once('ready', (c) => {
    console.log(`\n==========================================`);
    console.log(`✅ [HELORIA FORTRESS] Connecté sous : ${c.user.tag}`);
    console.log(`🛡️  Systèmes Anti-Spam, Anti-Raid, Anti-Nuke & ModMail : Actifs`);
    console.log(`==========================================\n`);

    // Démarrage de la surveillance globale Anti-Nuke
    initAntiNuke(client);

    // Statut professionnel en français
    client.user.setPresence({
        status: 'dnd', // Ne Pas Déranger
        activities: [
            {
                name: '🔒 Sécurisation du serveur | Support : MP',
                type: ActivityType.Custom
            }
        ]
    });
});

// ==========================================
// 📡 ÉCOUTEURS D'ÉVÉNEMENTS
// ==========================================

// 1. Détection aux entrées (Anti-Raid / JoinGate / Anti-Bot)
client.on('guildMemberAdd', async (member) => {
    await handleAntiRaid(client, member);
});

// 2. Traitement des messages (Anti-Spam & ModMail)
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // Messages Privés -> Support ModMail
    if (!message.guild) {
        await handleModMail(client, message);
        return;
    }

    // Commandes Staff dans les tickets (!reply, !close, !bunker)
    await handleStaffCommands(client, message);

    // Filtre Anti-Spam dynamique
    await processHeatSpam(client, message);
});

// ==========================================
// 🌐 SERVEUR WEB EXPRESS (Keep-Alive Render)
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('🛡️ Le système de protection HeLoRiA Fortress est pleinement opérationnel.');
});

app.listen(PORT, () => {
    console.log(`🌐 [Serveur Web] Écoute active sur le port ${PORT}`);
});

// ==========================================
// 🛡️ PROTECTION ANTI-CRASH
// ==========================================
process.on('unhandledRejection', (reason) => {
    console.error('⚠️ [Anti-Crash] Rejet non géré :', reason);
});

process.on('uncaughtException', (err) => {
    console.error('⚠️ [Anti-Crash] Exception non capturée :', err);
});

client.login(process.env.DISCORD_TOKEN);
