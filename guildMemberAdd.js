const { Events } = require('discord.js');
const { ensureActivityRow } = require('../database');

// Give new members a baseline "last active" timestamp on join, so they get a
// full grace period before the inactivity clock can flag them.
module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    if (member.user.bot) return;
    ensureActivityRow(member.guild.id, member.id, member.joinedTimestamp ?? Date.now());
  },
};
