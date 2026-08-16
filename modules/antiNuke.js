const { EmbedBuilder, AuditLogEvent, PermissionsBitField } = require("discord.js");
const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "../data/fortress_config.json");

// Buffers en mémoire pour le suivi des quotas et des sauvegardes
const actionTrackers = new Map(); // trackingKey -> [timestamps]
const quarantineCache = new Map(); // userId -> [roleIds]

const WINDOW_TIME = 60000; // Fenêtre d'analyse de 1 minute

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
    if (userId === config.ownerId || (guild && userId === guild.ownerId) || userId === guild.client.user.id) return true;
    return config.whitelist?.includes(userId) || false;
}

/**
 * Exécute la mise en quarantaine immédiate d'un membre du Staff fautif
 */
async function executeQuarantine(guild, userId, reason, config) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return;

    // Sauvegarde des rôles pour restauration ultérieure en cas de fausse alerte
    const rolesToStrip = member.roles.cache.filter(r => r.id !== guild.roles.everyone.id);
    quarantineCache.set(userId, {
        roles: rolesToStrip.map(r => r.id),
        timestamp: Date.now()
    });

    // Retrait immédiat de tous les rôles administratifs/modération
    await member.roles.remove(rolesToStrip, `[ANTI-NUKE] ${reason}`).catch(() => {});

    // Bannissement si c'est un bot malveillant ou expulsion/sourdine d'urgence si c'est un utilisateur
    if (member.user.bot) {
        await member.ban({ reason: `[ANTI-NUKE BOT] ${reason}` }).catch(() => {});
    } else {
        await member.timeout(24 * 60 * 60 * 1000, `[ANTI-NUKE QUARANTAINE] ${reason}`).catch(() => {});
    }

    // Alerte Logs
    const logEmbed = new EmbedBuilder()
        .setColor("#B71C1C")
        .setTitle("🚨 SANCTION ANTI-NUKE ET QUARANTAINE")
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
        .addFields(
            { name: "👤 Membre Sanctionné", value: `${member.user.tag} (\`${userId}\`)`, inline: true },
            { name: "⚠️ Motif de la Sanction", value: `\`${reason}\``, inline: false },
            { name: "📦 Quarantaine", value: `\`${rolesToStrip.size}\` rôle(s) retiré(s) et sauvegardé(s).`, inline: false }
        )
        .setTimestamp();

    const logChan = await guild.client.channels.fetch(config.channels?.logsAntiNuke).catch(() => null);
    if (logChan) logChan.send({ embeds: [logEmbed] });
}

/**
 * Traque les quotas d'actions (Channels, Roles, Bans)
 */
async function trackQuota(guild, executorId, actionType, maxAllowed, actionLabel, config) {
    if (isImmune(executorId, guild, config)) return false;

    const now = Date.now();
    const trackingKey = `${executorId}_${actionType}`;

    let timestamps = (actionTrackers.get(trackingKey) || []).filter(t => now - t < WINDOW_TIME);
    timestamps.push(now);
    actionTrackers.set(trackingKey, timestamps);

    if (timestamps.length > maxAllowed) {
        await executeQuarantine(
            guild, 
            executorId, 
            `Dépassement de quota : ${actionLabel} (${timestamps.length}/${maxAllowed} par min)`,
            config
        );
        return true;
    }
    return false;
}

/**
 * Initialise la surveillance des événements Anti-Nuke
 */
function initAntiNuke(client) {
    const config = getConfig();
    if (!config) return;

    const limits = config.antiNukeLimits || { channelDelete: 3, roleDelete: 3, memberBan: 3 };

    // 1. Détection suppression de salons
    client.on("channelDelete", async (channel) => {
        if (!channel.guild) return;
        const logs = await channel.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelDelete }).catch(() => null);
        const entry = logs?.entries.first();
        if (entry && entry.executor) {
            await trackQuota(channel.guild, entry.executor.id, "channel_delete", limits.channelDelete, "Suppression de salons", config);
        }
    });

    // 2. Détection suppression de rôles
    client.on("roleDelete", async (role) => {
        if (!role.guild) return;
        const logs = await role.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.RoleDelete }).catch(() => null);
        const entry = logs?.entries.first();
        if (entry && entry.executor) {
            await trackQuota(role.guild, entry.executor.id, "role_delete", limits.roleDelete, "Suppression de rôles", config);
        }
    });

    // 3. Détection bannissements massifs
    client.on("guildBanAdd", async (ban) => {
        const logs = await ban.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberBanAdd }).catch(() => null);
        const entry = logs?.entries.first();
        if (entry && entry.executor) {
            await trackQuota(ban.guild, entry.executor.id, "member_ban", limits.memberBan, "Bannissements de membres", config);
        }
    });

    // 4. Détection ajout de permissions dangereuses sur un rôle
    client.on("roleUpdate", async (oldRole, newRole) => {
        if (!newRole.guild) return;
        const dangerousPermissions = [PermissionsBitField.Flags.Administrator, PermissionsBitField.Flags.ManageRoles];
        
        const hadDangerous = dangerousPermissions.some(perm => oldRole.permissions.has(perm));
        const hasDangerous = dangerousPermissions.some(perm => newRole.permissions.has(perm));

        if (!hadDangerous && hasDangerous) {
            const logs = await newRole.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.RoleUpdate }).catch(() => null);
            const entry = logs?.entries.first();

            if (entry && entry.executor && !isImmune(entry.executor.id, newRole.guild, config)) {
                await newRole.setPermissions(oldRole.permissions, "[ANTI-NUKE] Permission dangereuse révoquée.").catch(() => {});
                await executeQuarantine(newRole.guild, entry.executor.id, `Ajout de permissions dangereuses sur le rôle ${newRole.name}`, config);
            }
        }
    });
}

module.exports = { initAntiNuke };