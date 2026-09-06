const { Events } = require('discord.js');
const { startScheduler } = require('../scheduler');

module.exports = {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    console.log(`[ready] Logged in as ${client.user.tag} (${client.user.id})`);
    console.log(`[ready] Watching ${client.guilds.cache.size} guild(s).`);
    startScheduler(client);
  },
};
