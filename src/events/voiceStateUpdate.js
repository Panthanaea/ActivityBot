const { Events } = require('discord.js');
const { recordActivity } = require('../utils/activity');

// Counts joining any voice channel (regular voice or stage) as activity.
// VoiceStateUpdate only ever fires for voice/stage channels, so any new
// channelId here is one of those two channel types.
module.exports = {
  name: Events.VoiceStateUpdate,
  async execute(oldState, newState) {
    const user = newState.member?.user ?? oldState.member?.user;
    if (!user || user.bot) return;

    const joinedNewChannel = newState.channelId && newState.channelId !== oldState.channelId;
    if (!joinedNewChannel) return;

    await recordActivity(newState.guild, user.id);
  },
};
