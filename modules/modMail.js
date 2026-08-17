const { 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    PermissionsBitField, 
    ChannelType 
} = require("discord.js");
const fs = require("fs");
const path = require("path");

const DATA_PATH = path.join(__dirname, "../data/modmail_data.json");
const CONFIG_PATH = path.join(__dirname, "../data/fortress_config.json");

// Chargement et sauvegarde des états de tickets
function loadData() {
    if (!fs.existsSync(DATA_PATH)) return { tickets: [], blacklist: [] };
    try { return JSON.parse(fs.readFileSync(DATA_PATH, "utf-8")); } 
    catch { return { tickets: [], blacklist: [] }; }
}

function saveData(data) {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
}

function getConfig() {
    if (!fs.existsSync(CONFIG_PATH)) return null;
    try { return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")); } 
    catch { return null; }
}

/**
 * 01-44 : Réception d'un DM et gestion/création du ticket ModMail
 */
async function handleDirectMessage(client, message) {
    if (message.author.bot || message.guild) return;

    const data = loadData();
    const config = getConfig();
    if (!config || !config.guildId) return;

    if (data.blacklist.includes(message.author.id)) {
        return message.reply("❌ Vous n'êtes pas autorisé à contacter le support.").catch(() => {});
    }

    const guild = await client.guilds.fetch(config.guildId).catch(() => null);
    if (!guild) return;

    const ownerId = guild.ownerId;
    let ticket = data.tickets.find(t => t.userId === message.author.id && t.status === "OPEN");

    // Création instantanée du ticket si aucun ticket actif
    if (!ticket) {
        let category = guild.channels.cache.get(config.modmailCategoryId);
        if (!category) {
            category = await guild.channels.create({
                name: "📁 MODMAIL / CONTACT",
                type: ChannelType.GuildCategory,
                permissionOverwrites: [
                    { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] }
                ]
            }).catch(() => null);
            if (category && config) config.modmailCategoryId = category.id;
        }

        // Création du salon privé avec accès restrictif (Propriétaire uniquement)
        const channelName = `ticket-${message.author.username.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
        const ticketChannel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            parent: category ? category.id : null,
            permissionOverwrites: [
                { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { 
                    id: ownerId, 
                    allow: [
                        PermissionsBitField.Flags.ViewChannel, 
                        PermissionsBitField.Flags.SendMessages, 
                        PermissionsBitField.Flags.AttachFiles
                    ] 
                }
            ]
        }).catch(() => null);

        if (!ticketChannel) {
            return message.reply("❌ Impossible d'ouvrir un ticket actuellement. Réessayez plus tard.").catch(() => {});
        }

        ticket = {
            id: `TCK-${Date.now().toString().slice(-6)}`,
            userId: message.author.id,
            channelId: ticketChannel.id,
            status: "OPEN",
            createdAt: new Date().toISOString(),
            lastActivity: new Date().toISOString()
        };
        data.tickets.push(ticket);
        saveData(data);

        // Envoi du message automatique d'accueil au membre
        const welcomeEmbed = new EmbedBuilder()
            .setColor("#2B2D31")
            .setTitle("Dossier de contact ouvert")
            .setDescription(
                "Votre message a bien été transmis. " +
                "Ce dossier est strictement confidentiel et accessible uniquement par le propriétaire du serveur. " +
                "Un délai de réponse peut être nécessaire."
            );
        await message.author.send({ embeds: [welcomeEmbed] }).catch(() => {});

        // Notification du ticket dans le salon privé du propriétaire
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`modmail_close_${ticket.id}`)
                .setLabel("Fermer le ticket")
                .setStyle(ButtonStyle.Danger)
        );

        const infoEmbed = new EmbedBuilder()
            .setColor("#5865F2")
            .setTitle(`🛡️ DOSSIER DE CONTACT : ${ticket.id}`)
            .addFields(
                { name: "Membre", value: `${message.author.tag} (\`${message.author.id}\`)`, inline: true },
                { name: "Création du compte", value: `<t:${Math.floor(message.author.createdTimestamp / 1000)}:R>`, inline: true }
            )
            .setTimestamp();

        await ticketChannel.send({ content: `<@${ownerId}>`, embeds: [infoEmbed], components: [row] }).catch(() => {});
    }

    // 11-24 : Transmission du message au salon du ticket
    const ticketChannel = guild.channels.cache.get(ticket.channelId);
    if (ticketChannel) {
        const files = message.attachments.map(a => a.url);
        const forwardEmbed = new EmbedBuilder()
            .setColor("#00FF00")
            .setAuthor({ name: message.author.tag, iconURL: message.author.displayAvatarURL() })
            .setDescription(message.content || "*[Aucun texte]*")
            .setTimestamp();

        await ticketChannel.send({ embeds: [forwardEmbed], files }).catch(() => {});
        
        ticket.lastActivity = new Date().toISOString();
        saveData(data);
        await message.react("✅").catch(() => {});
    }
}

/**
 * 64-72 : Transmettre les messages du salon privé vers le membre en DM
 */
async function handleChannelMessage(client, message) {
    if (message.author.bot || !message.guild || message.content.startsWith("!")) return;

    const data = loadData();
    const ticket = data.tickets.find(t => t.channelId === message.channel.id && t.status === "OPEN");
    if (!ticket) return;

    const member = await message.guild.members.fetch(ticket.userId).catch(() => null);
    if (!member) {
        return message.reply("⚠️ Le membre a quitté le serveur. Impossible de transmettre le message.").catch(() => {});
    }

    const files = message.attachments.map(a => a.url);
    const replyEmbed = new EmbedBuilder()
        .setColor("#5865F2")
        .setAuthor({ name: "Réponse du Propriétaire", iconURL: message.author.displayAvatarURL() })
        .setDescription(message.content || "*[Aucun texte]*")
        .setTimestamp();

    const sent = await member.send({ embeds: [replyEmbed], files }).catch(() => null);
    if (sent) {
        await message.react("📤").catch(() => {});
        ticket.lastActivity = new Date().toISOString();
        saveData(data);
    } else {
        await message.reply("❌ Échec de l'envoi en DM (Messages privés fermés par l'utilisateur).").catch(() => {});
    }
}

/**
 * 131-140 : Gestion des commandes préfixées (!ticket, !close, etc.)
 */
async function handleCommands(client, message) {
    if (message.author.bot || !message.guild || !message.content.startsWith("!")) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    const data = loadData();

    // Commandes réservées au propriétaire du serveur
    if (message.author.id !== message.guild.ownerId) return;

    // Commandes : !close ou !ticket close
    if (command === "close" || (command === "ticket" && args[0] === "close")) {
        const ticket = data.tickets.find(t => t.channelId === message.channel.id && t.status === "OPEN");
        if (!ticket) return message.reply("❌ Ce salon n'est pas un ticket ModMail actif.");

        await closeTicket(client, message.guild, ticket, message.author, "Fermeture manuelle par commande.");
    }

    // Commande : !reopen <ticketId>
    if (command === "reopen" || (command === "ticket" && args[0] === "reopen")) {
        const ticketId = args[1] || args[0];
        const ticket = data.tickets.find(t => t.id === ticketId);

        if (!ticket) return message.reply("❌ Ticket introuvable.");
        ticket.status = "OPEN";
        saveData(data);

        return message.reply(`🔓 Le ticket **${ticket.id}** a été réouvert.`);
    }

    // Commande : !blacklist <userId>
    if (command === "blacklist" || (command === "ticket" && args[0] === "blacklist")) {
        const targetId = args[1] || args[0];
        if (!targetId || data.blacklist.includes(targetId)) {
            return message.reply("⚠️ Utilisateur invalide ou déjà dans la liste noire.");
        }

        data.blacklist.push(targetId);
        saveData(data);
        return message.reply(`🚫 L'utilisateur \`${targetId}\` ne peut plus ouvrir de ticket.`);
    }

    // Commande : !unblacklist <userId>
    if (command === "unblacklist" || (command === "ticket" && args[0] === "unblacklist")) {
        const targetId = args[1] || args[0];
        data.blacklist = data.blacklist.filter(id => id !== targetId);
        saveData(data);
        return message.reply(`✅ L'utilisateur \`${targetId}\` a été retiré de la liste noire.`);
    }
}

/**
 * 73-84 : Procédure de fermeture d'un ticket ModMail
 */
async function closeTicket(client, guild, ticket, closedBy, reason = "Aucun motif spécifié") {
    const data = loadData();
    ticket.status = "CLOSED";
    ticket.closedAt = new Date().toISOString();
    ticket.closedBy = closedBy.id;
    saveData(data);

    const member = await guild.members.fetch(ticket.userId).catch(() => null);
    if (member) {
        const closeEmbed = new EmbedBuilder()
            .setColor("#FF0000")
            .setTitle("Dossier fermé")
            .setDescription(`Votre dossier de contact **${ticket.id}** a été fermé.\nMotif : ${reason}`);
        await member.send({ embeds: [closeEmbed] }).catch(() => {});
    }

    const channel = guild.channels.cache.get(ticket.channelId);
    if (channel) {
        await channel.send(`🔒 **DOSSIER FERMÉ** par ${closedBy.tag}. Suppression du salon dans 5 secondes...`).catch(() => {});
        setTimeout(() => channel.delete().catch(() => {}), 5000);
    }
}

/**
 * Gestion des boutons de fermetures
 */
async function handleInteraction(client, interaction) {
    if (!interaction.isButton()) return;

    if (interaction.customId.startsWith("modmail_close_")) {
        const ticketId = interaction.customId.replace("modmail_close_", "");
        const data = loadData();
        const ticket = data.tickets.find(t => t.id === ticketId);

        if (!ticket) {
            return interaction.reply({ content: "❌ Ticket introuvable.", ephemeral: true });
        }

        await interaction.reply({ content: "🔒 Fermeture du dossier en cours..." });
        await closeTicket(client, interaction.guild, ticket, interaction.user, "Fermeture via le bouton.");
    }
}

module.exports = {
    handleDirectMessage,
    handleChannelMessage,
    handleCommands,
    handleInteraction
};
