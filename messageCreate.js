const { Events } = require('discord.js');
const { recordActivity } = require('../utils/activity');

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (!message.guild || message.author.bot) return;
    await recordActivity(message.guild, message.author.id);
  },
};
