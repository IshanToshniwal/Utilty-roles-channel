require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const store = require('./lib/store');
const roadmap = require('./lib/roadmap');
const dashboard = require('./lib/dashboard');
const ui = require('./lib/ui');

const recentErrors = [];
const origError = console.error;
console.error = (...args) => { recentErrors.unshift({ at: new Date().toISOString(), text: args.map((a) => (a instanceof Error ? a.stack || a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' ').slice(0, 500) }); if (recentErrors.length > 50) recentErrors.pop(); origError(...args); };

const app = express();
const PORT = process.env.PORT || 3000;
app.get('/health', (_req, res) => res.status(200).json({ status: 'ok', uptime: process.uptime(), ready: client?.isReady() ?? false, guilds: client?.guilds.cache.size ?? 0 }));
app.listen(PORT, () => console.log(`Web server listening on port ${PORT}`));

const client = new Client({ intents: [GatewayIntentBits.Guilds] }); // only needs channel data — no privileged intents
client.commands = new Collection();
client.recentErrors = recentErrors;
store.attachClient(client);
dashboard.mount(app, client);

const loadDir = (dir) => fs.readdirSync(path.join(__dirname, dir)).filter((f) => f.endsWith('.js')).flatMap((f) => [].concat(require(path.join(__dirname, dir, f))));
for (const cmd of loadDir('commands')) if (cmd?.data && cmd?.execute) client.commands.set(cmd.data.name, cmd);
for (const ev of loadDir('events')) if (ev?.name && ev?.execute) client.on(ev.name, (...args) => Promise.resolve(ev.execute(client, ...args)).catch((err) => console.error(`Event ${ev.name} failed:`, err)));

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag} — ${client.guilds.cache.size} server(s)`);
  client.user.setActivity('the channel list 🗺️', { type: 3 });
  await store.restore();
  setInterval(() => roadmap.tick(client).catch((e) => console.error('tick failed:', e)), 60_000);
});
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.inGuild()) return interaction.reply(ui.fail('Use this in a server.'));
  const cmd = client.commands.get(interaction.commandName);
  if (!cmd) return;
  try { await cmd.execute(interaction); } catch (err) {
    console.error(`Error in /${interaction.commandName}:`, err);
    const payload = ui.fail(err?.code === 50013 ? 'I am missing permissions (View Channels, Send Messages, Manage Channels for topics).' : `Something went wrong: ${err.message ?? err}`);
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => null); else await interaction.reply(payload).catch(() => null);
  }
});
process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));
process.on('SIGTERM', async () => { await store.flush(); process.exit(0); });
client.login(process.env.DISCORD_TOKEN);
