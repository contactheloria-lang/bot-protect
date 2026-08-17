const { Client, GatewayIntentBits, Partials, ActivityType } = require('discord.js');
const express = require('express');
require('dotenv').config();

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

// Import des modules de sécurité
const { processHeatSpam } = require('./modules/heatEngine');
const { handleAntiRaid } = require('./modules/antiRaid');
const { initAntiNuke } = require('./modules/antiNuke');

client.once('ready', (c) => {
    console.log(`\n🚨 [BOT PROTECT] Mode Maintenance Indéterminé sous : ${c.user.tag}`);

    // Initialisation de la surveillance réseau
    if (typeof initAntiNuke === 'function') initAntiNuke(client);

    // Statut permanent de maintenance
    client.user.setPresence({
        status: 'dnd',
        activities: [{
            name: '🚨 SERVEUR EN PANNE | Protection en maintenance',
            type: ActivityType.Custom
        }]
    });
});

client.on('guildMemberAdd', async (member) => {
    if (typeof handleAntiRaid === 'function') await handleAntiRaid(client, member);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    // Blocage du chat si l'utilisateur n'est pas Administrateur
    if (!message.member.permissions.has("Administrator")) {
        await message.delete().catch(() => {});
        return;
    }

    if (typeof processHeatSpam === 'function') await processHeatSpam(client, message);
});

// Serveur Web Express
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('🚨 Bot Protect - Maintenance'));
app.listen(PORT, () => console.log(`🌐 [Bot Protect] Actif sur le port ${PORT}`));

process.on('unhandledRejection', err => console.error('⚠️ Rejet non géré :', err));
process.on('uncaughtException', err => console.error('⚠️ Exception non capturée :', err));

client.login(process.env.DISCORD_TOKEN);
