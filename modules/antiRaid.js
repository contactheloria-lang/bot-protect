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
const joinTracker = [];               // Timestamps des arrivées
const actionCounters = new Map();     // userId_actionType -> [timestamps]
const isLockdownActive = false;
let isBunkerActive = false;

function getConfig() {
    if (!fs.existsSync(CONFIG_PATH)) return null;
    try {
        return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
    } catch {
        return null;
    }
}

/**
 * Vérification stricte des exemptions (Whitelists)
 */
function isImmune(memberOrId, guild, config) {
    if (!config) return false;
    const userId = typeof memberOrId === "string" ? memberOrId : memberOrId?.id;
    if (!userId) return false;

    if (userId === config.ownerId || userId === guild?.ownerId) return true;
    if (config.whitelist?.includes(userId)) return true;
    
    if (typeof memberOrId === "object" && memberOrId?.roles) {
        if (memberOrId.roles.cache.some(r => config.whitelistRoles?.includes(r.id))) return true;
    }
    return false;
}

/**
 * Récupère l'exécuteur d'une action dans les Audit Logs
 */
async function fetchAuditExecutor(guild, auditType) {
    try {
        const auditLogs = await guild.fetchAuditLogs({ limit: 1, type: auditType });
        const entry = auditLogs.entries.first();
        if (!entry) return null;
        // On s'assure que l'action s'est produite dans les 5 dernières secondes
        if (Date.now() - entry.createdTimestamp > 5000) return null;
        return entry.executor;
    } catch {
        return null;
    }
}

/**
 * Applique la sanction à un exécuteur non autorisé
 */
async function penalizeExecutor(guild, executor, reason, config) {
    if (!executor || isImmune(executor.id, guild, config)) return;

    const member = await guild.members.fetch(executor.id).catch(() => null);
    if (!member || !member.manageable) return;

    // Retrait des rôles dangereux ou Ban automatique selon la gravité
    await member.roles.set([], `[ULTRA ANTI-RAID] ${reason}`).catch(() => {});
    await member.ban({ reason: `[ULTRA ANTI-RAID] ${reason}` }).catch(() => {});

    // Notification Log
    const logEmbed = new EmbedBuilder()
        .setColor("#FF0000")
        .setTitle("🚨 ALERTE NEUTRALISATION ANTI-RAID")
        .addFields(
            { name: "👤 Auteur", value: `${executor.tag} (\`${executor.id}\`)`, inline: true },
            { name: "⚡ Action", value: reason, inline: true },
            { name: "🛡️ Sanction", value: "Bannissement Immédiat & Stripping Rôles", inline: false }
        )
        .setTimestamp();

    const logChan = await guild.channels.fetch(config.channels?.logsAntiRaid).catch(() => null);
    if (logChan) logChan.send({ embeds: [logEmbed] });
}

// -------------------------------------------------------------------
// 🔴 01-15 & 🟥 109-120 : DÉTECTION DE RAID & REJOINTS MASSIFS
// -------------------------------------------------------------------
async function handleGuildMemberAdd(client, member) {
    const guild = member.guild;
    const config = getConfig();
    const now = Date.now();

    // Suivi des arrivées dans la fenêtre de temps
    joinTracker.push(now);
    const timeframeSec = (config?.raidTimeframeSec || 10) * 1000;
    const recentJoins = joinTracker.filter(t => now - t < timeframeSec);

    // 🟤 121-132 : MODE QUARANTAINE AUTOMATIQUE
    if (config?.quarantineRoleId) {
        await member.roles.add(config.quarantineRoleId, "Mise en quarantaine automatique").catch(() => {});
    }

    // 🟠 16-28 : ANTI-BOT NON AUTORISÉ
    if (member.user.bot) {
        const executor = await fetchAuditExecutor(guild, AuditLogEvent.BotAdd);
        if (executor && !isImmune(executor.id, guild, config)) {
            await member.ban({ reason: "[ULTRA ANTI-RAID] Bot non autorisé ajouté." }).catch(() => {});
            await penalizeExecutor(guild, executor, "Ajout d'un bot non autorisé", config);
            return;
        }
    }

    // Déclenchement de la détection de Raid entrant
    const maxThreshold = config?.raidThreshold || 5;
    if (recentJoins.length >= maxThreshold) {
        // Activation du verrouillage temporaire (Lockdown)
        triggerLockdown(guild, true, config);

        const logEmbed = new EmbedBuilder()
            .setColor("#FF9800")
            .setTitle("⚠️ DÉTECTION DE RAID EN COURS")
            .setDescription(`**${recentJoins.length}** membres ont rejoint en moins de ${config?.raidTimeframeSec || 10}s. Activation des sécurités renforcées.`)
            .setTimestamp();

        const logChan = await guild.channels.fetch(config?.channels?.logsAntiRaid).catch(() => null);
        if (logChan) logChan.send({ embeds: [logEmbed] });
    }
}

// -------------------------------------------------------------------
// 🟢 41-79 & 🟣 80-108 : PROTECTION DES STRUCTURES (SALONS/RÔLES/CATÉGORIES)
// -------------------------------------------------------------------
async function handleChannelDelete(client, channel) {
    const guild = channel.guild;
    if (!guild) return;
    const config = getConfig();

    const executor = await fetchAuditExecutor(guild, AuditLogEvent.ChannelDelete);
    if (executor && !isImmune(executor.id, guild, config)) {
        // Sanction de l'auteur
        await penalizeExecutor(guild, executor, `Suppression de salon/catégorie: ${channel.name}`, config);

        // Restauration automatique
        await channel.clone({
            name: channel.name,
            permissionOverwrites: channel.permissionOverwrites.cache,
            topic: channel.topic,
            parent: channel.parentId,
            position: channel.rawPosition
        }).catch(() => {});
    }
}

async function handleRoleDelete(client, role) {
    const guild = role.guild;
    if (!guild) return;
    const config = getConfig();

    const executor = await fetchAuditExecutor(guild, AuditLogEvent.RoleDelete);
    if (executor && !isImmune(executor.id, guild, config)) {
        await penalizeExecutor(guild, executor, `Suppression du rôle: ${role.name}`, config);

        // Restauration automatique du rôle
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

// -------------------------------------------------------------------
// ⚠️ 169-176 : PROTECTION DES WEBHOOKS
// -------------------------------------------------------------------
async function handleWebhookUpdate(client, channel) {
    const guild = channel.guild;
    if (!guild) return;
    const config = getConfig();

    const executor = await fetchAuditExecutor(guild, AuditLogEvent.WebhookCreate);
    if (executor && !isImmune(executor.id, guild, config)) {
        await penalizeExecutor(guild, executor, "Création de webhook non autorisée", config);

        // Nettoyage automatique des webhooks créés
        const webhooks = await channel.fetchWebhooks().catch(() => null);
        if (webhooks) {
            webhooks.forEach(wh => {
                if (wh.owner?.id === executor.id) wh.delete("Webhook non autorisé").catch(() => {});
            });
        }
    }
}

// -------------------------------------------------------------------
// 🟪 192-202 : PROTECTION DE LA CONFIGURATION DU SERVEUR
// -------------------------------------------------------------------
async function handleGuildUpdate(client, oldGuild, newGuild) {
    const config = getConfig();
    const executor = await fetchAuditExecutor(newGuild, AuditLogEvent.GuildUpdate);

    if (executor && !isImmune(executor.id, newGuild, config)) {
        await penalizeExecutor(newGuild, executor, "Modification des paramètres du serveur", config);

        // Restauration du nom / icône / paramètres
        if (oldGuild.name !== newGuild.name) await newGuild.setName(oldGuild.name).catch(() => {});
        if (oldGuild.icon !== newGuild.icon) await newGuild.setIcon(oldGuild.iconURL()).catch(() => {});
        if (oldGuild.verificationLevel !== newGuild.verificationLevel) {
            await newGuild.setVerificationLevel(oldGuild.verificationLevel).catch(() => {});
        }
    }
}

// -------------------------------------------------------------------
// 🚨 133-145 & 🏰 146-168 : LOCKDOWN ET SYSTÈME BUNKER
// -------------------------------------------------------------------
async function triggerLockdown(guild, state, config) {
    const everyoneRole = guild.roles.everyone;
    const permissions = everyoneRole.permissions;

    if (state) {
        // Verrouillage : Suppression de la permission de poster et de se connecter
        await everyoneRole.setPermissions(permissions.remove([
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.AddReactions,
            PermissionsBitField.Flags.Connect
        ])).catch(() => {});
    } else {
        // Rétablissement
        await everyoneRole.setPermissions(permissions.add([
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.AddReactions,
            PermissionsBitField.Flags.Connect
        ])).catch(() => {});
    }
}

async function handleBunkerCommand(client, message) {
    if (!message.guild || !message.content.startsWith("!bunker")) return;

    const config = getConfig();
    if (!isImmune(message.member, message.guild, config)) {
        return message.reply("❌ Permission insuffisante pour exécuter les commandes Bunker.");
    }

    const args = message.content.split(" ").slice(1);
    const mode = args[0]?.toLowerCase();

    if (mode === "on") {
        isBunkerActive = true;
        await triggerLockdown(message.guild, true, config);

        // Création ou sécurisation du salon/catégorie Bunker si non existant
        let bunkerCategory = message.guild.channels.cache.find(c => c.name === "🏰-BUNKER" && c.type === ChannelType.GuildCategory);
        if (!bunkerCategory) {
            bunkerCategory = await message.guild.channels.create({
                name: "🏰-BUNKER",
                type: ChannelType.GuildCategory,
                permissionOverwrites: [
                    {
                        id: message.guild.roles.everyone.id,
                        deny: [PermissionsBitField.Flags.ViewChannel]
                    }
                ]
            }).catch(() => null);
        }

        return message.reply("🏰 **MODE BUNKER ACTIVÉ** : Le serveur est verrouillé, les accès publics sont fermés.");
    }

    if (mode === "off") {
        isBunkerActive = false;
        await triggerLockdown(message.guild, false, config);
        return message.reply("🔓 **MODE BUNKER DÉSACTIVÉ** : Les accès au serveur ont été rétablis.");
    }

    return message.reply("⚙️ **Utilisation :** `!bunker on` pour verrouiller le serveur, `!bunker off` pour réouvrir.");
}

module.exports = {
    handleGuildMemberAdd,
    handleChannelDelete,
    handleRoleDelete,
    handleWebhookUpdate,
    handleGuildUpdate,
    handleBunkerCommand
};
