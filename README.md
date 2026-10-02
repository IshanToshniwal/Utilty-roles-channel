# ChannelMap — live "Channel Roadmap" bot for Discord

ChannelMap reads every **category and channel** of your server and keeps one card in a channel
of your choice, like this:

```
Channel Roadmap
Here you can find the list of channels …
──────────────
Entrance
#rules-verification - Rules and verification.
#roles - Information on all roles.
#channels - You are here.
──────────────
Important
#news - Server Announcements.
…
```

- Built with Discord's **Components V2** (container, headings, separators) — channel mentions are
  clickable and show the right icon (text / voice / announcement / forum).
- **Refreshes itself every 6 hours** (configurable 1–168 h) **and instantly** whenever a channel or
  category is created, renamed, moved, deleted or its topic changes. Messages are edited in place.
- **Web dashboard** (Login with Discord, *Manage Server* required): edit every channel's description
  — it is written into the channel's **topic in Discord** too (and topic edits made in Discord flow
  back) — rename categories for the roadmap, hide channels or categories, set the title, intro,
  footer, accent colour, separator style, voice on/off, the refresh interval, and a live preview.
- Long servers are split across several messages automatically.
- Needs **no privileged intents** — only the `Guilds` intent.

## Commands (Manage Server)

| Command | What it does |
|---|---|
| `/roadmap setup #channel` | Choose where the roadmap lives and post it |
| `/roadmap refresh` | Rebuild now |
| `/roadmap describe #channel text` | Set a channel's description (also sets its topic) |
| `/roadmap hide #channel-or-category` · `show` | Hide / show in the roadmap |
| `/roadmap rename category name` | Display name for a category in the roadmap (Discord name unchanged) |
| `/roadmap interval hours` | Auto-refresh interval |
| `/roadmap view` | Current settings |

Everything above is also on the dashboard, which is the comfortable way to edit many descriptions at once.

---

## Step 1 — Create the Discord application

1. Go to <https://discord.com/developers/applications> → **New Application** → name it (e.g. *ChannelMap*).
2. **Bot** tab → **Reset Token** → copy it. This is `DISCORD_TOKEN`. *(Never share it; anyone with it controls the bot.)*
3. **General Information** → copy the **Application ID**. This is `CLIENT_ID`.
4. **OAuth2** tab → **Client Secret** → **Reset Secret** → copy it. This is `CLIENT_SECRET` (needed for the dashboard login).
5. No privileged intents are needed — leave them off.
6. Invite the bot to your server with this link (replace `YOUR_ID` with the Application ID):
   ```
   https://discord.com/oauth2/authorize?client_id=YOUR_ID&scope=bot%20applications.commands&permissions=85008
   ```
   Permissions included: View Channels, Send Messages, Embed Links, Read Message History and
   **Manage Channels** (only used to write descriptions into channel topics).
7. Make sure the bot can **see every channel you want listed** — it lists what it can see. The
   easiest way is to give its role access to all categories, or grant it Administrator.

## Step 2 — Put the code on GitHub

1. <https://github.com/new> → repository name `channelmap-bot` → **Private** → Create.
2. Add every file from this folder. On a phone/tablet use **Add file → Create new file**, type the
   path as the file name (e.g. `lib/roadmap.js` — the `/` creates the folder), paste the contents,
   **Commit**. The paste guide HTML that came with the bot has a copy button for each file.
3. Do **not** upload a `.env` file (the `.gitignore` already excludes it).

## Step 3 — Deploy on Render (free)

1. <https://render.com> → sign up with GitHub → **New → Web Service** → pick the `channelmap-bot` repo.
2. Render reads `render.yaml`: build command `npm install && npm run deploy`, start command `npm start`,
   health check `/health`. If it asks, set **Runtime: Node**, **Plan: Free**.
3. **Environment variables** (Environment tab):

   | Key | Value |
   |---|---|
   | `DISCORD_TOKEN` | the bot token |
   | `CLIENT_ID` | the application ID |
   | `CLIENT_SECRET` | the OAuth2 client secret |
   | `SESSION_SECRET` | any long random text (Render can generate it) |
   | `GUILD_ID` | *(optional)* your server ID — commands appear instantly while testing; remove it later to make the bot public |
   | `DATABASE_URL` **or** `DATA_CHANNEL_ID` | see *Storage* below |

4. Click **Create Web Service** and wait for the log to show `Logged in as ChannelMap#…` and
   `Registered … commands`.
5. Copy your service URL, e.g. `https://channelmap-bot.onrender.com`.
6. Back in the Developer Portal → **OAuth2 → Redirects** → **Add Redirect** →
   `https://channelmap-bot.onrender.com/auth/callback` → **Save Changes**. Without this the
   dashboard login fails.

### Storage (so settings survive redeploys)
Render's free disk is wiped on every deploy. Pick one:
- **Postgres (recommended):** create a free database at <https://neon.tech> (or Render → New → PostgreSQL —
  note Render's free database is deleted after 30 days) → copy the connection string → add it as `DATABASE_URL`.
  The bot creates its table itself.
- **Discord channel backup:** create a private `#bot-data` channel only the bot can see → copy its ID
  (Developer Mode → right-click → Copy Channel ID) → add it as `DATA_CHANNEL_ID`. The bot uploads
  its settings there on every change and restores them on start.

### Keep it awake (free tier sleeps after 15 min)
<https://uptimerobot.com> → **New Monitor** → type **HTTP(s)** → URL
`https://channelmap-bot.onrender.com/health` → interval **5 minutes** → Create.

## Step 4 — Set it up in Discord

1. In your server run **`/roadmap setup channel:#channels`** — the roadmap is posted immediately.
2. Open `https://channelmap-bot.onrender.com` → **Login with Discord** → pick your server.
3. Scroll to **Channels**: type a description for each channel, rename categories if you like, tick
   *hide* for anything you don't want listed, press **Save category**. The roadmap updates at once and
   the descriptions are written into the channel topics.
4. Adjust **Settings** (title, intro, colour, separator, refresh interval) → **Save settings & refresh**.

From now on the card updates itself every 6 hours and whenever a channel changes.

## Notes
- Voice and stage channels have no topic in Discord, so their descriptions live only in the bot.
- The category order and channel order always follow Discord; the roadmap never reorders anything.
- *Clear all overrides* on the dashboard removes custom names/descriptions/hidden flags but does not
  touch the topics already written into Discord.
- To run it on your own machine: `npm install`, copy `.env.example` to `.env` and fill it in,
  `npm run deploy && npm start`.
