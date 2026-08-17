const { 
    EmbedBuilder, 
    PermissionsBitField, 
    AuditLogEvent, 
    ChannelType 
} = require("discord.js");
const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "../data/fortress_config.json");

// Buffers de mémoire vive pour le suivi des seuils
const userActionTracker = new Map(); // userId_actionType -> [timestamps]
const userThreatScore = new Map();   // userId -> score

function getConfig() {
    if (!fs.existsSync(CONFIG_PATH)) return null;
    try {
        return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
    } catch {
        return null;
    }
}

function isImmune(userId, guild, config) {
    if (!config || !userId) return false;
    if (userId === config.ownerId || userId === guild?.ownerId) return true;
    return config.whitelist?.includes(userId) || false;
}

/**
 * Audit Log Sentinel : Récupère l'exécuteur de l'action récents (5s max)
 */
async function getAuditExecutor(guild, auditType) {
    try {
        const logs = await guild.fetchAuditLogs({ limit: 1, type: auditType });
        const entry = logs.entries.first();
        if (!entry) return null;
        if (Date.now() - entry.createdTimestamp > 5000) return null;
        return { executor: entry.executor, target: entry.target, extra: entry.extra };
    } catch {
        return null;
    }
}

/**
 * Calculateur du score de menace & Neutralisation immédiate
 */
async function registerThreatAndSanction(guild, executor, actionName, weight = 25) {
    const config = getConfig();
    if (!executor || isImmune(executor.id, guild, config)) return false;

    const now = Date.now();
    const key = `${executor.id}_${actionName}`;
    let timestamps = (userActionTracker.get(key) || []).filter(t => now - t < 10000); // Fenêtre 10s
    timestamps.push(now);
    userActionTracker.set(key, timestamps);

    let currentScore = (userThreatScore.get(executor.id) || 0) + weight;
    userThreatScore.set(executor.id, currentScore);

    // Seuil de Nuke atteint (Seuil par défaut: 50 points ou 3 actions identiques en 10s)
    if (timestamps.length >= 3 || currentScore >= 50) {
        const member = await guild.members.fetch(executor.id).catch(() => null);
        if (member && member.manageable) {
            // Stripping immédiat de tous les rôles + Ban
            await member.roles.set([], `[ULTRA ANTI-NUKE] Seuil de menace dépassé: ${actionName}`).catch(() => {});
            await member.ban({ reason: `[ULTRA ANTI-NUKE] Tentative de destruction (Action: ${actionName})` }).catch(() => {});
        }

        // Alerte Log
        const logEmbed = new EmbedBuilder()
            .setColor("#FF0000")
            .setTitle("☢️ ALERTE DESTRUCTION NEUTRALISÉE (ANTI-NUKE)")
            .addFields(
                { name: "👤 Auteur", value: `${executor.tag} (\`${executor.id}\`)`, inline: true },
                { name: "💥 Action détectée", value: actionName, inline: true },
                { name: "📊 Score de menace", value: `${currentScore} pts`, inline: true },
                { name: "⚡ Sanctions", value: "Rôles révoqués & Bannissement Immédiat", inline: false }
            )
            .setTimestamp();

        const logChan = await guild.channels.fetch(config.channels?.logsAntiNuke).catch(() => null);
        if (logChan) logChan.send({ embeds: [logEmbed] });

        return true;
    }

    return false;
}

// -------------------------------------------------------------------
// 💀 ANTI-BAN / ANTI-KICK NUKE
// -------------------------------------------------------------------
async function handleGuildBanAdd(guild, ban) {
    const auditData = await getAuditExecutor(guild, AuditLogEvent.MemberBanAdd);
    if (!auditData) return;

    const isNuke = await registerThreatAndSanction(guild, auditData.executor, "Ban Massif", 30);
    if (isNuke) {
        // Débannissement automatique de la victime si possible
        await guild.bans.remove(ban.user.id, "[ANTI-NUKE] Restauration suite à un ban malveillant").catch(() => {});
    }
}

// -------------------------------------------------------------------
// 🟥 ANTI-CHANNEL / CATEGORY NUKE
// -------------------------------------------------------------------
async function handleChannelDelete(channel) {
    const guild = channel.guild;
    if (!guild) return;

    const auditData = await getAuditExecutor(guild, AuditLogEvent.ChannelDelete);
    if (!auditData) return;

    const isNuke = await registerThreatAndSanction(guild, auditData.executor, `Suppression Salon: ${channel.name}`, 25);
    if (isNuke) {
        // Restauration d'urgence du salon ou de la catégorie
        await channel.clone({
            name: channel.name,
            permissionOverwrites: channel.permissionOverwrites.cache,
            topic: channel.topic,
            parent: channel.parentId,
            position: channel.rawPosition
        }).catch(() => {});
    }
}

// -------------------------------------------------------------------
// 🟨 ANTI-ROLE / ANTI-PERMISSION NUKE
// -------------------------------------------------------------------
async function handleRoleDelete(role) {
    const guild = role.guild;
    if (!guild) return;

    const auditData = await getAuditExecutor(guild, AuditLogEvent.RoleDelete);
    if (!auditData) return;

    const isNuke = await registerThreatAndSanction(guild, auditData.executor, `Suppression Rôle: ${role.name}`, 25);
    if (isNuke) {
        // Restauration automatique du rôle supprimé
        await guild.roles.create({
            name: role.name,
            color: role.color,
            hoist: role.hoist,
            permissions: role.permissions,
            mentionable: role.mentionable,
            position: role.rawPosition
        }).catch(() => {});
    }
}

async function handleRoleUpdate(oldRole, newRole) {
    const guild = newRole.guild;
    if (!guild) return;

    // Détection d'escalade de privilèges (Ajout d'Administrateur ou permissions dangereuses)
    const dangerousPerms = [
        PermissionsBitField.Flags.Administrator,
        PermissionsBitField.Flags.ManageGuild,
        PermissionsBitField.Flags.ManageRoles,
        PermissionsBitField.Flags.ManageChannels,
        PermissionsBitField.Flags.BanMembers
    ];

    const addedDangerous = dangerousPerms.some(perm => !oldRole.permissions.has(perm) && newRole.permissions.has(perm));
    if (addedDangerous) {
        const auditData = await getAuditExecutor(guild, AuditLogEvent.RoleUpdate);
        if (!auditData) return;

        const isNuke = await registerThreatAndSanction(guild, auditData.executor, `Ajout Permission Sensible sur ${newRole.name}`, 35);
        if (isNuke) {
            // Révocation instantanée de la modification
            await newRole.setPermissions(oldRole.permissions, "[ANTI-NUKE] Restauration des permissions d'origine").catch(() => {});
        }
    }
}

// -------------------------------------------------------------------
// 🔵 ANTI-WEBHOOK NUKE
// -------------------------------------------------------------------
async function handleWebhookUpdate(channel) {
    const guild = channel.guild;
    if (!guild) return;

    const auditData = await getAuditExecutor(guild, AuditLogEvent.WebhookCreate);
    if (!auditData) return;

    const isNuke = await registerThreatAndSanction(guild, auditData.executor, "Création Massive Webhooks", 20);
    if (isNuke) {
        const webhooks = await channel.fetchWebhooks().catch(() => null);
        if (webhooks) {
            webhooks.forEach(wh => {
                if (wh.owner?.id === auditData.executor.id) {
                    wh.delete("[ANTI-NUKE] Webhook malveillant supprimé").catch(() => {});
                }
            });
        }
    }
}

// -------------------------------------------------------------------
// ⚫ ANTI-EMOJI / STICKER NUKE
// -------------------------------------------------------------------
async function handleEmojiDelete(emoji) {
    const guild = emoji.guild;
    if (!guild) return;

    const auditData = await getAuditExecutor(guild, AuditLogEvent.EmojiDelete);
    if (!auditData) return;

    await registerThreatAndSanction(guild, auditData.executor, `Suppression Emoji: ${emoji.name}`, 15);
}

module.exports = {
    handleGuildBanAdd,
    handleChannelDelete,
    handleRoleDelete,
    handleRoleUpdate,
    handleWebhookUpdate,
    handleEmojiDelete
};
