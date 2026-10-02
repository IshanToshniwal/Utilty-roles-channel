// Per-server settings. JSON file + Postgres (DATABASE_URL) or Discord-channel backup (DATA_CHANNEL_ID).
const fs = require('fs');
const path = require('path');
const { AttachmentBuilder } = require('discord.js');
const DATA_FILE = path.join(__dirname, '..', 'data.json');

const DEFAULT_GUILD = () => ({
  channelId: null, // where the roadmap lives
  messageIds: [], // the roadmap messages (edited in place)
  title: 'Channel Roadmap',
  intro: 'Here you can find the list of channels of the server and jump to any of them without opening the Channels & Roles tab.',
  color: 0x9b6bff,
  intervalHours: 6,
  lastRefresh: null,
  showVoice: true,
  showEmptyCategories: false,
  uncategorizedName: 'Other channels',
  descriptions: {}, // channelId -> description override (also written to the channel topic when possible)
  channels: {}, // channelId -> { hidden }
  categories: {}, // categoryId -> { name (display override), hidden }
  separator: 'large', // large | small | none
  footer: 'Updated automatically',
});
const data = { guilds: {} };
let client = null, saveTimer = null, pg = null;
if (process.env.DATABASE_URL) {
  try { const { Pool } = require('pg'); pg = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false } }); } catch (err) { console.error('pg unavailable:', err.message); }
}
async function pgInit() {
  if (!pg) return false;
  try {
    await pg.query('CREATE TABLE IF NOT EXISTS channelmap_store (id INT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT now())');
    const r = await pg.query('SELECT data FROM channelmap_store WHERE id = 1');
    if (r.rows[0]) { Object.assign(data, r.rows[0].data); console.log('Loaded database from Postgres.'); }
    return true;
  } catch (err) { console.error('Postgres init failed:', err.message); pg = null; return false; }
}
async function pgSave() { if (!pg) return; try { await pg.query('INSERT INTO channelmap_store (id, data, updated_at) VALUES (1, $1, now()) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()', [JSON.stringify(data)]); } catch (err) { console.error('Postgres save failed:', err.message); } }
function guild(id) {
  if (!data.guilds[id]) data.guilds[id] = DEFAULT_GUILD();
  const g = data.guilds[id], def = DEFAULT_GUILD();
  for (const k of Object.keys(def)) if (g[k] === undefined) g[k] = def[k];
  return g;
}
function load() { try { if (fs.existsSync(DATA_FILE)) Object.assign(data, JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))); } catch (err) { console.error('Could not read data.json:', err.message); } }
function writeFile() { try { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); } catch (err) { console.error('Could not write data.json:', err.message); } }
async function backupToDiscord() {
  const channelId = process.env.DATA_CHANNEL_ID;
  if (!channelId || !client?.isReady()) return;
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased()) return;
    await channel.send({ content: `📦 Backup ${new Date().toISOString()}`, files: [new AttachmentBuilder(Buffer.from(JSON.stringify(data)), { name: 'data.json' })] });
    const msgs = await channel.messages.fetch({ limit: 20 });
    const mine = [...msgs.values()].filter((m) => m.author.id === client.user.id && m.attachments.size).sort((a, b) => b.createdTimestamp - a.createdTimestamp);
    for (const old of mine.slice(3)) await old.delete().catch(() => null);
  } catch (err) { console.error('Backup failed:', err.message); }
}
async function restoreFromDiscord() {
  const channelId = process.env.DATA_CHANNEL_ID;
  if (!channelId || !client?.isReady()) return;
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased()) return;
    const msgs = await channel.messages.fetch({ limit: 20 });
    const latest = [...msgs.values()].filter((m) => m.author.id === client.user.id && m.attachments.size).sort((a, b) => b.createdTimestamp - a.createdTimestamp)[0];
    if (!latest) return;
    Object.assign(data, await (await fetch(latest.attachments.first().url)).json());
    writeFile();
    console.log('Restored database from Discord backup.');
  } catch (err) { console.error('Restore failed:', err.message); }
}
function save() {
  writeFile();
  if (!process.env.DATA_CHANNEL_ID && !pg) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { pgSave(); backupToDiscord(); }, pg ? 3_000 : 20_000);
}
load();
module.exports = { data, guild, save, attachClient: (c) => (client = c), restore: async () => { if (!(await pgInit())) await restoreFromDiscord(); }, flush: async () => { await pgSave(); await backupToDiscord(); }, hasPostgres: () => Boolean(pg) };
