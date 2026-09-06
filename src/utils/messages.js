/**
 * Turns a day count into natural phrasing: 365 -> "a year", 1 -> "1 day",
 * else "N days". Used so the DM still reads naturally for non-default
 * thresholds (the threshold is configurable 1-365 per server).
 */
function formatDaysPhrase(days) {
  if (days === 365) return 'a year';
  if (days === 1) return '1 day';
  return `${days} days`;
}

/**
 * Builds the DM sent to a member the moment they're tagged with the
 * inactive role.
 */
function buildInactiveDm({ username, guildName, thresholdDays, pruneAfterDays }) {
  return (
    `Hello @${username}! We noticed you haven't been active in ${guildName} for ${formatDaysPhrase(
      thresholdDays
    )}, so we have given you the inactive role. To avoid being pruned, sometime in the next ` +
    `${pruneAfterDays} days you should go drop a react on someone's message, post a message, ` +
    `click Interested on an event, vote in a poll, or connect to a voice channel/stage.`
  );
}

const DEFAULT_FAREWELL_MESSAGE =
  "You have been removed from {server_name} due to prolonged inactivity.";

/**
 * Replaces {username} and {server_name} tokens in an admin-defined (or
 * default) template.
 */
function fillTemplate(template, { username, guildName }) {
  return template.replace(/\{username\}/g, username).replace(/\{server_name\}/g, guildName);
}

/**
 * Builds the DM sent to a member right before they're kicked in the monthly
 * prune. Falls back to a sensible default if the admin hasn't set one.
 */
function buildFarewellMessage({ template, username, guildName }) {
  const source = template && template.trim().length > 0 ? template : DEFAULT_FAREWELL_MESSAGE;
  return fillTemplate(source, { username, guildName });
}

module.exports = { buildInactiveDm, formatDaysPhrase, buildFarewellMessage, DEFAULT_FAREWELL_MESSAGE };
