const { 
    PermissionsBitField, 
    EmbedBuilder, 
    AuditLogEvent 
} = require("discord.js");
const fs = require("fs");
const path = require("path");

// ==========================================
// 📌 CONFIGURATION DES SALONS DE LOGS
// (Remplace avec tes propres IDs)
// ==========================================
const CHANNELS = {
    ANTI_RAID: "1532049300182269982",       // Vagues de raid
    ANTI_BOT: "1532049330544972026",        // Tentatives d'ajout de bots non autorisés
    ANTI_LINK: "1532049395225333821",       // Liens d'invitations Discord supprimés
    ANTI_NUKE: "1532049414925979798",       // Dépassements de quotas & Sanctions Staff
    SANCTION_AUTO: "1532049436631633990"   // Récapitulatif global des actions auto
};

// --- BASE DE DONNÉES ANTI-NUKE ---
const DB_PATH = path.join(__dirname, "../data", "fortress_antispam_db.json");

let db = { 
    channels: {}, 
    roles: {}, 
    bunkerActive: false, 
    antiBot: true, 
    antiWebhook: true, 
    whitelist: [],
    limits: { channel: 3, role: 3, ban: 3 } // Limite stricte : 3 actions par minute
};

if (fs.existsSync(DB_PATH)) {
    try {
        db = JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
        if (!db.whitelist) db.whitelist = [];
        if (!db.limits) db.limits = { channel: 3, role: 3, ban: 3 };
    } catch (e) {
        console.log("[Security] Erreur de lecture DB, réinitialisation.");
    }
}

const saveDb = () => {
    try {
        fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf-8");
    } catch (e) {
        console.log("[Security] Erreur de sauvegarde DB.");
    }
};

// Bases de données temporaires en mémoire
const actionTrackers = new Map();           // trackingKey -> [timestamps]
const quarantineCache = new Map();          // userId -> [roleIds]

const WINDOW_TIME = 60000; // 1 minute (60 000 ms)
const RAID_WINDOW = 30000;  // 30 secondes
const RAID_LIMIT = 5;       // 5 arrivées en 30s = Alerte Raid     
let recentJoins = [];
let raidAlertOn = false;

const OWNER_ID = process.env.OWNER_ID || "1431661348218998948";

module.exports = (client) => {

    console.log("[🛡️ TEAM HELORIA FORTRESS] Système Anti-Nuke & Anti-Link prêt.");

    // --- FONCTION UTILITAIRE : ENVOI DE LOGS ULTRA-DÉTAILLÉS ---
    const sendLog = async (chanId, embed) => {
        if (!chanId) return;
        const chan = await client.channels.fetch(chanId).catch(() => null);
        if (chan) chan.send({ embeds: [embed] }).catch(() => {});
    };

    const isImmune = (userId, guild) => {
        if (userId === OWNER_ID || userId === guild.ownerId || userId === client.user.id) return true;
        return db.whitelist.includes(userId);
    };

    // --- SYSTÈME DE QUARANTAINE ET SANCTION STAFF ---
    const executeStaffSanction = async (guild, userId, reason) => {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) return;

        // Si c'est un bot malveillant
        if (member.user.bot) {
            await member.ban({ reason: `[ANTI-NUKE] ${reason}` }).catch(() => {});
            return;
        }

        // 1. Sauvegarde en Quarantaine (Restauration des rôles en cas de fausse alerte)
        const rolesToStrip = member.roles.cache.filter(r => r.id !== guild.roles.everyone.id);
        quarantineCache.set(userId, {
            roles: rolesToStrip.map(r => r.id),
            timestamp: Date.now()
        });

        // 2. Expulsion/Bannissement du Staff fautif
        await member.ban({ reason: `[ANTI-NUKE QUOTA] ${reason}` }).catch(() => {});

        // 3. Log Ultra-Détaillé
        const timestampFormat = `<t:${Math.floor(Date.now() / 1000)}:F> (<t:${Math.floor(Date.now() / 1000)}:R>)`;
        
        const criticalEmbed = new EmbedBuilder()
            .setColor("#b71c1c")
            .setTitle("🚨 SANCTION ANTI-NUKE DÉCLENCHÉE")
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: "👤 Membre Sanctionné", value: `${member.user} (\`${member.user.username}\`)`, inline: true },
                { name: "🆔 ID du Membre", value: `\`${userId}\``, inline: true },
                { name: "📅 Date & Heure", value: timestampFormat, inline: false },
                { name: "⚠️ Motif de la Sanction", value: `\`${reason}\``, inline: false },
                { name: "📦 Quarantaine", value: `\`${rolesToStrip.size}\` rôle(s) sauvegardé(s) en mémoire.`, inline: false }
            )
            .setFooter({ text: "Team HeLoRiA Fortress Security", iconURL: client.user.displayAvatarURL() })
            .setTimestamp();

        sendLog(CHANNELS.ANTI_NUKE, criticalEmbed);
        sendLog(CHANNELS.SANCTION_AUTO, criticalEmbed);
    };

    // --- GESTION DES QUOTAS STAFF (3 ACTIONS / 1 MIN) ---
    const trackActionQuota = async (guild, userId, type, limitValue, actionLabel) => {
        if (isImmune(userId, guild)) return false;

        const now = Date.now();
        const trackingKey = `${userId}_${type}`;

        if (!actionTrackers.has(trackingKey)) actionTrackers.set(trackingKey, []);
        
        let timestamps = actionTrackers.get(trackingKey).filter(t => now - t < WINDOW_TIME);
        timestamps.push(now);
        actionTrackers.set(trackingKey, timestamps);

        if (timestamps.length > limitValue) {
            await executeStaffSanction(guild, userId, `Dépassement du quota de ${actionLabel} (${timestamps.length}/${limitValue} par min)`);
            return true;
        }
        return false;
    };

    // ==========================================
    // 🛡️ ÉVÉNEMENTS ANTI-NUKE (SALONS, RÔLES, BANS)
    // ==========================================

    // Anti-Mass Suppression/Création Salons
    client.on("channelDelete", async (channel) => {
        if (!channel.guild) return;
        const logs = await channel.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelDelete }).catch(() => null);
        const entry = logs?.entries.first();
        if (entry && entry.executor) {
            await trackActionQuota(channel.guild, entry.executor.id, "channel_delete", db.limits.channel, "Suppression de salons");
        }
    });

    // Anti-Mass Suppression Rôles
    client.on("roleDelete", async (role) => {
        const logs = await role.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.RoleDelete }).catch(() => null);
        const entry = logs?.entries.first();
        if (entry && entry.executor) {
            await trackActionQuota(role.guild, entry.executor.id, "role_delete", db.limits.role, "Suppression de rôles");
        }
    });

    // Anti-Mass Ban
    client.on("guildBanAdd", async (ban) => {
        const logs = await ban.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberBanAdd }).catch(() => null);
        const entry = logs?.entries.first();
        if (entry && entry.executor) {
            await trackActionQuota(ban.guild, entry.executor.id, "member_ban", db.limits.ban, "Bannissements de membres");
        }
    });

    // ==========================================
    // 🔗 ÉVÉNEMENT ANTI-LINK / ANTI-PUB
    // ==========================================
    client.on("messageCreate", async (msg) => {
        if (!msg.guild || msg.author.bot) return;

        // Détection des liens d'invitation Discord
        const discordInviteRegex = /(discord\.(gg|io|me|li)|discordapp\.com\/invite|discord\.com\/invite)\/([a-zA-Z0-9\-]+)/gi;

        if (discordInviteRegex.test(msg.content)) {
            // Si le membre est immunisé/whitelist, on laisse passer
            if (isImmune(msg.author.id, msg.guild)) return;

            // 1. Suppression du message
            await msg.delete().catch(() => {});

            // 2. Avertissement temporaire dans le salon
            const warnMsg = await msg.channel.send(`⚠️ <@${msg.author.id}>, les liens d'invitations Discord sont strictement interdits ici !`).catch(() => null);
            if (warnMsg) setTimeout(() => warnMsg.delete().catch(() => {}), 5000);

            // 3. Log Détaillé
            const timestampFormat = `<t:${Math.floor(Date.now() / 1000)}:F>`;
            
            const linkEmbed = new EmbedBuilder()
                .setColor("#ff9800")
                .setTitle("🔗 LIEN DE PUB DÉTECTÉ ET SUPPRIMÉ")
                .setThumbnail(msg.author.displayAvatarURL({ dynamic: true }))
                .addFields(
                    { name: "👤 Auteur", value: `${msg.author} (\`${msg.author.username}\`)`, inline: true },
                    { name: "🆔 ID Auteur", value: `\`${msg.author.id}\``, inline: true },
                    { name: "📍 Salon", value: `${msg.channel} (\`${msg.channel.id}\`)`, inline: true },
                    { name: "📅 Date & Heure", value: timestampFormat, inline: false },
                    { name: "💬 Contenu du Message", value: `\`\`\`${msg.content.slice(0, 1000)}\`\`\``, inline: false }
                )
                .setFooter({ text: "Team HeLoRiA Fortress Anti-Pub", iconURL: client.user.displayAvatarURL() })
                .setTimestamp();

            sendLog(CHANNELS.ANTI_LINK, linkEmbed);
        }
    });

    // ==========================================
    // 👤 ÉVÉNEMENT REJOINDRE LE SERVEUR
    // ==========================================
    client.on("guildMemberAdd", async (member) => {
        const server = member.guild;
        const timeNow = Date.now();
        const timestampFormat = `<t:${Math.floor(timeNow / 1000)}:F>`;

        // 1. Anti-Bot Strict
        if (member.user.bot && db.antiBot) {
            const logs = await server.fetchAuditLogs({ limit: 1, type: AuditLogEvent.BotAdd }).catch(() => null);
            const logEntry = logs?.entries.first();
            
            if (logEntry && !isImmune(logEntry.executor.id, server)) {
                await member.ban({ reason: "Bot non autorisé" }).catch(() => {});
                await executeStaffSanction(server, logEntry.executor.id, `Invitation d'un bot non autorisé : ${member.user.tag}`);

                const botLogEmbed = new EmbedBuilder()
                    .setColor("#b71c1c")
                    .setTitle("🤖 TENTATIVE D'INVITATION DE BOT BLOQUÉE")
                    .addFields(
                        { name: "🤖 Bot Banni", value: `${member.user.tag} (\`${member.id}\`)`, inline: true },
                        { name: "👤 Invité par", value: `<@${logEntry.executor.id}> (\`${logEntry.executor.id}\`)`, inline: true },
                        { name: "📅 Date & Heure", value: timestampFormat, inline: false }
                    );

                sendLog(CHANNELS.ANTI_BOT, botLogEmbed);
            }
            return;
        }

        // 2. Détection Vague de Raid
        recentJoins = recentJoins.filter(t => timeNow - t < RAID_WINDOW);
        recentJoins.push(timeNow);
        if (recentJoins.length >= RAID_LIMIT && !raidAlertOn) {
            raidAlertOn = true;
            const raidEmbed = new EmbedBuilder()
                .setColor("#ef6c00")
                .setTitle("🚨 ALERTE RAID DÉTECTÉE")
                .setDescription(`Afflux massif de **${recentJoins.length} nouveaux membres** en moins de 30 secondes.`)
                .addFields({ name: "📅 Date & Heure", value: timestampFormat, inline: false })
                .setFooter({ text: "Team HeLoRiA Fortress Anti-Raid", iconURL: client.user.displayAvatarURL() });

            sendLog(CHANNELS.ANTI_RAID, raidEmbed);
            setTimeout(() => { raidAlertOn = false; }, 60000); // Réinitialisation de l'alerte après 1 min
        }
    });
};