const cron = require('node-cron');
const {
  getGuildConfig,
  getAllEnabledGuildConfigs,
  getExcludedRoles,
  getActivity,
  ensureActivityRow,
  markInactive,
  clearInactive,
  getAllInactiveMarked,
  deleteActivity,
} = require('./database');
const { buildInactiveDm, buildFarewellMessage } = require('./utils/messages');

const DAY_MS = 24 * 60 * 60 * 1000;
const PRUNE_AFTER_DAYS = Number(process.env.PRUNE_AFTER_DAYS) || 90;
const SWEEP_CRON = process.env.SWEEP_CRON || '0 3 * * *';
const PRUNE_CRON = process.env.PRUNE_CRON || '0 4 1 * *';

/**
 * Run the inactivity sweep for a single guild: tags newly-inactive members
 * with the configured role, and un-tags anyone who no longer qualifies
 * (e.g. threshold was raised, or they were manually reset).
 */
async function sweepGuild(guild) {
  const config = getGuildConfig(guild.id);
  const result = { tagged: 0, reactivated: 0, skipped: 0 };

  if (!config.inactive_role_id) return result;

  const inactiveRole = await guild.roles.fetch(config.inactive_role_id).catch(() => null);
  if (!inactiveRole) {
    console.warn(`[sweep] Guild ${guild.id}: configured inactive role no longer exists.`);
    return result;
  }

  const excludedRoleIds = getExcludedRoles(guild.id);
  const cutoff = Date.now() - config.threshold_days * DAY_MS;

  const members = await guild.members.fetch();

  for (const member of members.values()) {
    if (member.user.bot) continue;

    const isExcluded = excludedRoleIds.length > 0 && member.roles.cache.some((r) => excludedRoleIds.includes(r.id));
    if (isExcluded) {
      result.skipped += 1;
      // If they're excluded but still holding the role (e.g. excluded after being tagged), free them.
      if (member.roles.cache.has(inactiveRole.id)) {
        await member.roles.remove(inactiveRole, 'ActivityBot: role excluded from tracking').catch(() => null);
        clearInactive(guild.id, member.id);
      }
      continue;
    }

    const activity = ensureActivityRow(guild.id, member.id, member.joinedTimestamp ?? Date.now());
    const hasRole = member.roles.cache.has(inactiveRole.id);

    if (activity.last_active_at < cutoff) {
      if (!hasRole) {
        await member.roles.add(inactiveRole, `ActivityBot: no activity in ${config.threshold_days}+ days`).catch((err) => {
          console.error(`[sweep] Failed to add inactive role to ${member.id} in ${guild.id}:`, err);
        });
        markInactive(guild.id, member.id, Date.now());
        result.tagged += 1;

        const dmText = buildInactiveDm({
          username: member.user.username,
          guildName: guild.name,
          thresholdDays: config.threshold_days,
          pruneAfterDays: PRUNE_AFTER_DAYS,
        });
        await member.send(dmText).catch((err) => {
          console.warn(`[sweep] Could not DM ${member.id} (${member.user.tag}) in ${guild.id} - DMs likely closed: ${err.message}`);
        });
      }
    } else if (hasRole) {
      // They have recent activity but still hold the role (threshold changed, etc). Free them.
      await member.roles.remove(inactiveRole, 'ActivityBot: activity detected within threshold').catch(() => null);
      clearInactive(guild.id, member.id);
      result.reactivated += 1;
    }
  }

  return result;
}

/**
 * Kick anyone who has held the inactive role for PRUNE_AFTER_DAYS or more.
 */
async function pruneGuild(guild) {
  const config = getGuildConfig(guild.id);
  const result = { kicked: 0, failed: 0 };

  if (!config.inactive_role_id) return result;

  const cutoff = Date.now() - PRUNE_AFTER_DAYS * DAY_MS;
  const candidates = getAllInactiveMarked(guild.id).filter((row) => row.inactive_marked_at <= cutoff);

  for (const row of candidates) {
    const member = await guild.members.fetch(row.user_id).catch(() => null);
    if (!member) {
      // They already left; just clean up our records.
      deleteActivity(guild.id, row.user_id);
      continue;
    }

    const farewellText = buildFarewellMessage({
      template: config.farewell_message,
      username: member.user.username,
      guildName: guild.name,
    });
    await member.send(farewellText).catch((err) => {
      console.warn(`[prune] Could not DM farewell to ${member.id} (${member.user.tag}) in ${guild.id} - DMs likely closed: ${err.message}`);
    });

    try {
      await member.kick(`ActivityBot: inactive role held for ${PRUNE_AFTER_DAYS}+ days`);
      deleteActivity(guild.id, row.user_id);
      result.kicked += 1;
    } catch (err) {
      console.error(`[prune] Failed to kick ${row.user_id} in ${guild.id}:`, err);
      result.failed += 1;
    }
  }

  return result;
}

async function runSweepForAllGuilds(client) {
  const configs = getAllEnabledGuildConfigs();
  for (const config of configs) {
    const guild = await client.guilds.fetch(config.guild_id).catch(() => null);
    if (!guild) continue;
    try {
      const result = await sweepGuild(guild);
      console.log(
        `[sweep] Guild ${guild.id} (${guild.name}): tagged=${result.tagged} reactivated=${result.reactivated} skipped=${result.skipped}`
      );
    } catch (err) {
      console.error(`[sweep] Error sweeping guild ${guild.id}:`, err);
    }
  }
}

async function runPruneForAllGuilds(client) {
  const configs = getAllEnabledGuildConfigs();
  for (const config of configs) {
    const guild = await client.guilds.fetch(config.guild_id).catch(() => null);
    if (!guild) continue;
    try {
      const result = await pruneGuild(guild);
      console.log(`[prune] Guild ${guild.id} (${guild.name}): kicked=${result.kicked} failed=${result.failed}`);
    } catch (err) {
      console.error(`[prune] Error pruning guild ${guild.id}:`, err);
    }
  }
}

function startScheduler(client) {
  cron.schedule(SWEEP_CRON, () => {
    console.log('[scheduler] Running daily inactivity sweep...');
    runSweepForAllGuilds(client);
  });

  cron.schedule(PRUNE_CRON, () => {
    console.log('[scheduler] Running monthly inactive-member prune...');
    runPruneForAllGuilds(client);
  });

  console.log(`[scheduler] Sweep cron: "${SWEEP_CRON}" | Prune cron: "${PRUNE_CRON}" (kick after ${PRUNE_AFTER_DAYS}d)`);
}

module.exports = { startScheduler, sweepGuild, pruneGuild, runSweepForAllGuilds, runPruneForAllGuilds };
