const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');

// Configuration
const HONEYPOT_CHANNEL_ID = 'TON_ID_DE_SALON_HONEYPOT'; // ID du salon piège
const STAFF_PIN_CODE = '4927'; // Code PIN requis pour le staff

// Emojis de ton système
const EMOJIS = {
    TELESCOPE: '<:65264telescope:1537586517453832222>',
    CROWN: '<a:darkbluecrown:1533535362566324245>',
    QUILL: '<:6880quill:1537585310794391563>',
    HLRWIN: '<:hlrwin:1537584105536094248>',
    RULES: '<:580437rules:1537583160345366578>',
    TRIALMOD: '<:94919trialmod:1537582836318609521>',
    MIC: '<:68052micanimation:1537582247278813204>',
    BLURPLE_MOD: '<:3446blurplecertifiedmoderator:1533535324309815367>',
    BLURPLE_BAN: '<:9299blurpleban:1533535325996056807>',
    TICKET: '<:29909ticket:1537580036159316108>',
    BRIEFCASE: '<:75828briefcase:1537579702812807248>',
    CERTIFIED: '<:20336certified:1537579306690281544>',
    HANDSHAKE: '<:600404handshake:1537578056447828058>',
    PAYPAL: '<:1716_PAYPAL:1537578291593093240>',
    MONEY: '<:63043moneyspread:1537577805829636117>',
    PREMIUM: '<:5647premiumicon:1533535330538360942>',
    LOCK: '<a:lockicon:1533535370787033198>',
    UPDATE: '<:update:1533535384674369777>',
    LOADING: '<a:loadingicon:1533535386951749683>',
    WARNING: '<:warningd:1533535400176386068>'
};

// Stockage temporaire des membres du staff authentifiés
const authenticatedStaff = new Set();

/**
 * Crée l'embed d'avertissement permanent pour le salon Honeypot
 */
function createHoneypotEmbed(client) {
    return new EmbedBuilder()
        .setTitle(`${EMOJIS.WARNING} ${EMOJIS.LOCK} SALON SÉCURISÉ — ZONE INTERDITE ${EMOJIS.LOCK} ${EMOJIS.WARNING}`)
        .setDescription(
            `# ${EMOJIS.CROWN} **SYSTÈME DE DÉTECTION AUTOMATISÉ**\n\n` +
            `> ${EMOJIS.QUILL} ***Attention :*** Ce salon fait partie intégrante du système de sécurité **HeLoRiA Fortress**. Il est exclusivement conçu pour piéger et neutraliser les comptes automatisés et les tentatives de raid.\n\n` +
            `~~` + '─'.repeat(32) + `~~\n\n` +
            `### ${EMOJIS.RULES} **AIDE-MÉMOIRE & RÈGLES D'ACCÈS**\n` +
            `* ${EMOJIS.BLURPLE_BAN} **Interdiction absolue :** N'envoyez **AUCUN** message dans ce salon sous aucun prétexte.\n` +
            `* ${EMOJIS.UPDATE} **Sanction automatique :** Tout envoi de message déclenche une expulsion immédiate du serveur.\n` +
            `* ${EMOJIS.CERTIFIED} **Membre légitime :** Si vous êtes un humain, ignorez simplement ce salon et poursuivez votre navigation.\n\n` +
            `~~` + '─'.repeat(32) + `~~`
        )
        .setColor(0xFF0000)
        .setFooter({ 
            text: "HeLoRiA Fortress • Sécurité Anti-Raid", 
            iconURL: client.user.displayAvatarURL() 
        })
        .setTimestamp();
}

/**
 * Gestionnaire principal du Honeypot
 */
module.exports = function initHoneypot(client) {
    client.on('messageCreate', async (message) => {
        // Filtrage du salon et des bots
        if (message.channel.id !== HONEYPOT_CHANNEL_ID) return;
        if (message.author.bot) return;

        const isStaff = message.member.permissions.has(PermissionFlagsBits.Administrator) || 
                        message.member.permissions.has(PermissionFlagsBits.ManageMessages);

        // --- GESTION DU STAFF (AVEC CODE PIN) ---
        if (isStaff) {
            // Si le staff est déjà authentifié, le message passe
            if (authenticatedStaff.has(message.author.id)) return;

            // Si le staff envoie le code PIN valide
            if (message.content.trim() === STAFF_PIN_CODE) {
                await message.delete().catch(() => {});
                authenticatedStaff.add(message.author.id);

                const confirmMsg = await message.channel.send(
                    `${EMOJIS.CERTIFIED} <@${message.author.id}>, **Code PIN valide.** Accès staff déverrouillé pour ce salon.`
                );
                setTimeout(() => confirmMsg.delete().catch(() => {}), 4000);
                return;
            }

            // Si le staff n'a pas mis le bon PIN
            await message.delete().catch(() => {});
            const pinNotice = await message.channel.send(
                `${EMOJIS.LOCK} <@${message.author.id}>, **Salon verrouillé.** Entrez le **code PIN Staff** dans ce salon pour débloquer la parole.`
            );
            setTimeout(() => pinNotice.delete().catch(() => {}), 5000);
            return;
        }

        // --- GESTION DES MEMBRES NORMAUX (HONEYPOT) ---
        try {
            await message.delete().catch(() => {});

            if (message.member && message.member.kickable) {
                await message.member.kick('🚨 Honeypot : Message envoyé dans un salon piège interdit.');
                console.log(`🚨 [HONEYPOT] Membre expulsé : ${message.author.tag} (${message.author.id})`);
            }

            const warningMsg = await message.channel.send(
                `${EMOJIS.WARNING} <@${message.author.id}> a été expulsé. **Rappel :** Ce salon est une zone piège.`
            );
            setTimeout(() => warningMsg.delete().catch(() => {}), 5000);

        } catch (err) {
            console.error('⚠️ [HONEYPOT ERROR] Échec de l\'expulsion :', err);
        }
    });
};

module.exports.createHoneypotEmbed = createHoneypotEmbed;
module.exports.STAFF_PIN_CODE = STAFF_PIN_CODE;
