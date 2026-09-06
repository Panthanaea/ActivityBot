const { Events } = require('discord.js');
const { recordActivity } = require('../utils/activity');

// Fired when a user marks themselves "Interested" in a scheduled event.
module.exports = {
  name: Events.GuildScheduledEventUserAdd,
  async execute(guildScheduledEvent, user) {
    if (user.bot) return;
    const guild = guildScheduledEvent.guild;
    if (!guild) return;
    await recordActivity(guild, user.id);
  },
};
