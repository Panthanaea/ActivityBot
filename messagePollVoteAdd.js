const { Events } = require('discord.js');
const { recordActivity } = require('../utils/activity');

// Requires discord.js >= 14.15, which added native Poll support.
// The event fires with (pollAnswer, userId). pollAnswer gives us access back
// to the poll -> message -> guild chain.
module.exports = {
  name: Events.MessagePollVoteAdd,
  async execute(pollAnswer, userId) {
    try {
      const poll = pollAnswer.poll;
      let message = poll?.message;

      // The message attached to the poll may be partial; fetch if needed.
      if (message?.partial) {
        message = await message.fetch();
      }

      const guild = message?.guild;
      if (!guild) return;

      const user = await guild.client.users.fetch(userId).catch(() => null);
      if (user?.bot) return;

      await recordActivity(guild, userId);
    } catch (err) {
      console.error('[messagePollVoteAdd] Failed to record poll vote activity:', err);
    }
  },
};
