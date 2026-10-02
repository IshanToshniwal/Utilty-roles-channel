// Builds the roadmap from the server's real channel list and keeps the messages up to date.
const { ChannelType, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require('discord.js');
const store = require('./store');

const LIMIT = 3800; // text per message (Discord: 4000 across all text displays)
const TOPIC_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildMedia]);
const LISTED = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildMedia, ChannelType.GuildVoice, ChannelType.GuildStageVoice]);
const isVoice = (c) => c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice;
const hasTopic = (c) => TOPIC_TYPES.has(c.type);

// The description shown for a channel: dashboard override, else the Discord topic.
function descriptionOf(g, c) {
  const o = g.descriptions[c.id];
  if (o !== undefined && o !== null) return o;
  return hasTopic(c) ? (c.topic || '') : '';
}

// Structure: [{ id, name, hidden, channels: [{ id, name, type, description, hidden, hasTopic }] }]
function structure(guild, g) {
  const sortPos = (a, b) => a.rawPosition - b.rawPosition || a.id.localeCompare(b.id);
  const cats = [...guild.channels.cache.values()].filter((c) => c.type === ChannelType.GuildCategory).sort(sortPos);
  const all = [...guild.channels.cache.values()].filter((c) => LISTED.has(c.type));
  const row = (c) => ({ id: c.id, name: c.name, type: c.type, voice: isVoice(c), hasTopic: hasTopic(c), topic: hasTopic(c) ? c.topic || '' : null, description: descriptionOf(g, c), hidden: Boolean(g.channels[c.id]?.hidden) });
  const order = (list) => [...list.filter((c) => !isVoice(c)).sort(sortPos), ...list.filter(isVoice).sort(sortPos)].map(row);
  const out = cats.map((cat) => ({ id: cat.id, name: cat.name, displayName: g.categories[cat.id]?.name || cat.name, hidden: Boolean(g.categories[cat.id]?.hidden), channels: order(all.filter((c) => c.parentId === cat.id)) }));
  const loose = all.filter((c) => !c.parentId || !cats.some((x) => x.id === c.parentId));
  if (loose.length) out.unshift({ id: 'none', name: g.uncategorizedName, displayName: g.categories.none?.name || g.uncategorizedName, hidden: Boolean(g.categories.none?.hidden), channels: order(loose) });
  return out;
}

// -> array of message payloads (V2 containers); several if the server has many channels
function build(guild, g) {
  const secs = structure(guild, g).filter((cat) => !cat.hidden).map((cat) => {
    const lines = cat.channels.filter((c) => !c.hidden && (g.showVoice || !c.voice)).map((c) => `<#${c.id}>${c.description ? ` - ${c.description}` : ''}`);
    if (!lines.length && !g.showEmptyCategories) return null;
    return `### ${cat.displayName}\n${lines.join('\n') || '_no channels_'}`;
  }).filter(Boolean);
  const head = `## ${g.title}${g.intro ? `\n${g.intro}` : ''}`;
  const pages = [];
  let cur = [], len = 0;
  const flush = () => { if (cur.length) pages.push(cur); cur = []; len = 0; };
  for (const s of secs) {
    const piece = s.length > LIMIT ? s.slice(0, LIMIT - 1) + '…' : s;
    if (len + piece.length + 2 > LIMIT - (pages.length ? 0 : head.length)) flush();
    cur.push(piece);
    len += piece.length + 2;
  }
  flush();
  if (!pages.length) pages.push(['_No channels to show. Un-hide some on the dashboard._']);
  const spacing = g.separator === 'small' ? SeparatorSpacingSize.Small : SeparatorSpacingSize.Large;
  return pages.map((parts, i) => {
    const c = new ContainerBuilder().setAccentColor(g.color);
    if (i === 0) {
      c.addTextDisplayComponents(new TextDisplayBuilder().setContent(head));
      c.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large).setDivider(true));
    }
    parts.forEach((p, j) => {
      if (j > 0 && g.separator !== 'none') c.addSeparatorComponents(new SeparatorBuilder().setSpacing(spacing).setDivider(true));
      c.addTextDisplayComponents(new TextDisplayBuilder().setContent(p));
    });
    if (i === pages.length - 1 && g.footer) {
      c.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
      c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${g.footer} · <t:${Math.floor(Date.now() / 1000)}:R>`));
    }
    return { components: [c], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
  });
}

// Edit the existing messages in place; send/delete to match the number of pages.
async function refresh(client, guildId, { reason = 'refresh' } = {}) {
  const g = store.guild(guildId);
  const guild = client.guilds.cache.get(guildId);
  if (!guild || !g.channelId) return { ok: false, text: 'No roadmap channel set.' };
  const ch = guild.channels.cache.get(g.channelId) || (await guild.channels.fetch(g.channelId).catch(() => null));
  if (!ch?.isTextBased()) return { ok: false, text: 'Roadmap channel not found — pick it again on the dashboard.' };
  const payloads = build(guild, g);
  const ids = [];
  try {
    for (let i = 0; i < payloads.length; i++) {
      const existing = g.messageIds[i] && (await ch.messages.fetch(g.messageIds[i]).catch(() => null));
      if (existing && existing.author?.id === client.user.id) { await existing.edit(payloads[i]); ids.push(existing.id); }
      else { const m = await ch.send(payloads[i]); ids.push(m.id); }
    }
    for (const old of g.messageIds.slice(payloads.length)) { const m = await ch.messages.fetch(old).catch(() => null); if (m) await m.delete().catch(() => null); }
  } catch (err) {
    return { ok: false, text: `Could not post: ${err.message}` };
  }
  g.messageIds = ids;
  g.lastRefresh = new Date().toISOString();
  store.save();
  return { ok: true, text: `Roadmap updated (${payloads.length} message${payloads.length === 1 ? '' : 's'}, ${reason}).`, pages: payloads.length };
}

// Set a description: stored, and written to the channel topic when the channel type has one.
async function setDescription(guild, channelId, text) {
  const g = store.guild(guild.id);
  const c = guild.channels.cache.get(channelId);
  if (!c) return { ok: false, text: 'Channel not found.' };
  const clean = String(text || '').trim().slice(0, 1024);
  g.descriptions[channelId] = clean;
  store.save();
  let topicOk = true;
  if (hasTopic(c) && (c.topic || '') !== clean) topicOk = await c.setTopic(clean || null, 'ChannelMap dashboard').then(() => true).catch(() => false);
  return { ok: true, topicOk, text: `Description saved for #${c.name}${hasTopic(c) ? (topicOk ? ' (channel topic updated too)' : ' (could not change the channel topic — missing Manage Channels?)') : ''}.` };
}

// Called every minute: refresh servers whose interval has passed.
async function tick(client) {
  for (const [id, g] of Object.entries(store.data.guilds)) {
    if (!g.channelId || !client.guilds.cache.has(id)) continue;
    const due = !g.lastRefresh || Date.now() - new Date(g.lastRefresh).getTime() >= Math.max(1, g.intervalHours) * 3600e3;
    if (due) await refresh(client, id, { reason: 'scheduled' }).catch((e) => console.error('scheduled refresh failed:', e));
  }
}

// debounce refreshes caused by channel edits (one burst of changes -> one refresh)
const pending = new Map();
function scheduleRefresh(client, guildId, delayMs = 15_000) {
  clearTimeout(pending.get(guildId));
  pending.set(guildId, setTimeout(() => { pending.delete(guildId); refresh(client, guildId, { reason: 'channel change' }).catch(() => null); }, delayMs));
}

module.exports = { structure, build, refresh, setDescription, tick, scheduleRefresh, hasTopic, isVoice, descriptionOf };
