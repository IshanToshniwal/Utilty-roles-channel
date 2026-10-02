// Any channel/category change -> refresh the roadmap (debounced). Topic edits made in Discord
// update the stored description so the dashboard and Discord never disagree.
const { Events } = require('discord.js');
const store = require('../lib/store');
const roadmap = require('../lib/roadmap');

const touch = (client, guild) => { if (guild && store.data.guilds[guild.id]?.channelId) roadmap.scheduleRefresh(client, guild.id); };
module.exports = [
  { name: Events.ChannelCreate, execute: (client, c) => touch(client, c.guild) },
  { name: Events.ChannelDelete, execute: (client, c) => { if (!c.guild) return; const g = store.data.guilds[c.guild.id]; if (g) { delete g.descriptions[c.id]; delete g.channels[c.id]; delete g.categories[c.id]; store.save(); } touch(client, c.guild); } },
  { name: Events.ChannelUpdate, execute: (client, oldC, newC) => {
    if (!newC.guild) return;
    const g = store.data.guilds[newC.guild.id];
    if (g && 'topic' in newC && oldC.topic !== newC.topic && g.descriptions[newC.id] !== undefined && g.descriptions[newC.id] !== (newC.topic || '')) { g.descriptions[newC.id] = newC.topic || ''; store.save(); }
    if (oldC.name !== newC.name || oldC.rawPosition !== newC.rawPosition || oldC.parentId !== newC.parentId || oldC.topic !== newC.topic) touch(client, newC.guild);
  } },
];
