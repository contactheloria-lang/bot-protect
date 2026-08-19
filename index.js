const { Client, GatewayIntentBits, Partials, ActivityType } = require('discord.js');
const express = require('express');
require('dotenv').config();

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

// Importation des modules
const { processHeatSpam } = require('./modules/heatEngine');
const { handleAntiRaid } = require('./modules/antiRaid');
const { initAntiNuke } = require('./modules/antiNuke');
const { handleModMail, handleStaffCommands } = require('./modules/modMail');
const initHoneypot = require('./modules/honeypot'); // Module Honeypot

client.once('ready', (c) => {
    console.log(`\n==========================================`);
    console.log(`✅ [HELORIA FORTRESS] Connecté sous : ${c.user.tag}`);
    console.log(`🛡️  Systèmes Anti-Spam, Anti-Raid, Anti-Nuke, ModMail & Honeypot : Actifs`);
    console.log(`==========================================\n`);

    initAntiNuke(client);
    initHoneypot(client); // Initialisation du Honeypot

    client.user.setPresence({
        status: 'dnd',
        activities: [
            {
                name: '🔒 Sécurisation du serveur | Support : MP',
                type: ActivityType.Custom
            }
        ]
    });
});

client.on('guildMemberAdd', async (member) => {
    await handleAntiRaid(client, member);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (!message.guild) {
        await handleModMail(client, message);
        return;
    }

    await handleStaffCommands(client, message);
    await processHeatSpam(client, message);
});

// Serveur Web Express
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('🛡️ Le système de protection HeLoRiA Fortress est pleinement opérationnel.');
});

app.listen(PORT, () => {
    console.log(`🌐 [Serveur Web] Écoute active sur le port ${PORT}`);
});

process.on('unhandledRejection', (reason) => {
    console.error('⚠️ [Anti-Crash] Rejet non géré :', reason);
});

process.on('uncaughtException', (err) => {
    console.error('⚠️ [Anti-Crash] Exception non capturée :', err);
});

client.login(process.env.DISCORD_TOKEN);
