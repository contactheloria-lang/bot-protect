const { EmbedBuilder, AuditLogEvent } = require("discord.js");
const fs = require("fs");
const path = require("path");

// Configuration des salons de logs (récupère l'ID ou prend celui par défaut)
const LOGS_ANTI_RAID_ID = process.env.LOGS_ANTI_RAID_ID || "1534142396491628604";
const LOGS_ANTI_BOT_ID = process.env.LOGS_ANTI_BOT_ID || "1534142397670359050";
const DB_PATH = path.join(__dirname, "../data", "fortress_antispam_db.json");
const OWNER_ID = process.env.OWNER_ID || "1431661348218998948";

module.exports = async (client, member) => {
    // Initialise la Map si elle n'existe pas sur le client
    if (!client.captchaSessions) {
        client.captchaSessions = new Map();
    }

    const createdTimestamp = Math.floor(member.user.createdTimestamp / 1000);
    const nowTimestamp = Math.floor(Date.now() / 1000);
    const oneDayInSeconds = 86400;
    const server = member.guild;

    // --- 1. SÉCURITÉ ANTI-BOT STRICT ---
    if (member.user.bot) {
        const logs = await server.fetchAuditLogs({ limit: 1, type: AuditLogEvent.BotAdd }).catch(() => null);
        const logEntry = logs?.entries.first();
        const executor = logEntry?.executor;

        // Si le bot a été ajouté par un membre non autorisé
        if (executor && executor.id !== OWNER_ID && executor.id !== server.ownerId) {
            await member.ban({ reason: "[ANTI-BOT] Bot non autorisé" }).catch(() => {});

            // Log de détection Anti-Bot
            const botLogEmbed = new EmbedBuilder()
                .setColor("#b71c1c")
                .setTitle("🤖 TENTATIVE D'INVITATION DE BOT BLOQUÉE")
                .addFields(
                    { name: "🤖 Bot Banni", value: `${member.user.tag} (\`${member.id}\`)`, inline: true },
                    { name: "👤 Invité par", value: `<@${executor.id}> (\`${executor.id}\`)`, inline: true },
                    { name: "📅 Date & Heure", value: `<t:${nowTimestamp}:F>`, inline: false }
                )
                .setFooter({ text: "Akora Fortress Security", iconURL: client.user.displayAvatarURL() });

            const botLogChan = await client.channels.fetch(LOGS_ANTI_BOT_ID).catch(() => null);
            if (botLogChan) botLogChan.send({ embeds: [botLogEmbed] }).catch(() => {});
        }
        return;
    }

    // --- 2. DÉTECTION ANTI-ALT (< 24 HEURES) ---
    if ((nowTimestamp - createdTimestamp) < oneDayInSeconds) {
        const unlockTimestamp = createdTimestamp + oneDayInSeconds;

        // MP au membre
        try {
            await member.send(
                `⚠️ **Accès refusé sur ${server.name}**\n` +
                `Ton compte est trop récent pour rejoindre ce serveur (moins d'un jour).\n` +
                `Tu pourras nous rejoindre <t:${unlockTimestamp}:R> (le <t:${unlockTimestamp}:F>).`
            );
        } catch (err) {
            console.log(`[Anti-Alt] MP bloqué pour ${member.user.tag}`);
        }

        // Expulsion du membre
        await member.kick('Compte trop récent (moins de 24h)').catch(console.error);

        // Envoi du log dans #logs-anti-raid
        const altLogEmbed = new EmbedBuilder()
            .setColor("#d32f2f")
            .setTitle("🛡️ COMPTE EXPULSÉ (ANTI-ALT)")
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: "👤 Membre Expulsé", value: `${member.user} (\`${member.user.username}\`)`, inline: true },
                { name: "🆔 ID Membre", value: `\`${member.id}\``, inline: true },
                { name: "📅 Création du Compte", value: `<t:${createdTimestamp}:F>`, inline: false },
                { name: "🕒 Expulsé le", value: `<t:${nowTimestamp}:F>`, inline: false }
            )
            .setFooter({ text: "Akora Fortress Anti-Raid", iconURL: client.user.displayAvatarURL() })
            .setTimestamp();

        const raidLogChan = await client.channels.fetch(LOGS_ANTI_RAID_ID).catch(() => null);
        if (raidLogChan) raidLogChan.send({ embeds: [altLogEmbed] }).catch(() => {});

        return;
    }

    // --- 3. CAPTCHA MATHÉMATIQUE PAR MP ---
    const num1 = Math.floor(Math.random() * 10) + 1;
    const num2 = Math.floor(Math.random() * 10) + 1;
    const result = num1 + num2;

    // Stockage de la réponse
    client.captchaSessions.set(member.id, {
        result: result,
        guildId: server.id
    });

    try {
        await member.send(
            `👋 Bienvenue sur **${server.name}** !\n` +
            `Pour débloquer l'accès au serveur, réponds à ce message avec le résultat de l'opération : **${num1} + ${num2} = ?**`
        );
    } catch (err) {
        console.log(`[Captcha] Impossible d'envoyer le MP à ${member.user.tag}`);
    }
};