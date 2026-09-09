const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  InteractionContextType,
} = require('discord.js');
const {
  getGuildConfig,
  setGuildConfig,
  addExcludedRole,
  removeExcludedRole,
  getExcludedRoles,
  upsertLastActive,
  clearInactive,
  deleteActivity,
} = require('../database');
const { isAdmin } = require('../utils/permissions');
const { sweepGuild } = require('../scheduler');
const { buildFarewellMessage, DEFAULT_FAREWELL_MESSAGE } = require('../utils/messages');

const MAX_THRESHOLD_DAYS = 365;
const MAX_FAREWELL_LENGTH = 1500; // leaves headroom below Discord's 2000-char DM limit after token expansion

module.exports = {
  data: new SlashCommandBuilder()
    .setName('activitybot')
    .setDescription('Configure and manage ActivityBot')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((sub) =>
      sub
        .setName('setup')
        .setDescription('Configure the inactive role and inactivity threshold')
        .addRoleOption((opt) =>
          opt.setName('role').setDescription('Role to assign to inactive members').setRequired(true)
        )
        .addIntegerOption((opt) =>
          opt
            .setName('threshold')
            .setDescription(`Days of no activity before a member is tagged inactive (max ${MAX_THRESHOLD_DAYS})`)
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(MAX_THRESHOLD_DAYS)
        )
    )
    .addSubcommand((sub) => sub.setName('enable').setDescription('Enable inactivity tracking for this server'))
    .addSubcommand((sub) => sub.setName('disable').setDescription('Disable inactivity tracking for this server'))
    .addSubcommand((sub) => sub.setName('status').setDescription('Show the current ActivityBot configuration'))
    .addSubcommand((sub) => sub.setName('sweep').setDescription('Manually run an inactivity sweep right now'))
    .addSubcommand((sub) =>
      sub
        .setName('reset')
        .setDescription("Reset a member's activity clock (marks them active now)")
        .addUserOption((opt) => opt.setName('user').setDescription('Member to reset').setRequired(true))
    )
    .addSubcommandGroup((group) =>
      group
        .setName('exclude')
        .setDescription('Manage roles excluded from inactivity tracking')
        .addSubcommand((sub) =>
          sub
            .setName('add')
            .setDescription('Exclude a role from inactivity tracking')
            .addRoleOption((opt) => opt.setName('role').setDescription('Role to exclude').setRequired(true))
        )
        .addSubcommand((sub) =>
          sub
            .setName('remove')
            .setDescription('Stop excluding a role from inactivity tracking')
            .addRoleOption((opt) => opt.setName('role').setDescription('Role to stop excluding').setRequired(true))
        )
        .addSubcommand((sub) => sub.setName('list').setDescription('List currently excluded roles'))
    )
    .addSubcommandGroup((group) =>
      group
        .setName('farewell')
        .setDescription('Manage the DM sent to members when they are pruned')
        .addSubcommand((sub) =>
          sub
            .setName('set')
            .setDescription('Set a custom farewell DM sent to members when they are pruned')
            .addStringOption((opt) =>
              opt
                .setName('message')
                .setDescription('Use {username} and {server_name} as placeholders')
                .setRequired(true)
                .setMaxLength(MAX_FAREWELL_LENGTH)
            )
        )
        .addSubcommand((sub) =>
          sub.setName('clear').setDescription('Remove the custom farewell DM and revert to the default')
        )
        .addSubcommand((sub) => sub.setName('show').setDescription('Preview the current farewell DM'))
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({
        content: 'This command only works inside a server, not in DMs.',
        ephemeral: true,
      });
    }

    if (!isAdmin(interaction)) {
      return interaction.reply({
        content: 'You need the **Manage Server** permission to use this command.',
        ephemeral: true,
      });
    }

    // interaction.guild relies on the client's guild cache and can occasionally
    // come back null even inside a real guild (cache gaps, race conditions on
    // startup, etc). interaction.guildId is always reliable, so fall back to an
    // explicit API fetch rather than assuming the cache is populated.
    const guild = interaction.guild ?? (await interaction.client.guilds.fetch(interaction.guildId).catch((err) => {
      console.error(`[activitybot] Failed to resolve guild ${interaction.guildId}:`, err);
      return null;
    }));
    if (!guild) {
      return interaction.reply({
        content: 'Could not load this server\u2019s data right now. Please try again in a moment.',
        ephemeral: true,
      });
    }

    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();

    if (group === 'exclude') {
      return handleExclude(interaction, guild, sub);
    }
    if (group === 'farewell') {
      return handleFarewell(interaction, guild, sub);
    }

    switch (sub) {
      case 'setup':
        return handleSetup(interaction, guild);
      case 'enable':
        return handleEnableDisable(interaction, guild, true);
      case 'disable':
        return handleEnableDisable(interaction, guild, false);
      case 'status':
        return handleStatus(interaction, guild);
      case 'sweep':
        return handleSweep(interaction, guild);
      case 'reset':
        return handleReset(interaction, guild);
      default:
        return interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
    }
  },
};

async function handleSetup(interaction, guild) {
  const role = interaction.options.getRole('role');
  const threshold = interaction.options.getInteger('threshold');

  if (role.managed || role.id === guild.id) {
    return interaction.reply({
      content: 'That role can\u2019t be used (it\u2019s a managed/integration role or @everyone). Pick a normal role.',
      ephemeral: true,
    });
  }

  const botMember = await guild.members.fetchMe();
  if (role.position >= botMember.roles.highest.position) {
    return interaction.reply({
      content:
        `I can\u2019t manage **${role.name}** because it\u2019s positioned above (or equal to) my highest role. ` +
        'Move my role above it in Server Settings \u2192 Roles.',
      ephemeral: true,
    });
  }

  const config = setGuildConfig(guild.id, {
    thresholdDays: threshold,
    inactiveRoleId: role.id,
  });

  return interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle('ActivityBot configured')
        .setColor(0x57f287)
        .setDescription(
          `Inactive role set to ${role} with a **${threshold}-day** inactivity threshold.\n` +
            `Tracking is currently **${config.enabled ? 'enabled' : 'disabled'}** \u2014 run \`/activitybot enable\` to turn it on.`
        ),
    ],
    ephemeral: true,
  });
}

async function handleEnableDisable(interaction, guild, enabled) {
  const config = getGuildConfig(guild.id);
  if (enabled && !config.inactive_role_id) {
    return interaction.reply({
      content: 'Run `/activitybot setup` first to choose an inactive role and threshold.',
      ephemeral: true,
    });
  }
  setGuildConfig(guild.id, { enabled });
  return interaction.reply({
    content: `Inactivity tracking is now **${enabled ? 'enabled' : 'disabled'}** for this server.`,
    ephemeral: true,
  });
}

async function handleStatus(interaction, guild) {
  const config = getGuildConfig(guild.id);
  const excludedRoles = getExcludedRoles(guild.id);
  const roleMentions = excludedRoles.length
    ? excludedRoles.map((id) => `<@&${id}>`).join(', ')
    : 'None';

  const embed = new EmbedBuilder()
    .setTitle('ActivityBot status')
    .setColor(config.enabled ? 0x57f287 : 0xed4245)
    .addFields(
      { name: 'Enabled', value: config.enabled ? 'Yes' : 'No', inline: true },
      { name: 'Threshold', value: `${config.threshold_days} day(s)`, inline: true },
      {
        name: 'Inactive role',
        value: config.inactive_role_id ? `<@&${config.inactive_role_id}>` : 'Not set',
        inline: true,
      },
      { name: 'Excluded roles', value: roleMentions },
      { name: 'Prune policy', value: 'Members holding the inactive role for 90+ days are kicked on the 1st of each month.' },
      {
        name: 'Farewell DM',
        value: config.farewell_message ? 'Custom message set (see `/activitybot farewell show`)' : 'Using default message',
      }
    );

  return interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleSweep(interaction, guild) {
  await interaction.deferReply({ ephemeral: true });
  const config = getGuildConfig(guild.id);
  if (!config.inactive_role_id) {
    return interaction.editReply('Run `/activitybot setup` first.');
  }
  const result = await sweepGuild(guild);
  return interaction.editReply(
    `Sweep complete. Tagged **${result.tagged}** member(s) as inactive, ` +
      `reactivated **${result.reactivated}** member(s), skipped **${result.skipped}** excluded/exempt member(s).`
  );
}

async function handleReset(interaction, guild) {
  const user = interaction.options.getUser('user');
  upsertLastActive(guild.id, user.id, Date.now());
  clearInactive(guild.id, user.id);

  const config = getGuildConfig(guild.id);
  if (config.inactive_role_id) {
    const member = await guild.members.fetch(user.id).catch(() => null);
    if (member?.roles.cache.has(config.inactive_role_id)) {
      await member.roles.remove(config.inactive_role_id, 'ActivityBot: manual reset').catch(() => null);
    }
  }

  return interaction.reply({ content: `Activity clock reset for ${user}.`, ephemeral: true });
}

async function handleExclude(interaction, guild, sub) {
  if (sub === 'add') {
    const role = interaction.options.getRole('role');
    addExcludedRole(guild.id, role.id);
    return interaction.reply({ content: `${role} is now excluded from inactivity tracking.`, ephemeral: true });
  }
  if (sub === 'remove') {
    const role = interaction.options.getRole('role');
    removeExcludedRole(guild.id, role.id);
    return interaction.reply({ content: `${role} is no longer excluded.`, ephemeral: true });
  }
  if (sub === 'list') {
    const excludedRoles = getExcludedRoles(guild.id);
    const roleMentions = excludedRoles.length ? excludedRoles.map((id) => `<@&${id}>`).join(', ') : 'None';
    return interaction.reply({ content: `Excluded roles: ${roleMentions}`, ephemeral: true });
  }
}

async function handleFarewell(interaction, guild, sub) {
  if (sub === 'set') {
    const message = interaction.options.getString('message');
    setGuildConfig(guild.id, { farewellMessage: message });
    const preview = buildFarewellMessage({
      template: message,
      username: interaction.user.username,
      guildName: guild.name,
    });
    return interaction.reply({
      content: `Farewell DM updated. Preview:\n> ${preview}`,
      ephemeral: true,
    });
  }
  if (sub === 'clear') {
    setGuildConfig(guild.id, { farewellMessage: null });
    return interaction.reply({
      content: `Farewell DM reset to the default:\n> ${DEFAULT_FAREWELL_MESSAGE}`,
      ephemeral: true,
    });
  }
  if (sub === 'show') {
    const config = getGuildConfig(guild.id);
    const preview = buildFarewellMessage({
      template: config.farewell_message,
      username: interaction.user.username,
      guildName: guild.name,
    });
    return interaction.reply({
      content:
        (config.farewell_message ? 'Current custom farewell DM' : 'Default farewell DM (none customized yet)') +
        `:\n> ${preview}`,
      ephemeral: true,
    });
  }
}

// Exported for completeness / potential reuse; unused directly here.
module.exports.deleteActivity = deleteActivity;
