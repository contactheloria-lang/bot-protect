const { EmbedBuilder, AuditLogEvent } = require("discord.js");
const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "../data/fortress_config.json");

// Suivi des arrivées en mémoire pour la détection JoinRaid
let recentJoins = [];
let raidModeActive = false;

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
 * Traitement principal des nouvelles entrées sur le serveur
 */
async function handleJoinGate(client, member) {
    const config = getConfig();
    if (!config) return;

    const guild = member.guild;
    const now = Date.now();
    const settings = config.joinGate || {
        minAccountAgeDays: 7,
        blockDefaultAvatar: true,
        raidThreshold: 5,
        raidTimeframeSec: 10
    };

    // ---------------------------------------------------------
    // 1. SÉCURITÉ ANTI-BOT NON AUTORISÉ
    // ---------------------------------------------------------
    if (member.user.bot) {
        const auditLogs = await guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.BotAdd }).catch(() => null);
        const entry = auditLogs?.entries.first();

        if (entry && !isImmune(entry.executor.id, guild, config)) {
            // Bannissement du bot non autorisé
            await member.ban({ reason: "[JOINGATE] Bot non autorisé invité par un membre hors whitelist." }).catch(() => {});

            // Log d'alerte critique
            const botEmbed = new EmbedBuilder()
                .setColor("#B71C1C")
                .setTitle("🚨 BOT NON AUTORISÉ BANNI")
                .addFields(
                    { name: "🤖 Bot", value: `${member.user.tag} (\`${member.id}\`)`, inline: true },
                    { name: "👤 Invité par", value: `<@${entry.executor.id}> (\`${entry.executor.id}\`)`, inline: true }
                )
                .setTimestamp();

            const logChan = await client.channels.fetch(config.channels?.logsAntiBot).catch(() => null);
            if (logChan) logChan.send({ embeds: [botEmbed] });
            return;
        }
    }

    // ---------------------------------------------------------
    // 2. DÉTECTION JOINRAID (AFFLUX MASSIF D'ARRIVÉES)
    // ---------------------------------------------------------
    const timeframeMs = (settings.raidTimeframeSec || 10) * 1000;
    recentJoins = recentJoins.filter(timestamp => now - timestamp < timeframeMs);
    recentJoins.push(now);

    if (recentJoins.length >= (settings.raidThreshold || 5) && !raidModeActive) {
        raidModeActive = true;

        const raidEmbed = new EmbedBuilder()
            .setColor("#EF6C00")
            .setTitle("🚨 ALERTE JOINRAID : VAGUE D'ENTRÉES DÉTECTÉE")
            .setDescription(`**${recentJoins.length} nouveaux membres** ont rejoint le serveur en moins de **${settings.raidTimeframeSec} secondes**.`)
            .addFields({ name: "⚡ Action recommandative", value: "Le système renforce la sécurité des nouveaux arrivants." })
            .setTimestamp();

        const logChan = await client.channels.fetch(config.channels?.logsAntiRaid).catch(() => null);
        if (logChan) logChan.send({ embeds: [raidEmbed] });

        // Réinitialisation du mode d'alerte après 2 minutes
        setTimeout(() => { raidModeActive = false; }, 120000);
    }

    // ---------------------------------------------------------
    // 3. FILTRAGE PARE-FEU JOINGATE
    // ---------------------------------------------------------
    let isRejected = false;
    let rejectionReason = "";

    // A. Filtrage des avatars par défaut
    if (settings.blockDefaultAvatar && !member.user.avatar) {
        isRejected = true;
        rejectionReason = "Compte sans photo de profil (Avatar par défaut)";
    }

    // B. Filtrage sur l'âge du compte
    const accountAgeDays = (now - member.user.createdTimestamp) / (1000 * 60 * 60 * 24);
    if (!isRejected && accountAgeDays < settings.minAccountAgeDays) {
        isRejected = true;
        rejectionReason = `Compte trop récent (${Math.floor(accountAgeDays)} jours, minimum requis : ${settings.minAccountAgeDays} jours)`;
    }

    // ---------------------------------------------------------
    // 4. SANCTION ET LOGS DE REJET
    // ---------------------------------------------------------
    if (isRejected) {
        // Envoi d'un MP informatif avant expulsion (si possible)
        await member.send(`⚠️ Votre accès au serveur **${guild.name}** a été refusé. Motif : *${rejectionReason}*.`).catch(() => {});

        // Expulsion du membre (Kick)
        await member.kick(`[JOINGATE] ${rejectionReason}`).catch(() => {});

        const rejectEmbed = new EmbedBuilder()
            .setColor("#D32F2F")
            .setTitle("🚫 ACCÈS REFUSÉ PAR JOINGATE")
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: "👤 Utilisateur", value: `${member.user.tag} (\`${member.id}\`)`, inline: true },
                { name: "⚠️ Raison du Rejet", value: `\`${rejectionReason}\``, inline: false },
                { name: "📅 Création du Compte", value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:F>`, inline: true }
            )
            .setTimestamp();

        const logChan = await client.channels.fetch(config.channels?.logsAntiRaid).catch(() => null);
        if (logChan) logChan.send({ embeds: [rejectEmbed] });
    }
}

module.exports = { handleJoinGate };