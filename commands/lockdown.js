module.exports = async (client, message) => {
    if (!message.member.permissions.has('Administrator')) {
        return message.reply("❌ Tu dois être Administrateur pour utiliser cette commande.");
    }

    if (message.content.startsWith('+lock')) {
        client.isLockdown = true;
        return message.channel.send("🔒 **Le serveur est désormais en mode Lockdown d'urgence.**");
    }

    if (message.content.startsWith('+unlock')) {
        client.isLockdown = false;
        return message.channel.send("🔓 **Le mode Lockdown a été désactivé.**");
    }
};