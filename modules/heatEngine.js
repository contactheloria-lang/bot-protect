const { EmbedBuilder } = require("discord.js");
const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "../data/fortress_config.json");

// Buffers en mémoire
const userHeatMap = new Map();     // userId -> { heat: number, lastUpdate: timestamp }
const userLastMsgMap = new Map();  // userId -> { content: string, timestamp: number }
const userPenalties = new Map();   // userId -> number (multiplicateur de sanction)

function getConfig() {
    if (!fs.existsSync(CONFIG_PATH)) return null;
    try {
        return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
    } catch {
        return null;
    }
}

function isImmune(userId, guild, config) {
    if (!config) return false;
    if (userId === config.ownerId || (guild && userId === guild.ownerId)) return true;
    return config.whitelist?.includes(userId) || false;
}

/**
 * Moteur de calcul de Chaleur (Heat Engine)
 */
async function processHeatSpam(client, message) {
    if (!message.guild || message.author.bot) return false;

    const config = getConfig();
    if (!config) return false;

    const userId = message.author.id;
    if (isImmune(userId, message.guild, config)) return false;

    const now = Date.now();
    const settings = config.heatSettings;

    // 1. Refroidissement progressif du score (Decay)
    let userData = userHeatMap.get(userId) || { heat: 0, lastUpdate: now };
    const secondsPassed = (now - userData.lastUpdate) / 1000;
    userData.heat = Math.max(0, userData.heat - (secondsPassed * settings.decayRatePerSec));
    userData.lastUpdate = now;

    // 2. Calcul des points de chaleur du message actuel
    let addedHeat = settings.weights.baseMessage;

    // Détection de duplication
    const lastMsg = userLastMsgMap.get(userId);
    if (lastMsg && lastMsg.content.toLowerCase().trim() === message.content.toLowerCase().trim() && (now - lastMsg.timestamp < 15000)) {
        addedHeat += settings.weights.duplicate;
    }
    userLastMsgMap.set(userId, { content: message.content, timestamp: now });

    // Mentions (@everyone / @here / utilisateurs)
    const totalMentions = message.mentions.users.size + message.mentions.roles.size + (message.mentions.everyone ? 5 : 0);
    if (totalMentions > 0) {
        addedHeat += totalMentions * settings.weights.mention;
    }

    // Liens & Invitations
    if (/(https?:\/\/[^\s]+)/g.test(message.content)) {
        addedHeat += settings.weights.link;
    }

    // Pièces jointes
    if (message.attachments.size > 0) {
        addedHeat += message.attachments.size * settings.weights.attachment;
    }

    // Majuscules
    if (message.content.length >= 10) {
        const caps = message.content.replace(/[^A-Z]/g, "").length;
        if ((caps / message.content.length) > 0.7) {
            addedHeat += settings.weights.capsRatio;
        }
    }

    // Mise à jour du score
    userData.heat += addedHeat;
    userHeatMap.set(userId, userData);

    // 3. Déclenchement de la sanction si le seuil maximal est dépassé
    if (userData.heat >= settings.maxHeat) {
        // Réinitialisation de la chaleur après infraction
        userData.heat = 0;
        userHeatMap.set(userId, userData);

        // Suppression du message
        await message.delete().catch(() => {});

        // Application du multiplicateur de peine
        let penaltyLevel = (userPenalties.get(userId) || 0) + 1;
        userPenalties.set(userId, penaltyLevel);

        // Durée dynamique : 5 min * multiplicateur
        const durationMinutes = Math.min(60, 5 * penaltyLevel);
        const durationMs = durationMinutes * 60 * 1000;

        if (message.member?.manageable) {
            await message.member.timeout(durationMs, `[HEAT ENGINE] Surchauffe Anti-Spam (Niveau ${penaltyLevel})`).catch(() => {});
        }

        // Alerte temporaire
        const alert = await message.channel.send(`🔥 **[Heat System]** ${message.author} a déclenché une surchauffe. Mis en sourdine pendant **${durationMinutes} min**.`);
        setTimeout(() => alert.delete().catch(() => {}), 5000);

        // Log détaillé
        const logEmbed = new EmbedBuilder()
            .setColor("#D32F2F")
            .setTitle("🔥 SURCHAUFFE SPAM DÉTECTÉE (HEAT ENGINE)")
            .addFields(
                { name: "👤 Membre", value: `${message.author} (\`${userId}\`)`, inline: true },
                { name: "📍 Salon", value: `${message.channel}`, inline: true },
                { name: "⚡ Sanction", value: `Timeout **${durationMinutes} min** (Récidive x${penaltyLevel})`, inline: false },
                { name: "💬 Message déclencheur", value: `\`\`\`${message.content.slice(0, 1000) || "[Fichier/Image]"}\`\`\`` }
            )
            .setTimestamp();

        const logChan = await client.channels.fetch(config.channels.logsAntiSpam).catch(() => null);
        if (logChan) logChan.send({ embeds: [logEmbed] }).catch(() => {});

        return true;
    }

    return false;
}

module.exports = { processHeatSpam };