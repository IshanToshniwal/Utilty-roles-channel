// Web dashboard: Login with Discord (OAuth2). Manage Server (or Administrator) required.
const crypto = require('crypto');
const { PermissionFlagsBits, ChannelType } = require('discord.js');
const store = require('./store');
const roadmap = require('./roadmap');
const views = require('./views');

const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) console.warn('SESSION_SECRET not set — dashboard logins will reset on every restart.');
const sessions = new Map();
const SESSION_TTL = 7 * 86400e3;

function sign(v) { return `${v}.${crypto.createHmac('sha256', SESSION_SECRET).update(v).digest('base64url')}`; }
function unsign(s) {
  if (!s) return null;
  const i = s.lastIndexOf('.');
  if (i === -1) return null;
  const v = s.slice(0, i);
  const expected = sign(v);
  if (expected.length !== s.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(s))) return null;
  return v;
}
function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) out[k] = decodeURIComponent(v.join('='));
  }
  return out;
}
function baseUrl(req) { return process.env.BASE_URL?.replace(/\/$/, '') || `${req.headers['x-forwarded-proto'] || req.protocol || 'https'}://${req.headers.host}`; }
function getSession(req) {
  const sid = unsign(parseCookies(req).sid);
  const s = sid && sessions.get(sid);
  if (!s) return null;
  if (Date.now() - s.createdAt > SESSION_TTL) { sessions.delete(sid); return null; }
  return s;
}
const canManage = (g) => g.owner || Boolean(BigInt(g.permissions || 0) & (PermissionFlagsBits.ManageGuild | PermissionFlagsBits.Administrator));
const q = (res, base, ok, err, hash = '') => res.redirect(`${base}?${ok ? `ok=${encodeURIComponent(ok)}` : `err=${encodeURIComponent(err || 'Failed')}`}${hash}`);

function mount(app, client) {
  const express = require('express');
  app.set('trust proxy', 1);
  app.use(express.urlencoded({ extended: false }));
  app.use((req, _res, next) => { req.session = getSession(req); next(); });

  app.get('/status', (req, res) => res.send(views.status({ session: req.session, ready: client.isReady?.() ?? false, guilds: client.guilds.cache.size, configured: Object.values(store.data.guilds).filter((g) => g.channelId).length, uptime: process.uptime(), ping: client.ws?.ping ?? null, memoryMb: Math.round(process.memoryUsage().rss / 1048576), storage: store.hasPostgres?.() ? 'Postgres' : process.env.DATA_CHANNEL_ID ? 'Discord channel backup' : 'Local file only (not persistent on Render!)', errors: client.recentErrors || [] })));
  app.get('/', (req, res) => (req.session ? res.redirect('/dashboard') : res.send(views.landing({ botName: client.user?.username || 'ChannelMap', avatar: client.user?.displayAvatarURL?.({ size: 128 }) }))));

  app.get('/auth/login', (req, res) => {
    if (!process.env.CLIENT_SECRET) return res.status(500).send(views.error('CLIENT_SECRET is not set on the server.'));
    const state = crypto.randomBytes(16).toString('hex');
    res.setHeader('Set-Cookie', `oauth_state=${sign(state)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600; Secure`);
    const url = new URL('https://discord.com/oauth2/authorize');
    url.searchParams.set('client_id', process.env.CLIENT_ID);
    url.searchParams.set('redirect_uri', `${baseUrl(req)}/auth/callback`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'identify guilds');
    url.searchParams.set('state', state);
    url.searchParams.set('prompt', 'none');
    res.redirect(url.toString());
  });
  app.get('/auth/callback', async (req, res) => {
    try {
      const { code, state, error } = req.query;
      if (error) return res.status(400).send(views.error(`Discord login was cancelled (${error}).`));
      const expected = unsign(parseCookies(req).oauth_state);
      if (!code || !state || state !== expected) return res.status(400).send(views.error('Invalid login state. Please try again.'));
      const tokenRes = await fetch('https://discord.com/api/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: process.env.CLIENT_ID, client_secret: process.env.CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: `${baseUrl(req)}/auth/callback` }) });
      if (!tokenRes.ok) return res.status(400).send(views.error(`Token exchange failed (${tokenRes.status}). Check CLIENT_SECRET and that the redirect URL is added in the Developer Portal.`));
      const token = await tokenRes.json();
      const h = { Authorization: `Bearer ${token.access_token}` };
      const [user, guilds] = await Promise.all([fetch('https://discord.com/api/users/@me', { headers: h }).then((r) => r.json()), fetch('https://discord.com/api/users/@me/guilds', { headers: h }).then((r) => r.json())]);
      if (!user?.id || !Array.isArray(guilds)) return res.status(400).send(views.error('Could not load your Discord profile.'));
      const sid = crypto.randomBytes(24).toString('hex');
      sessions.set(sid, { user: { id: user.id, username: user.global_name || user.username, avatar: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64` : null }, guilds: guilds.filter(canManage).map((g) => ({ id: g.id, name: g.name, icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64` : null })), csrf: crypto.randomBytes(16).toString('hex'), createdAt: Date.now() });
      res.setHeader('Set-Cookie', [`sid=${sign(sid)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL / 1000}; Secure`, 'oauth_state=; Path=/; Max-Age=0']);
      res.redirect('/dashboard');
    } catch (err) { console.error('OAuth callback failed:', err); res.status(500).send(views.error('Login failed. Check the server logs.')); }
  });
  app.get('/auth/logout', (req, res) => { const sid = unsign(parseCookies(req).sid); if (sid) sessions.delete(sid); res.setHeader('Set-Cookie', 'sid=; Path=/; Max-Age=0'); res.redirect('/'); });

  const requireLogin = (req, res, next) => (req.session ? next() : res.redirect('/'));
  const requireGuild = (req, res, next) => {
    if (!req.session.guilds.some((g) => g.id === req.params.guildId)) return res.status(403).send(views.error("You don't have Manage Server in that server.", req.session));
    const live = client.guilds.cache.get(req.params.guildId);
    if (!live) return res.status(404).send(views.error('The bot is not in that server. Invite it first.', req.session));
    req.guild = live;
    req.g = store.guild(live.id);
    req.base = `/dashboard/${live.id}`;
    next();
  };
  const csrf = (req, res, next) => (req.body?._csrf === req.session.csrf ? next() : res.status(403).send(views.error('Form expired — go back and try again.', req.session)));
  const invite = () => `https://discord.com/oauth2/authorize?client_id=${process.env.CLIENT_ID}&scope=bot%20applications.commands&permissions=${1024 + 2048 + 16384 + 65536 + 16}`;

  app.get('/dashboard', requireLogin, (req, res) => res.send(views.guilds({ session: req.session, guilds: req.session.guilds.map((g) => ({ ...g, inBot: client.guilds.cache.has(g.id), configured: Boolean(store.data.guilds[g.id]?.channelId), channels: client.guilds.cache.get(g.id)?.channels.cache.size || 0 })), invite: invite() })));

  app.get('/dashboard/:guildId', requireLogin, requireGuild, (req, res) => {
    const textChannels = [...req.guild.channels.cache.values()].filter((c) => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement).sort((a, b) => a.rawPosition - b.rawPosition).map((c) => ({ id: c.id, name: c.name }));
    const structure = roadmap.structure(req.guild, req.g);
    res.send(views.guild({ session: req.session, guild: req.guild, g: req.g, q: { ok: req.query.ok, err: req.query.err }, textChannels, structure, preview: previewText(structure, req.g), me: req.guild.members.me }));
  });

  app.post('/dashboard/:guildId', requireLogin, requireGuild, csrf, async (req, res) => {
    const g = req.g, b = req.body, base = req.base;
    try {
      switch (b.action) {
        case 'settings': {
          const prev = g.channelId;
          g.channelId = b.channelId || null;
          if (g.channelId !== prev) g.messageIds = [];
          g.title = String(b.title || '').trim().slice(0, 100) || 'Channel Roadmap';
          g.intro = String(b.intro || '').trim().slice(0, 1500);
          g.footer = String(b.footer || '').trim().slice(0, 200);
          g.color = parseInt(String(b.color || '#9b6bff').replace('#', ''), 16) || 0x9b6bff;
          const hours = Number(b.intervalHours);
          g.intervalHours = b.intervalHours !== undefined && b.intervalHours !== '' && Number.isFinite(hours) ? Math.min(168, Math.max(1, hours)) : 6;
          g.showVoice = Boolean(b.showVoice);
          g.showEmptyCategories = Boolean(b.showEmptyCategories);
          g.uncategorizedName = String(b.uncategorizedName || '').trim().slice(0, 80) || 'Other channels';
          g.separator = ['large', 'small', 'none'].includes(b.separator) ? b.separator : 'large';
          store.save();
          if (g.channelId) { const r = await roadmap.refresh(client, req.guild.id, { reason: 'settings saved' }); return q(res, base, r.ok ? 'Settings saved and roadmap updated.' : null, r.ok ? null : `Settings saved, but: ${r.text}`); }
          return q(res, base, 'Settings saved. Pick a roadmap channel to post it.');
        }
        case 'category': {
          const id = String(b.id || '');
          g.categories[id] = { name: String(b.name || '').trim().slice(0, 80) || null, hidden: Boolean(b.hidden) };
          // channels inside this category: description + hidden
          const results = [];
          for (const key of Object.keys(b)) {
            if (!key.startsWith('desc_')) continue;
            const cid = key.slice(5);
            const text = String(b[key] || '').trim().slice(0, 1024);
            const c = req.guild.channels.cache.get(cid);
            if (!c) continue;
            g.channels[cid] = { ...(g.channels[cid] || {}), hidden: Boolean(b[`hide_${cid}`]) };
            const current = roadmap.descriptionOf(g, c);
            if (text !== current) { const r = await roadmap.setDescription(req.guild, cid, text); if (r.ok && !r.topicOk) results.push(`#${c.name}: topic not changed (Manage Channels?)`); }
          }
          store.save();
          const r = g.channelId ? await roadmap.refresh(client, req.guild.id, { reason: 'dashboard edit' }) : { ok: true };
          return q(res, base, r.ok ? `Saved.${results.length ? ' ⚠️ ' + results.join('; ') : ''}` : null, r.ok ? null : r.text, '#cat-' + id);
        }
        case 'refresh': { const r = await roadmap.refresh(client, req.guild.id, { reason: 'manual' }); return q(res, base, r.ok ? r.text : null, r.ok ? null : r.text); }
        case 'reset': { g.descriptions = {}; g.channels = {}; g.categories = {}; store.save(); if (g.channelId) await roadmap.refresh(client, req.guild.id, { reason: 'reset' }); return q(res, base, 'All overrides cleared — the roadmap now shows the real names and topics.'); }
        case 'remove': { g.channelId = null; g.messageIds = []; store.save(); return q(res, base, 'Roadmap disabled (the old messages were left in place — delete them if you like).'); }
        default: return q(res, base, null, 'Unknown action.');
      }
    } catch (err) { console.error('dashboard POST failed:', err); return q(res, base, null, err.message); }
  });
}

// plain-text preview of what the card will contain
function previewText(structure, g) {
  return structure.filter((c) => !c.hidden).map((c) => ({ name: c.displayName, lines: c.channels.filter((x) => !x.hidden && (g.showVoice || !x.voice)).map((x) => ({ name: x.name, voice: x.voice, description: x.description })) })).filter((c) => c.lines.length || g.showEmptyCategories);
}
module.exports = { mount };
