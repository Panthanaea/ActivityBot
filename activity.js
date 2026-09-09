const {
  getGuildConfig,
  getExcludedRoles,
  upsertLastActive,
  getActivity,
} = require('../database');

/**
 * Record activity for a member and, if they were tagged "inactive",
 * immediately clear that status and remove the role. This makes reactivation
 * instant instead of waiting for the next daily sweep.
 *
 * @param {import('discord.js').Guild} guild
 * @param {string} userId
 */
async function recordActivity(guild, userId) {
  if (!guild) return;

  const config = getGuildConfig(guild.id);
  const now = Date.now();
  const priorRow = getActivity(guild.id, userId);
  upsertLastActive(guild.id, userId, now);

  // If they were previously marked inactive, un-mark them and strip the role.
  if (priorRow && priorRow.inactive_marked_at && config.inactive_role_id) {
    try {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (member && member.roles.cache.has(config.inactive_role_id)) {
        await member.roles.remove(config.inactive_role_id, 'ActivityBot: member became active again');
      }
    } catch (err) {
      console.error(`[activity] Failed to clear inactive role for ${userId} in ${guild.id}:`, err);
    }
  }
}

/**
 * Whether a guild member should be exempt from activity tracking/pruning
 * because they hold one of the excluded roles.
 */
function isExcluded(member, guildId) {
  const excludedRoles = getExcludedRoles(guildId);
  if (excludedRoles.length === 0) return false;
  return member.roles.cache.some((role) => excludedRoles.includes(role.id));
}

module.exports = { recordActivity, isExcluded };
