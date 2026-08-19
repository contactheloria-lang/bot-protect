const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');

// Configuration du salon et du rôle
const HONEYPOT_CHANNEL_ID = '1538677488128102501';
const ADMIN_ROLE_ID = '1532015026851020871';
const STAFF_PIN_CODE = '4927';

// Émojis du système
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

// Registre des membres autorisés
const authenticatedStaff = new Set();

/**
 * Génère l'intégration d'avertissement officiel pour le salon piège
 */
function createHoneypotEmbed(client) {
    return new EmbedBuilder()
        .setTitle(`${EMOJIS.WARNING} ${EMOJIS.LOCK} **SALON SÉCURISÉ — ZONE DE RESTRICTION** ${EMOJIS.LOCK} ${EMOJIS.WARNING}`)
        .setDescription(
            `# ${EMOJIS.CROWN} **DISPOSITIF DE PROTECTION AUTOMATISÉ**\n\n` +
            `> ${EMOJIS.QUILL} ***Avertissement officiel :*** *Ce salon est sous la surveillance directe du module de sécurité **HeLoRiA Fortress**. Il sert de piège de sécurité destiné à intercepter et neutraliser les comptes automatisés ainsi que les tentatives de raid.*\n\n` +
            `~~` + '─'.repeat(32) + `~~\n\n` +
            `### ${EMOJIS.RULES} **DIRECTIVES ET CONSIGNES D'ACCÈS**\n` +
            `* ${EMOJIS.BLURPLE_BAN} **Interdiction absolue :** *Ne publiez **AUCUN** message dans cet espace sous peine de sanction automatique.*\n` +
            `* ${EMOJIS.UPDATE} **Procédure d'expulsion :** *Toute interaction textuelle provoque l'expulsion immédiate et sans préavis du serveur.*\n` +
            `* ${EMOJIS.CERTIFIED} **Utilisateurs légitimes :** *Si vous êtes un utilisateur humain, veuillez ignorer ce salon et poursuivre votre navigation.*\n\n` +
            `~~` + '─'.repeat(32) + `~~`
        )
        .setColor(0xFF0000)
        .setFooter({ 
            text: "HeLoRiA Fortress • Système de Sécurité Anti-Raid", 
            iconURL: client.user.displayAvatarURL() 
        })
        .setTimestamp();
}

/**
 * Module principal de gestion du salon piège
 */
module.exports = function initHoneypot(client) {
    client.on('messageCreate', async (message) => {
        if (message.channel.id !== HONEYPOT_CHANNEL_ID) return;
        if (message.author.bot) return;

        // Commande d'installation de l'affichage officiel
        if (message.content === '!installation-piege' && message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            await message.channel.send({ embeds: [createHoneypotEmbed(client)] });
            await message.delete().catch(() => {});
            return;
        }

        // Vérification de la présence du rôle ou de la permission d'administration
        const isStaff = message.member.roles.cache.has(ADMIN_ROLE_ID) || 
                        message.member.permissions.has(PermissionFlagsBits.Administrator);

        // --- PROCÉDURE DE VÉRIFICATION POUR LE PERSONNEL AUTORISÉ ---
        if (isStaff) {
            if (authenticatedStaff.has(message.author.id)) return;

            if (message.content.trim() === STAFF_PIN_CODE) {
                await message.delete().catch(() => {});
                authenticatedStaff.add(message.author.id);

                const confirmMsg = await message.channel.send(
                    `${EMOJIS.CERTIFIED} <@${message.author.id}>, **Code de sécurité validé.** *Accès autorisé pour ce salon.*`
                );
                setTimeout(() => confirmMsg.delete().catch(() => {}), 4000);
                return;
            }

            await message.delete().catch(() => {});
            const pinNotice = await message.channel.send(
                `${EMOJIS.LOCK} <@${message.author.id}>, **Espace verrouillé.** *Veuillez saisir le **code de sécurité** dans ce salon pour débloquer votre accès.*`
            );
            setTimeout(() => pinNotice.delete().catch(() => {}), 5000);
            return;
        }

        // --- SANCTION AUTOMATIQUE DES INTRUS ---
        try {
            await message.delete().catch(() => {});

            if (message.member && message.member.kickable) {
                await message.member.kick('🚨 Détection piège : Publication interdite dans le salon de sécurité.');
                console.log(`🚨 [SÉCURITÉ] Utilisateur expulsé : ${message.author.tag} (${message.author.id})`);
            }

            const warningMsg = await message.channel.send(
                `${EMOJIS.WARNING} <@${message.author.id}> *a été expulsé du serveur.* **Rappel :** *Ce salon est une zone sous contrôle strict.*`
            );
            setTimeout(() => warningMsg.delete().catch(() => {}), 5000);

        } catch (err) {
            console.error('⚠️ [ERREUR SÉCURITÉ] Échec de la procédure d\'expulsion :', err);
        }
    });
};

module.exports.createHoneypotEmbed = createHoneypotEmbed;
module.exports.STAFF_PIN_CODE = STAFF_PIN_CODE;
