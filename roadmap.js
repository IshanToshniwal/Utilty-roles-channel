// /roadmap setup | refresh | describe | hide | show | rename | interval | view
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const store = require('../lib/store');
const roadmap = require('../lib/roadmap');
const ui = require('../lib/ui');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('roadmap')
    .setDescription('Channel roadmap — a live list of every channel with its description')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('setup').setDescription('Choose the channel where the roadmap is posted (posts it right away)').addChannelOption((o) => o.setName('channel').setDescription('Channel').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
    .addSubcommand((s) => s.setName('refresh').setDescription('Rebuild the roadmap now'))
    .addSubcommand((s) => s.setName('describe').setDescription("Set a channel's description (also sets its topic)").addChannelOption((o) => o.setName('channel').setDescription('Channel').setRequired(true)).addStringOption((o) => o.setName('text').setDescription('Description (empty = clear)').setMaxLength(1024)))
    .addSubcommand((s) => s.setName('hide').setDescription('Hide a channel or category from the roadmap').addChannelOption((o) => o.setName('channel').setDescription('Channel or category').setRequired(true)))
    .addSubcommand((s) => s.setName('show').setDescription('Show a hidden channel or category again').addChannelOption((o) => o.setName('channel').setDescription('Channel or category').setRequired(true)))
    .addSubcommand((s) => s.setName('rename').setDescription('Display name for a category in the roadmap (does not rename it in Discord)').addChannelOption((o) => o.setName('category').setDescription('Category').setRequired(true).addChannelTypes(ChannelType.GuildCategory)).addStringOption((o) => o.setName('name').setDescription('Display name (empty = use the real name)').setMaxLength(80)))
    .addSubcommand((s) => s.setName('interval').setDescription('How often the roadmap refreshes itself').addIntegerOption((o) => o.setName('hours').setDescription('Hours (1–168)').setRequired(true).setMinValue(1).setMaxValue(168)))
    .addSubcommand((s) => s.setName('view').setDescription('Show the current settings')),
  async execute(interaction) {
    const g = store.guild(interaction.guildId);
    const sub = interaction.options.getSubcommand();
    if (sub === 'setup') {
      g.channelId = interaction.options.getChannel('channel').id;
      g.messageIds = [];
      store.save();
      await interaction.deferReply({ flags: 64 });
      const r = await roadmap.refresh(interaction.client, interaction.guildId, { reason: 'setup' });
      return interaction.editReply(r.ok ? ui.ok(`Roadmap posted in <#${g.channelId}>. It refreshes every ${g.intervalHours} h and whenever channels change. Edit descriptions and category names on the dashboard.`) : ui.fail(r.text, { ephemeral: false }));
    }
    if (sub === 'refresh') {
      await interaction.deferReply({ flags: 64 });
      const r = await roadmap.refresh(interaction.client, interaction.guildId, { reason: 'manual' });
      return interaction.editReply(r.ok ? ui.ok(r.text) : ui.fail(r.text, { ephemeral: false }));
    }
    if (sub === 'describe') {
      await interaction.deferReply({ flags: 64 });
      const r = await roadmap.setDescription(interaction.guild, interaction.options.getChannel('channel').id, interaction.options.getString('text') || '');
      if (r.ok) roadmap.scheduleRefresh(interaction.client, interaction.guildId, 2000);
      return interaction.editReply(r.ok ? ui.ok(r.text) : ui.fail(r.text, { ephemeral: false }));
    }
    if (sub === 'hide' || sub === 'show') {
      const c = interaction.options.getChannel('channel');
      const bucket = c.type === ChannelType.GuildCategory ? g.categories : g.channels;
      bucket[c.id] = { ...(bucket[c.id] || {}), hidden: sub === 'hide' };
      store.save();
      roadmap.scheduleRefresh(interaction.client, interaction.guildId, 2000);
      return interaction.reply(ui.ok(`${c.type === ChannelType.GuildCategory ? 'Category' : 'Channel'} **${c.name}** is now ${sub === 'hide' ? 'hidden from' : 'shown in'} the roadmap.`, { ephemeral: true }));
    }
    if (sub === 'rename') {
      const c = interaction.options.getChannel('category');
      const name = interaction.options.getString('name')?.trim() || null;
      g.categories[c.id] = { ...(g.categories[c.id] || {}), name };
      store.save();
      roadmap.scheduleRefresh(interaction.client, interaction.guildId, 2000);
      return interaction.reply(ui.ok(name ? `**${c.name}** will show as **${name}**.` : `**${c.name}** uses its real name again.`, { ephemeral: true }));
    }
    if (sub === 'interval') {
      g.intervalHours = interaction.options.getInteger('hours');
      store.save();
      return interaction.reply(ui.ok(`The roadmap now refreshes every **${g.intervalHours} h** (plus instantly when channels change).`, { ephemeral: true }));
    }
    const s = roadmap.structure(interaction.guild, g);
    return interaction.reply(ui.msg(ui.card({ color: g.color, title: '🗺️ ChannelMap settings', fields: [
      { name: 'Roadmap channel', value: g.channelId ? `<#${g.channelId}> (${g.messageIds.length} message${g.messageIds.length === 1 ? '' : 's'})` : 'not set — `/roadmap setup`', inline: true },
      { name: 'Refresh', value: `every ${g.intervalHours} h · last ${g.lastRefresh ? `<t:${Math.floor(new Date(g.lastRefresh) / 1000)}:R>` : 'never'}`, inline: true },
      { name: 'Content', value: `${s.length} categories · ${s.reduce((n, c) => n + c.channels.length, 0)} channels · ${Object.keys(g.descriptions).length} custom descriptions · ${s.filter((c) => c.hidden).length + s.reduce((n, c) => n + c.channels.filter((x) => x.hidden).length, 0)} hidden` },
      { name: 'Dashboard', value: process.env.BASE_URL ? `${process.env.BASE_URL}/dashboard/${interaction.guildId}` : "Open the bot's website → Login with Discord" },
    ] }), { ephemeral: true }));
  },
};
