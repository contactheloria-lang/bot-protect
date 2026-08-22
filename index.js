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

// MODULES EN PAUSE POUR LA MAINTENANCE
// const { processHeatSpam } = require('./modules/heatEngine');
// const { handleAntiRaid } = require('./modules/antiRaid');
// const { initAntiNuke } = require('./modules/antiNuke');
// const { handleModMail, handleStaffCommands } = require('./modules/modMail');
// const initHoneypot = require('./modules/honeypot');

client.once('ready', (c) => {
    console.log(`\n==========================================`);
    console.log(`🛠️ [HELORIA FORTRESS] Connecté sous : ${c.user.tag}`);
    console.log(`⚠️  Systèmes de protection suspendus (Mode Maintenance)`);
    console.log(`==========================================\n`);

    client.user.setPresence({
        status: 'dnd',
        activities: [
            {
                name: '🛠️ Maintenance Protect | Systèmes en pause',
                type: ActivityType.Custom
            }
        ]
    });
});

// Neutralisation des événements pendant la maintenance
client.on('guildMemberAdd', async (member) => {
    // Anti-Raid suspendu
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    // ModMail, Anti-Spam et commandes Staff suspendus
});

// Bloquer d'éventuelles commandes d'interactions
client.on('interactionCreate', async (interaction) => {
    if (interaction.isCommand() || interaction.isButton()) {
        return interaction.reply({
            content: "🛠️ **Le bot Protect est actuellement en maintenance.** Les commandes de sécurité sont temporairement désactivées.",
            ephemeral: true
        }).catch(() => {});
    }
});

// Serveur Web Express
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('🛠️ Le système HeLoRiA Protect est actuellement en mode maintenance.');
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
