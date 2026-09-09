const { PermissionFlagsBits } = require('discord.js');

/**
 * ActivityBot config commands require Manage Server (or Administrator).
 */
function isAdmin(interaction) {
  return (
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
  );
}

module.exports = { isAdmin };
