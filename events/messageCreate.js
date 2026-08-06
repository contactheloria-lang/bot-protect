const { EmbedBuilder } = require("discord.js");
const lockdownCmd = require("../commands/lockdown");
const handleAntiSpam = require("../modules/antiSpam");

module.exports = async (client, message) => {
    // On ignore les bots et les messages privés
    if (message.author.bot || !message.guild) return;

    // Sécurisation de la Map de suivi du flood
    if (!client.spamTracker) client.spamTracker = new Map();

    // ==========================================
    // 🔒 A. COMMANDES DE LOCKDOWN (+lock / +unlock)
    // ==========================================
    if (message.content.startsWith("+lock") || message.content.startsWith("+unlock")) {
        return lockdownCmd(client, message);
    }

    // ==========================================
    // 🚨 B. TRAITEMENT DU MODE LOCKDOWN
    // ==========================================
    if (client.isLockdown && !message.member?.permissions.has("Administrator")) {
        await message.delete().catch(() => {});
        const notice = await message.channel.send(`⛔ ${message.author}, le serveur est sous **Lockdown d'urgence**. Vous ne pouvez pas envoyer de messages.`).catch(() => null);
        if (notice) setTimeout(() => notice.delete().catch(() => {}), 4000);
        return;
    }

    // ==========================================
    // 🛡️ C. FILTRE ANTI-SPAM (MODULE EXTERNE)
    // ==========================================
    const isSpamDetected = await handleAntiSpam(client, message);
    if (isSpamDetected) return; // Si intercepté par l'Anti-Spam, on arrête l'exécution

    // ==========================================
    // ⚡ D. FLOOD COMBINÉ ET SUIVI RAPIDITÉ
    // ==========================================
    const userId = message.author.id;
    const now = Date.now();
    const tracker = client.spamTracker.get(userId) || { count: 0, firstMsgTime: now, warns: 0 };

    if (now - tracker.firstMsgTime < 10000) {
        tracker.count++;
        if (tracker.count >= 5) {
            if (tracker.warns === 0) {
                tracker.warns = 1;
                tracker.count = 0;
                tracker.firstMsgTime = now;
                client.spamTracker.set(userId, tracker);

                const warn = await message.channel.send(`⚠️ ${message.author}, attention au flood ! (Avertissement 1/2)`).catch(() => null);
                if (warn) setTimeout(() => warn.delete().catch(() => {}), 4000);
            } else {
                client.spamTracker.delete(userId);
                if (message.member?.bannable) {
                    await message.guild.members.ban(userId, { reason: "Anti-Flood : Spam massif répété" }).catch(console.error);
                    await message.channel.send(`🔨 **${message.author.tag}** a été banni pour flood excessif.`).catch(() => {});
                }
            }
            return;
        }
    } else {
        tracker.count = 1;
        tracker.firstMsgTime = now;
    }

    client.spamTracker.set(userId, tracker);
};