# ActivityBot

A Discord bot that automatically tags inactive members with an **"inactive"** role and prunes
(kicks) members who've held that role too long.

**A member counts as active if they, within the configured time window:**
- React to a message
- Post a message
- Mark **Interested** on a scheduled event
- Vote in a poll
- Connect to a voice channel or a stage channel

Any one of those actions immediately clears "inactive" status the moment it happens — you don't
have to wait for the next daily check.

When a member is tagged inactive, ActivityBot also sends them a DM explaining why and what to do
about it, e.g.:

> Hello @jdoe! We noticed you haven't been active in Cool Server for 60 days, so we have given you
> the inactive role. To avoid being pruned, sometime in the next 90 days you should go drop a
> react on someone's message, post a message, click Interested on an event, vote in a poll, or
> connect to a voice channel/stage.

The threshold phrasing adapts automatically (e.g. "a year" at the 365-day max, "1 day" at the
minimum). If the member has DMs closed, this fails silently (logged as a warning) and the role
assignment still goes through as normal.

Every day, the bot sweeps each server and tags anyone who's gone quiet for longer than that
server's configured threshold (1–365 days, set per-server). On the **1st of every month**, it
kicks anyone who has held the inactive role for **90+ days**. Specific roles can be excluded from
tracking entirely (e.g. bots, moderators, boosters).

---

## 1. Create the Discord application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**.
2. Under **Bot**, click **Reset Token** and copy it — this is your `DISCORD_TOKEN`.
3. Still under **Bot**, enable the **Server Members Intent** (privileged — required to enumerate
   members and check who's inactive). Message Content Intent is *not* needed.
4. Under **General Information**, copy the **Application ID** — this is your `CLIENT_ID`.

## 2. Invite the bot to your server

Build an invite URL (replace `YOUR_CLIENT_ID`):

```
https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=268447744&scope=bot%20applications.commands
```

That permission integer includes **Manage Roles**, **Kick Members**, **View Channels**, and
message/reaction basics. After inviting, **make sure the bot's own role is positioned above** any
role you plan to use as the "inactive" role — Discord won't let a bot manage roles above its own.

## 3. Configure environment variables

```bash
cp .env.example .env
```

Fill in `DISCORD_TOKEN` and `CLIENT_ID`. Optionally set `GUILD_ID` to your server's ID while
developing — this registers commands to just that server so changes show up instantly instead of
waiting up to an hour for a global command update.

## 4. Install and run

```bash
npm install
npm run deploy-commands   # registers the /activitybot slash commands
npm start
```

### Or with Docker

```bash
docker compose up -d --build
```

The SQLite database lives in `./data/activitybot.sqlite3` and is mounted as a volume so it
survives container restarts/rebuilds.

---

## Commands

All config commands require the **Manage Server** permission.

| Command | Description |
|---|---|
| `/activitybot setup role:<@role> threshold:<1-365>` | Set which role marks a member inactive, and how many days of silence trigger it |
| `/activitybot enable` / `/activitybot disable` | Turn tracking on/off for this server |
| `/activitybot exclude add role:<@role>` | Exclude a role from inactivity tracking entirely |
| `/activitybot exclude remove role:<@role>` | Stop excluding a role |
| `/activitybot exclude list` | List currently excluded roles |
| `/activitybot status` | Show current config: threshold, role, excluded roles |
| `/activitybot sweep` | Manually run an inactivity check right now, instead of waiting for the daily job |
| `/activitybot reset user:<@member>` | Reset a member's activity clock manually (e.g. for edge cases) |
| `/activitybot farewell set message:<text>` | Set a custom farewell DM sent to members right before they're pruned. Supports `{username}` and `{server_name}` placeholders |
| `/activitybot farewell clear` | Revert to the default farewell message |
| `/activitybot farewell show` | Preview the current farewell DM (custom or default) |

## How pruning works

The 90-day kick countdown starts from the moment a member is *tagged* inactive, not from their
last activity. So the full timeline for a member is: **threshold days of silence → tagged
inactive → 90 more days without becoming active again → kicked** on the next 1st-of-the-month
run. Becoming active at any point resets the whole thing.

The 90-day prune window is set via `PRUNE_AFTER_DAYS` in `.env` (defaults to 90 per spec — change
at your own risk, it's not exposed as a slash command since the spec fixes it at 90).

Right before a member is kicked, they're sent a farewell DM — either the default ("You have been
removed from {server_name} due to prolonged inactivity.") or a custom one set via
`/activitybot farewell set`. Like the inactive-role DM, this fails silently (logged as a warning)
if the member has DMs closed, and the kick still goes through.

## Notes on hosting

This bot needs to run **continuously** (it listens for live gateway events and runs cron jobs), so
it can't run as a GitHub Action — GitHub is just where the source lives. Good, cheap always-on
options for a bot this size:

- **A small VPS** (e.g. via any provider) running the Docker setup above with `restart: unless-stopped`
- **Railway** or **Fly.io** — point them at this repo, set the same env vars, deploy the Dockerfile
- A systemd service running `npm start` directly with a process manager like `pm2`

If you use a platform with an ephemeral filesystem, mount a persistent volume for the `data/`
directory or the bot will lose its activity history on every redeploy.

## Requirements

- Node.js 18.17+
- discord.js 14.16+ (poll-vote tracking requires ≥ 14.15, where Discord's native Poll feature
  support landed — `npm install` pulls a compatible version automatically)
