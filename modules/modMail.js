const { 
    EmbedBuilder, 
    ChannelType, 
    PermissionFlagsBits 
} = require("discord.js");
const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "../data/fortress_config.json");

// Buffer en mémoire pour suivre les tickets actifs (userId -> channelId)
const activeTickets = new Map();

function getConfig() {
    if (!fs.existsSync(CONFIG_PATH)) return null;
    try {
        return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
    } catch {
        return null;
    }
}

/**
 * Gère la réception des messages privés et le transfert vers le Staff
 */
async function handleModMail(client, message) {
    // Ne traiter que les MP des utilisateurs (pas les bots, ni les salons de serveurs)
    if (message.guild || message.author.bot) return;

    const config = getConfig();
    if (!config || !config.modMail?.enabled) return;

    const guild = await client.guilds.fetch(config.modMail.guildId).catch(() => null);
    if (!guild) return;

    const userId = message.author.id;
    let channelId = activeTickets.get(userId);
    let mailChannel = channelId ? await guild.channels.fetch(channelId).catch(() => null) : null;

    // 1. Si aucun ticket n'est ouvert, en créer un nouveau
    if (!mailChannel) {
        const category = config.modMail.categoryId 
            ? await guild.channels.fetch(config.modMail.categoryId).catch(() => null) 
            : null;

        mailChannel = await guild.channels.create({
            name: `ticket-${message.author.username}`,
            type: ChannelType.GuildText,
            parent: category ? category.id : null,
            topic: `Ticket ModMail de ${message.author.tag} (ID: ${userId})`,
            permissionOverwrites: [
                {
                    id: guild.roles.everyone.id,
                    deny: [PermissionFlagsBits.ViewChannel]
                },
                {
                    id: config.modMail.staffRoleId || guild.roles.everyone.id,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
                }
            ]
        }).catch(() => null);

        if (!mailChannel) {
            return message.reply("❌ Une erreur est survenue lors de l'ouverture de votre ticket support.");
        }

        activeTickets.set(userId, mailChannel.id);

        // Notification d'ouverture dans le nouveau salon Staff
        const initEmbed = new EmbedBuilder()
            .setColor("#2196F3")
            .setTitle("📩 NOUVEAU TICKET MODMAIL")
            .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: "👤 Membre", value: `${message.author} (\`${userId}\`)`, inline: true },
                { name: "📅 Compte créé le", value: `<t:${Math.floor(message.author.createdTimestamp / 1000)}:R>`, inline: true }
            )
            .setFooter({ text: "Utilisez la commande !reply pour répondre au membre." })
            .setTimestamp();

        await mailChannel.send({ embeds: [initEmbed] });
        await message.reply("✅ Votre message a été transmis à l'équipe de modération. Un modérateur vous répondra sous peu.");
    }

    // 2. Transférer le message du membre vers le salon du Staff
    const userEmbed = new EmbedBuilder()
        .setColor("#4CAF50")
        .setAuthor({ name: message.author.tag, iconURL: message.author.displayAvatarURL() })
        .setDescription(message.content.length > 0 ? message.content : "*[Aucun texte]*")
        .setTimestamp();

    // Gestion des pièces jointes / images
    if (message.attachments.size > 0) {
        const attachment = message.attachments.first();
        userEmbed.setImage(attachment.url);
    }

    await mailChannel.send({ embeds: [userEmbed] });
    await message.react("✅").catch(() => {});
}

/**
 * Traitement des commandes Staff dans le salon du ticket (!reply / !close)
 */
async function handleStaffCommands(client, message) {
    if (!message.guild || message.author.bot) return;

    const config = getConfig();
    if (!config || !config.modMail?.enabled) return;

    // Trouver l'ID du membre associé à ce salon
    let targetUserId = null;
    for (const [uId, cId] of activeTickets.entries()) {
        if (cId === message.channel.id) {
            targetUserId = uId;
            break;
        }
    }

    if (!targetUserId) return;

    // Commande : !reply [message]
    if (message.content.startsWith("!reply ")) {
        const replyText = message.content.slice(7).trim();
        if (!replyText) return message.reply("⚠️ Veuillez spécifier un message à envoyer.");

        const targetUser = await client.users.fetch(targetUserId).catch(() => null);
        if (!targetUser) return message.reply("❌ Impossible de trouver cet utilisateur.");

        const staffEmbed = new EmbedBuilder()
            .setColor("#2196F3")
            .setAuthor({ name: `Support - ${message.guild.name}`, iconURL: message.guild.iconURL() })
            .setDescription(replyText)
            .setTimestamp();

        await targetUser.send({ embeds: [staffEmbed] }).then(async () => {
            await message.react("📤");
        }).catch(() => {
            message.reply("❌ Impossible d'envoyer le message privé (MP fermés par l'utilisateur).");
        });
    }

    // Commande : !close
    if (message.content.startsWith("!close")) {
        const targetUser = await client.users.fetch(targetUserId).catch(() => null);

        if (targetUser) {
            const closeEmbed = new EmbedBuilder()
                .setColor("#E91E63")
                .setTitle("🔒 Ticket Fermé")
                .setDescription(`Votre ticket de support sur **${message.guild.name}** a été fermé par l'équipe de modération.`);

            await targetUser.send({ embeds: [closeEmbed] }).catch(() => {});
        }

        activeTickets.delete(targetUserId);
        await message.channel.send("🔒 **Fermeture du ticket dans 5 secondes...**");
        setTimeout(() => {
            message.channel.delete().catch(() => {});
        }, 5000);
    }
}

module.exports = { handleModMail, handleStaffCommands };