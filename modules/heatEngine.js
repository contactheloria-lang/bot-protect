const { 
    EmbedBuilder, 
    PermissionsBitField, 
    AuditLogEvent 
} = require("discord.js");
const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "../data/fortress_config.json");

// Buffers de mémoire vive (In-Memory Stores)
const userHeatMap = new Map();        // userId -> { heat, lastUpdate, riskScore, infractions }
const userHistoryMap = new Map();     // userId -> [{ content, cleanContent, channelId, timestamp, attachments, embeds }]
const userReactionMap = new Map();    // userId -> [timestamps]
const userVoiceMap = new Map();       // userId -> [timestamps]
const userProfileMap = new Map();     // userId -> [timestamps]
const disabledChannels = new Set();   // Salons où l'Anti-Spam est désactivé

function getConfig() {
    if (!fs.existsSync(CONFIG_PATH)) return null;
    try {
        return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
    } catch {
        return null;
    }
}

function isImmune(member, guild, config) {
    if (!config || !member) return false;
    if (member.id === config.ownerId || member.id === guild?.ownerId) return true;
    if (config.whitelist?.includes(member.id)) return true;
    if (member.roles?.cache.some(r => config.whitelistRoles?.includes(r.id))) return true;
    return false;
}

/**
 * 🧠 DÉTECTION INTELLIGENTE : Normalisation & Détection Unicode/Homoglyphes
 * Nettoie les caractères invisibles, la ponctuation et décode les caractères similaires.
 */
function normalizeText(str) {
    if (!str) return "";
    return str
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // Supprime les diacritiques/accents
        .replace(/[\u200B-\u200D\uFEFF]/g, "") // Supprime les caractères invisibles
        .replace(/[^\w\s]/gi, "") // Supprime la ponctuation
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Distance de Levenshtein (Similarité de texte)
 */
function getSimilarityRatio(str1, str2) {
    const s1 = normalizeText(str1);
    const s2 = normalizeText(str2);
    if (s1 === s2) return 1.0;
    if (s1.length === 0 || s2.length === 0) return 0.0;

    const track = Array(s2.length + 1).fill(null).map(() => Array(s1.length + 1).fill(null));
    for (let i = 0; i <= s1.length; i++) track[0][i] = i;
    for (let j = 0; j <= s2.length; j++) track[j][0] = j;

    for (let j = 1; j <= s2.length; j++) {
        for (let i = 1; i <= s1.length; i++) {
            const indicator = s1[i - 1] === s2[j - 1] ? 0 : 1;
            track[j][i] = Math.min(
                track[j][i - 1] + 1,
                track[j - 1][i] + 1,
                track[j - 1][i - 1] + indicator
            );
        }
    }
    return 1 - (track[s2.length][s1.length] / Math.max(s1.length, s2.length));
}

/**
 * MOTEUR PRINCIPAL ANTI-SPAM (MESSAGES)
 */
async function processHeatSpam(client, message) {
    if (!message.guild || message.author.bot) return false;
    if (disabledChannels.has(message.channel.id)) return false;

    const config = getConfig();
    if (!config) return false;
    if (isImmune(message.member, message.guild, config)) return false;

    const userId = message.author.id;
    const now = Date.now();
    const settings = config.heatSettings || { maxHeat: 100, decayRatePerSec: 15 };

    // 1. Refroidissement progressif du score de chaleur
    let userData = userHeatMap.get(userId) || { heat: 0, lastUpdate: now, riskScore: 0, infractions: 0 };
    const secondsPassed = (now - userData.lastUpdate) / 1000;
    userData.heat = Math.max(0, userData.heat - (secondsPassed * settings.decayRatePerSec));
    userData.lastUpdate = now;

    let addedHeat = 5; // Poids de base d'un message
    const rawContent = message.content;
    const cleanContent = normalizeText(rawContent);

    // 🔴 01-20 : FLOOD / MESSAGES
    if (rawContent.length > 500) addedHeat += 25; // Message très long
    if (rawContent.length < 3 && rawContent.length > 0) addedHeat += 5; // Message très court
    if (rawContent.split('\n').length > 5) addedHeat += 20; // Flood de lignes
    if ((rawContent.match(/[A-Z]/g) || []).length / rawContent.length > 0.7 && rawContent.length > 8) addedHeat += 15; // Flood majuscules
    if (/[\u200B-\u200D\uFEFF]/.test(rawContent)) addedHeat += 30; // Caractères invisibles
    if (/(.)\1{4,}/.test(rawContent)) addedHeat += 15; // Même lettre/caractère répété

    // 🟠 21-35 : RÉPÉTITION / SIMILARITÉ / CROSS-CHANNEL
    let history = userHistoryMap.get(userId) || [];
    history = history.filter(item => now - item.timestamp < 60000); // Garde 60s d'historique

    for (const prev of history) {
        const similarity = getSimilarityRatio(rawContent, prev.content);
        if (similarity > 0.85) {
            addedHeat += 30; // Message similaire ou copier-coller
            if (prev.channelId !== message.channel.id) {
                addedHeat += 45; // Cross-channel spam (Spam multi-salons)
            }
            break;
        }
    }

    // 🟡 36-46 : MENTIONS
    const totalMentions = message.mentions.users.size + message.mentions.roles.size;
    if (totalMentions > 0) addedHeat += totalMentions * 12;
    if (message.mentions.everyone) addedHeat += 60; // Ping @everyone / @here

    // 🟢 47-61 : MÉDIAS & PIÈCES JOINTES
    if (message.attachments.size > 0) addedHeat += message.attachments.size * 20;
    if (message.stickers.size > 0) addedHeat += message.stickers.size * 15;

    // 🔵 62-72 : LIENS & INVITATIONS DISCORD
    if (/(https?:\/\/[^\s]+)/g.test(rawContent)) {
        addedHeat += 20;
        if (/(discord\.gg|discord\.com\/invite)/g.test(rawContent)) {
            addedHeat += 40; // Pub / Invitation Discord
        }
    }

    // Mémorisation du message
    history.push({ content: rawContent, cleanContent, channelId: message.channel.id, timestamp: now });
    userHistoryMap.set(userId, history);

    // Cumul de chaleur
    userData.heat += addedHeat;
    userHeatMap.set(userId, userData);

    // ⚙️ 155-163 : SANCTION EN CAS DE SURCHAUFFE
    if (userData.heat >= settings.maxHeat) {
        userData.heat = 0;
        userData.infractions += 1;
        userHeatMap.set(userId, userData);

        await message.delete().catch(() => {});

        // Escalade progressive des sanctions (Timeout -> Kick -> Ban)
        const durationMinutes = Math.min(1440, 5 * Math.pow(2, userData.infractions - 1));
        
        if (message.member?.manageable) {
            if (userData.infractions >= 4) {
                await message.member.ban({ reason: "[ULTRA ANTI-SPAM] Récidive massive de spam." }).catch(() => {});
            } else {
                await message.member.timeout(durationMinutes * 60 * 1000, `[ULTRA ANTI-SPAM] Surchauffe (Infraction #${userData.infractions})`).catch(() => {});
            }
        }

        // Notification Log
        const logEmbed = new EmbedBuilder()
            .setColor("#D32F2F")
            .setTitle("🛡️ INTERCEPTION ULTRA ANTI-SPAM")
            .addFields(
                { name: "👤 Membre", value: `${message.author} (\`${userId}\`)`, inline: true },
                { name: "📍 Salon", value: `${message.channel}`, inline: true },
                { name: "⚡ Sanction", value: `Timeout **${durationMinutes} min** (Infraction #${userData.infractions})`, inline: false },
                { name: "💬 Message intercepté", value: `\`\`\`${rawContent.slice(0, 500) || "[Média/Fichier]"}\`\`\`` }
            )
            .setTimestamp();

        const logChan = await client.channels.fetch(config.channels?.logsAntiSpam).catch(() => null);
        if (logChan) logChan.send({ embeds: [logEmbed] });

        return true;
    }

    return false;
}

/**
 * ⬛ 81-87 : SPAM DE RÉACTIONS
 */
async function handleReactionSpam(client, reaction, user) {
    if (user.bot) return;
    const config = getConfig();
    if (!config) return;

    const now = Date.now();
    let timestamps = (userReactionMap.get(user.id) || []).filter(t => now - t < 10000);
    timestamps.push(now);
    userReactionMap.set(user.id, timestamps);

    if (timestamps.length > 6) { // Plus de 6 réactions en 10s
        await reaction.remove().catch(() => {});
        const member = await reaction.message.guild?.members.fetch(user.id).catch(() => null);
        if (member && member.manageable && !isImmune(member, reaction.message.guild, config)) {
            await member.timeout(10 * 60 * 1000, "[ULTRA ANTI-SPAM] Spam de réactions.").catch(() => {});
        }
    }
}

/**
 * 🟫 101-108 : SPAM VOCAL (JOIN/LEAVE EN BOUCLE)
 */
async function handleVoiceSpam(client, oldState, newState) {
    const member = newState.member || oldState.member;
    if (!member || member.user.bot) return;

    const config = getConfig();
    if (!config) return;

    // Détection changement/connexion salon vocal
    if (oldState.channelId !== newState.channelId) {
        const now = Date.now();
        let timestamps = (userVoiceMap.get(member.id) || []).filter(t => now - t < 15000);
        timestamps.push(now);
        userVoiceMap.set(member.id, timestamps);

        if (timestamps.length >= 5 && member.manageable && !isImmune(member, newState.guild, config)) {
            await member.voice.disconnect().catch(() => {});
            await member.timeout(15 * 60 * 1000, "[ULTRA ANTI-SPAM] Spam de connexions vocales.").catch(() => {});
        }
    }
}

/**
 * 🟨 109-114 : SPAM DE PROFIL / CHANGEMENT DE PSEUDO
 */
async function handleProfileSpam(client, oldMember, newMember) {
    if (oldMember.nickname === newMember.nickname) return;
    const config = getConfig();
    if (!config) return;

    const now = Date.now();
    let timestamps = (userProfileMap.get(newMember.id) || []).filter(t => now - t < 60000);
    timestamps.push(now);
    userProfileMap.set(newMember.id, timestamps);

    if (timestamps.length >= 3 && newMember.manageable && !isImmune(newMember, newMember.guild, config)) {
        await newMember.setNickname(null, "[ULTRA ANTI-SPAM] Changement de pseudo en boucle.").catch(() => {});
        await newMember.timeout(30 * 60 * 1000, "[ULTRA ANTI-SPAM] Modification de profil répétée.").catch(() => {});
    }
}

/**
 * ⚙️ COMMANDES ADMINISTRATIVES (!antispam / /antispam)
 */
async function handleAntiSpamCommands(client, message) {
    if (!message.guild || !message.content.startsWith("!antispam")) return;

    // Vérification des permissions
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return message.reply("❌ Vous devez être Administrateur pour configurer l'Anti-Spam.");
    }

    const args = message.content.split(" ").slice(1);
    const subCommand = args[0]?.toLowerCase();

    if (subCommand === "off") {
        disabledChannels.add(message.channel.id);
        return message.reply(`🛑 **Anti-Spam désactivé** dans le salon ${message.channel}.`);
    }

    if (subCommand === "on") {
        disabledChannels.delete(message.channel.id);
        return message.reply(`✅ **Anti-Spam réactivé** dans le salon ${message.channel}.`);
    }

    if (subCommand === "clear") {
        const target = message.mentions.members.first();
        if (target) {
            userHeatMap.delete(target.id);
            userHistoryMap.delete(target.id);
            return message.reply(`🧹 Score de chaleur et historique réinitialisés pour ${target}.`);
        }
    }

    return message.reply("⚙️ **Utilisation :** `!antispam <on|off>` pour le salon actuel, ou `!antispam clear @user` pour réinitialiser un membre.");
}

module.exports = {
    processHeatSpam,
    handleReactionSpam,
    handleVoiceSpam,
    handleProfileSpam,
    handleAntiSpamCommands
};
