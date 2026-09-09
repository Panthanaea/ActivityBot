const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'activitybot.sqlite3'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS guild_config (
    guild_id        TEXT PRIMARY KEY,
    threshold_days  INTEGER NOT NULL DEFAULT 30,
    inactive_role_id TEXT,
    enabled         INTEGER NOT NULL DEFAULT 0,
    farewell_message TEXT
  );

  CREATE TABLE IF NOT EXISTS excluded_roles (
    guild_id TEXT NOT NULL,
    role_id  TEXT NOT NULL,
    PRIMARY KEY (guild_id, role_id)
  );

  CREATE TABLE IF NOT EXISTS member_activity (
    guild_id           TEXT NOT NULL,
    user_id            TEXT NOT NULL,
    last_active_at     INTEGER NOT NULL,
    inactive_marked_at INTEGER,
    PRIMARY KEY (guild_id, user_id)
  );
`);

// Migration for databases created before the farewell-message feature existed.
const guildConfigColumns = db.prepare('PRAGMA table_info(guild_config)').all().map((c) => c.name);
if (!guildConfigColumns.includes('farewell_message')) {
  db.exec('ALTER TABLE guild_config ADD COLUMN farewell_message TEXT');
}

// ---------- guild_config ----------

function getGuildConfig(guildId) {
  const row = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(guildId);
  if (row) return row;
  const defaults = {
    guild_id: guildId,
    threshold_days: 30,
    inactive_role_id: null,
    enabled: 0,
    farewell_message: null,
  };
  db.prepare(
    'INSERT INTO guild_config (guild_id, threshold_days, inactive_role_id, enabled, farewell_message) VALUES (?, ?, ?, ?, ?)'
  ).run(
    defaults.guild_id,
    defaults.threshold_days,
    defaults.inactive_role_id,
    defaults.enabled,
    defaults.farewell_message
  );
  return defaults;
}

function setGuildConfig(guildId, options) {
  getGuildConfig(guildId); // ensure row exists
  const current = getGuildConfig(guildId);
  const { thresholdDays, inactiveRoleId, enabled, farewellMessage } = options;

  db.prepare(
    'UPDATE guild_config SET threshold_days = ?, inactive_role_id = ?, enabled = ?, farewell_message = ? WHERE guild_id = ?'
  ).run(
    thresholdDays ?? current.threshold_days,
    inactiveRoleId !== undefined ? inactiveRoleId : current.inactive_role_id,
    enabled !== undefined ? (enabled ? 1 : 0) : current.enabled,
    // 'farewellMessage' in options lets a caller explicitly pass null to clear it,
    // distinct from simply not mentioning the field at all.
    'farewellMessage' in options ? farewellMessage : current.farewell_message,
    guildId
  );
  return getGuildConfig(guildId);
}

function getAllEnabledGuildConfigs() {
  return db.prepare('SELECT * FROM guild_config WHERE enabled = 1').all();
}

// ---------- excluded_roles ----------

function addExcludedRole(guildId, roleId) {
  db.prepare('INSERT OR IGNORE INTO excluded_roles (guild_id, role_id) VALUES (?, ?)').run(guildId, roleId);
}

function removeExcludedRole(guildId, roleId) {
  db.prepare('DELETE FROM excluded_roles WHERE guild_id = ? AND role_id = ?').run(guildId, roleId);
}

function getExcludedRoles(guildId) {
  return db
    .prepare('SELECT role_id FROM excluded_roles WHERE guild_id = ?')
    .all(guildId)
    .map((r) => r.role_id);
}

// ---------- member_activity ----------

function getActivity(guildId, userId) {
  return db
    .prepare('SELECT * FROM member_activity WHERE guild_id = ? AND user_id = ?')
    .get(guildId, userId);
}

function upsertLastActive(guildId, userId, timestampMs) {
  db.prepare(
    `INSERT INTO member_activity (guild_id, user_id, last_active_at, inactive_marked_at)
     VALUES (?, ?, ?, NULL)
     ON CONFLICT(guild_id, user_id) DO UPDATE SET
       last_active_at = excluded.last_active_at,
       inactive_marked_at = NULL`
  ).run(guildId, userId, timestampMs);
}

function ensureActivityRow(guildId, userId, fallbackTimestampMs) {
  const existing = getActivity(guildId, userId);
  if (existing) return existing;
  db.prepare(
    'INSERT OR IGNORE INTO member_activity (guild_id, user_id, last_active_at, inactive_marked_at) VALUES (?, ?, ?, NULL)'
  ).run(guildId, userId, fallbackTimestampMs);
  return getActivity(guildId, userId);
}

function markInactive(guildId, userId, timestampMs) {
  db.prepare('UPDATE member_activity SET inactive_marked_at = ? WHERE guild_id = ? AND user_id = ?').run(
    timestampMs,
    guildId,
    userId
  );
}

function clearInactive(guildId, userId) {
  db.prepare('UPDATE member_activity SET inactive_marked_at = NULL WHERE guild_id = ? AND user_id = ?').run(
    guildId,
    userId
  );
}

function getAllInactiveMarked(guildId) {
  return db
    .prepare('SELECT * FROM member_activity WHERE guild_id = ? AND inactive_marked_at IS NOT NULL')
    .all(guildId);
}

function deleteActivity(guildId, userId) {
  db.prepare('DELETE FROM member_activity WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
}

module.exports = {
  db,
  getGuildConfig,
  setGuildConfig,
  getAllEnabledGuildConfigs,
  addExcludedRole,
  removeExcludedRole,
  getExcludedRoles,
  getActivity,
  upsertLastActive,
  ensureActivityRow,
  markInactive,
  clearInactive,
  getAllInactiveMarked,
  deleteActivity,
};
