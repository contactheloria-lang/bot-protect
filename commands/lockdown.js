const { EmbedBuilder, PermissionFlagsBits } = require("discord.js");

module.exports = async (client, message) => {
    // Vérification des permissions Administrateur
    if (!message.member?.permissions.has(PermissionFlagsBits.Administrator)) {
        return message.reply("❌ Tu dois être **Administrateur** pour utiliser cette commande.");
    }

    // --- COMMANDE +LOCK ---
    if (message.content.startsWith("+lock")) {
        client.isLockdown = true;

        const lockEmbed = new EmbedBuilder()
            .setColor("#b71c1c")
            .setTitle("🔒 MUTE GLOBAL / LOCKDOWN D'URGENCE ACTIVÉ")
            .setDescription("Le serveur a été verrouillé par l'administration. Tous les envois de messages par les membres sont temporairement bloqués.")
            .setFooter({ text: "Team HeLoRiA Fortress Security", iconURL: client.user.displayAvatarURL() })
            .setTimestamp();

        return message.channel.send({ embeds: [lockEmbed] });
    }

    // --- COMMANDE +UNLOCK ---
    if (message.content.startsWith("+unlock")) {
        client.isLockdown = false;

        const unlockEmbed = new EmbedBuilder()
            .setColor("#43a047")
            .setTitle("🔓 LOCKDOWN DÉSACTIVÉ")
            .setDescription("Le verrouillage d'urgence a été levé. Le serveur reprend son fonctionnement habituel.")
            .setFooter({ text: "Team HeLoRiA Fortress Security", iconURL: client.user.displayAvatarURL() })
            .setTimestamp();

        return message.channel.send({ embeds: [unlockEmbed] });
    }
};