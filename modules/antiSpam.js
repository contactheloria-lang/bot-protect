const { EmbedBuilder } = require("discord.js");
const fs = require("fs");
const path = require("path");

// Configuration du salon de logs Anti-Spam (ID configurable)
const LOGS_ANTI_SPAM_ID = process.env.LOGS_ANTI_SPAM_ID || "1532049373540651319";
const DB_PATH = path.join(__dirname, "../data", "fortress_antispam_db.json");
const OWNER_ID = process.env.OWNER_ID || "1431661348218998948";

// Mémoire temporaire
const userHistory = new Map(); // userId -> [{ content, timestamp }]
const userWarns = new Map();   // userId -> [timestamp] (Pour la récidive / Timeout)

/**
 * Nettoie l'historique d'un utilisateur
 */
function cleanHistory(userId, maxAgeMs = 10000) {
    const now = Date.now();
    const history = userHistory.get(userId) || [];
    const filtered = history.filter(msg => now - msg.timestamp < maxAgeMs);
    userHistory.set(userId, filtered);
    return filtered;
}

/**
 * Vérifie si le membre est immunisé (Owner, Admin, Whitelist DB)
 */
function isImmune(message) {
    if (message.author.id === OWNER_ID || message.author.id === message.guild.ownerId) return true;
    if (message.member?.permissions.has("Administrator")) return true;

    if (fs.existsSync(DB_PATH)) {
        try {
            const db = JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
            if (db.whitelist && db.whitelist.includes(message.author.id)) return true;
        } catch (e) {}
    }
    return false;
}

module.exports = async function handleAntiSpam(client, message) {
    if (message.author.bot || !message.guild) return false;
    if (isImmune(message)) return false;

    const userId = message.author.id;
    const content = message.content;
    const now = Date.now();

    // 1. Enregistrement dans l'historique
    const history = cleanHistory(userId, 10000);
    history.push({ content, timestamp: now });
    userHistory.set(userId, history);

    let isViolation = false;
    let reason = "";

    // --- RÈGLE 1 : Fast Spam (Vitesse de frappe > 5 msgs / 5s) ---
    const recentFastMsgs = history.filter(m => now - m.timestamp < 5000);
    if (recentFastMsgs.length >= 5) {
        isViolation = true;
        reason = "Vitesse d'envoi excessive (Fast Spam)";
    }

    // --- RÈGLE 2 : Anti-Link & Anti-Scam ---
    const discordInviteRegex = /(discord\.(gg|io|me|li)|discordapp\.com\/invite|discord\.com\/invite)\/[a-zA-Z0-9]+/gi;
    const scamDomainsRegex = /(steamcommunlity|nitro-gift|free-nitro|disc0rd|discord-app|steamcommunnity)/gi;

    if (!isViolation && discordInviteRegex.test(content)) {
        isViolation = true;
        reason = "Invitation Discord non autorisée";
    } else if (!isViolation && scamDomainsRegex.test(content)) {
        isViolation = true;
        reason = "Lien de Phishing / Scam (Faux Nitro)";
    }

    // --- RÈGLE 3 : Anti-Mass Mention ---
    const totalMentions = message.mentions.users.size + message.mentions.roles.size;
    if (!isViolation && (totalMentions > 3 || message.mentions.everyone)) {
        isViolation = true;
        reason = "Spam de mentions (@everyone / multiples)";
    }

    // --- RÈGLE 4 : Anti-Duplicate (Message identique) ---
    if (!isViolation && history.length >= 3) {
        const duplicateCount = history.filter(m => m.content.toLowerCase().trim() === content.toLowerCase().trim()).length;
        if (duplicateCount >= 3) {
            isViolation = true;
            reason = "Répétition du même message (Duplication)";
        }
    }

    // --- RÈGLE 5 : Anti-Mass Caps (Majuscules > 75%) ---
    if (!isViolation && content.length >= 12) {
        const uppercaseChars = content.replace(/[^A-Z]/g, "").length;
        if ((uppercaseChars / content.length) > 0.75) {
            isViolation = true;
            reason = "Abus de majuscules (>75%)";
        }
    }

    // --- RÈGLE 6 : Anti-Mass Emoji (> 7 émojis) ---
    if (!isViolation) {
        const emojiRegex = /(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff])/g;
        const emojiCount = (content.match(emojiRegex) || []).length;
        if (emojiCount > 7) {
            isViolation = true;
            reason = "Spam d'émojis massif (>7)";
        }
    }

    // ==========================================
    // 🛡️ APPLICATION DE LA SANCTION ET LOGS
    // ==========================================
    if (isViolation) {
        // 1. Suppression directe du message
        await message.delete().catch(() => {});

        // 2. Traitement du Timeout automatique (2 infractions / 10 min)
        let warns = userWarns.get(userId) || [];
        warns = warns.filter(t => now - t < 600000); // Ne conserve que les 10 dernières minutes
        warns.push(now);
        userWarns.set(userId, warns);

        let timeoutApplied = false;
        if (warns.length >= 2 && message.member?.manageable) {
            // Sourdine automatique de 10 minutes (600 000 ms)
            await message.member.timeout(10 * 60 * 1000, `[ANTI-SPAM AUTO] Récidive : ${reason}`).catch(() => {});
            timeoutApplied = true;
        }

        // 3. Notification temporaire dans le salon
        const alertContent = timeoutApplied
            ? `🔇 **[Anti-Spam]** ${message.author} a été mis en sourdine 10 minutes pour récidive (*${reason}*).`
            : `⚠️ **[Anti-Spam]** ${message.author}, message supprimé. Motif : *${reason}*.`;

        const alert = await message.channel.send(alertContent).catch(() => null);
        if (alert) setTimeout(() => alert.delete().catch(() => {}), 5000);

        // 4. Log Ultra-Détaillé dans #logs-anti-spam
        const timestampFormat = `<t:${Math.floor(now / 1000)}:F>`;
        
        const spamEmbed = new EmbedBuilder()
            .setColor(timeoutApplied ? "#b71c1c" : "#ff9800")
            .setTitle(timeoutApplied ? "🔇 MEMBRE MIS EN SOURDINE (RÉCIDIVE)" : "🛡️ SPAM DÉTECTÉ ET SUPPRIMÉ")
            .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: "👤 Membre", value: `${message.author} (\`${message.author.username}\`)`, inline: true },
                { name: "🆔 ID Membre", value: `\`${userId}\``, inline: true },
                { name: "📍 Salon", value: `${message.channel} (\`${message.channel.id}\`)`, inline: true },
                { name: "⚠️ Type de Violation", value: `\`${reason}\``, inline: false },
                { name: "⏱️ Sanction Appliquée", value: timeoutApplied ? "`Mise en Sourdine (10 min)`" : "`Suppression + Avertissement`", inline: true },
                { name: "📅 Date & Heure", value: timestampFormat, inline: true },
                { name: "💬 Extrait du Message", value: `\`\`\`${content.slice(0, 1000) || "[Aucun texte]"}\`\`\``, inline: false }
            )
            .setFooter({ text: "Team HeLoRiA Fortress Anti-Spam System", iconURL: client.user.displayAvatarURL() })
            .setTimestamp();

        const logChan = await client.channels.fetch(LOGS_ANTI_SPAM_ID).catch(() => null);
        if (logChan) logChan.send({ embeds: [spamEmbed] }).catch(() => {});

        return true;
    }

    return false;
};