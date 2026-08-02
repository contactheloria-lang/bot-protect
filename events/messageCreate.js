const { EmbedBuilder } = require("discord.js");
const lockdownCmd = require("../commands/lockdown");
const handleAntiSpam = require("../modules/antiSpam");

const UNVERIFIED_ROLE_NAME = "Non-Vérifié";
const VERIFIED_ROLE_NAME = "Membre";

module.exports = async (client, message) => {
    if (message.author.bot) return;

    // Sécurisation des Maps de mémoire sur le client
    if (!client.captchaSessions) client.captchaSessions = new Map();
    if (!client.spamTracker) client.spamTracker = new Map();

    // ==========================================
    // 📩 A. RÉPONSES AU CAPTCHA (MESSAGE PRIVÉ)
    // ==========================================
    if (!message.guild) {
        if (client.captchaSessions.has(message.author.id)) {
            const session = client.captchaSessions.get(message.author.id);
            const expectedAnswer = typeof session === "object" ? session.result : session;
            const guildId = typeof session === "object" ? session.guildId : null;
            const userAnswer = parseInt(message.content.trim(), 10);

            if (userAnswer === expectedAnswer) {
                client.captchaSessions.delete(message.author.id);

                // Si on a l'ID du serveur, on attribue le rôle Membre
                if (guildId) {
                    const guild = client.guilds.cache.get(guildId);
                    if (guild) {
                        const member = await guild.members.fetch(message.author.id).catch(() => null);
                        if (member) {
                            const unverifiedRole = guild.roles.cache.find(r => r.name === UNVERIFIED_ROLE_NAME);
                            const verifiedRole = guild.roles.cache.find(r => r.name === VERIFIED_ROLE_NAME);

                            if (unverifiedRole) await member.roles.remove(unverifiedRole).catch(() => {});
                            if (verifiedRole) await member.roles.add(verifiedRole).catch(() => {});
                        }
                    }
                }

                await message.reply("🎉 **Captcha validé avec succès !** Ton accès au serveur a été débloqué.").catch(() => {});
            } else {
                await message.reply("❌ **Réponse incorrecte.** Veuillez réessayer !").catch(() => {});
            }
        }
        return;
    }

    // ==========================================
    // 🔒 B. COMMANDES DE LOCKDOWN (+lock / +unlock)
    // ==========================================
    if (message.content.startsWith("+lock") || message.content.startsWith("+unlock")) {
        return lockdownCmd(client, message);
    }

    // ==========================================
    // 🚨 C. TRAITEMENT DU MODE LOCKDOWN
    // ==========================================
    if (client.isLockdown && !message.member?.permissions.has("Administrator")) {
        await message.delete().catch(() => {});
        const notice = await message.channel.send(`⛔ ${message.author}, le serveur est sous **Lockdown d'urgence**. Vous ne pouvez pas envoyer de messages.`).catch(() => null);
        if (notice) setTimeout(() => notice.delete().catch(() => {}), 4000);
        return;
    }

    // ==========================================
    // 🛡️ D. FILTRE ANTI-SPAM (MODULE EXTERNE)
    // ==========================================
    const isSpamDetected = await handleAntiSpam(client, message);
    if (isSpamDetected) return; // Si intercepté par l'Anti-Spam, on arrête l'exécution

    // ==========================================
    // ⚡ E. FLOOD COMBINÉ ET SUIVI RAPIDITÉ
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