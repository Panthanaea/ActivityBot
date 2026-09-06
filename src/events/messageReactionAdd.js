const { Events } = require('discord.js');
const { recordActivity } = require('../utils/activity');

module.exports = {
  name: Events.MessageReactionAdd,
  async execute(reaction, user) {
    if (user.bot) return;

    try {
      if (reaction.partial) await reaction.fetch();
      if (reaction.message.partial) await reaction.message.fetch();
    } catch (err) {
      console.error('[messageReactionAdd] Failed to fetch partial reaction/message:', err);
      return;
    }

    const guild = reaction.message.guild;
    if (!guild) return;
    await recordActivity(guild, user.id);
  },
};
