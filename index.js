const { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, ChannelType, AttachmentBuilder } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.GuildMember],
});

const AUTO_ROLE_ID    = process.env.AUTO_ROLE_ID;
const MEMBER_ROLE_ID  = process.env.MEMBER_ROLE_ID;
const BOT_TOKEN       = process.env.BOT_TOKEN;
const LOG_CHANNEL_ID  = '1492333026594521158';
const SHELP_ROLE_ID   = '1492332555985486108';

// Ticket config
const SUPPORT_CATEGORY_ID  = '1492510610351587388';
const PURCHASE_CATEGORY_ID = '1492510746360152244';
const SUPPORT_STAFF_ROLE   = '1491479203869098056';
const TICKET_LOG_CHANNEL   = '1492511561158365256';

let joinLogChannelId = process.env.JOIN_LOG_CHANNEL_ID || '';
let ticketCounter = 0;

// ─── HELPERS ──────────────────────────────────────────────────────────────────
async function sendLog(guild, embed) {
  const ch = guild.channels.cache.get(LOG_CHANNEL_ID);
  if (ch) ch.send({ embeds: [embed] });
}

function modEmbed(color, title, fields) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .addFields(fields)
    .setTimestamp();
}

// ─── AUTO ROLE + JOIN LOG ─────────────────────────────────────────────────────
client.on('guildMemberAdd', async (member) => {
  try {
    const role = member.guild.roles.cache.get(AUTO_ROLE_ID);
    if (role) await member.roles.add(role);
  } catch (err) {
    console.error('[AutoRole] Error:', err);
  }

  if (!joinLogChannelId) return;
  const logChannel = member.guild.channels.cache.get(joinLogChannelId);
  if (!logChannel) return;

  const embed = new EmbedBuilder()
    .setColor(0x57F287)
    .setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL({ dynamic: true }) })
    .setTitle('Welcome to AevumDevs')
    .setDescription(member.user.tag)
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 128 }))
    .setFooter({ text: `AevumDevs • ${new Date().toLocaleString('en-US', { weekday: 'long', hour: '2-digit', minute: '2-digit' })}` });

  logChannel.send({ embeds: [embed] });
});

// ─── LEAVE LOG ────────────────────────────────────────────────────────────────
client.on('guildMemberRemove', async (member) => {
  if (!joinLogChannelId) return;
  const logChannel = member.guild.channels.cache.get(joinLogChannelId);
  if (!logChannel) return;

  const embed = new EmbedBuilder()
    .setColor(0xED4245)
    .setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL({ dynamic: true }) })
    .setTitle('See You Later')
    .setDescription(member.user.tag)
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 128 }))
    .setFooter({ text: `AevumDevs • ${new Date().toLocaleString('en-US', { weekday: 'long', hour: '2-digit', minute: '2-digit' })}` });

  logChannel.send({ embeds: [embed] });
});

// ─── COMMANDS ─────────────────────────────────────────────────────────────────
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const args = message.content.trim().split(/ +/);
  const command = args[0].toLowerCase();

  // ── !ping ──────────────────────────────────────────────────────────────────
  if (command === '!ping') {
    const sent = await message.reply('Pinging...');
    sent.edit(`Pong! \`${sent.createdTimestamp - message.createdTimestamp}ms\``);
  }

  // ── !getmember ─────────────────────────────────────────────────────────────
  if (command === '!getmember') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageRoles))
      return message.reply('You do not have permission to use this command.');

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('Get Member')
      .setDescription(
        '> To gain full access to the server, click the button below to receive the member role.\n' +
        '> This role allows you to join all public channels, chat, and access available content.\n' +
        '> Your role will be assigned instantly after clicking the button.\n' +
        '> If you experience any issues, feel free to contact the staff team.\n\n' +
        '`This process is safe and only grants access permissions.`'
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('get_member').setLabel('Get Member').setStyle(ButtonStyle.Primary)
    );

    await message.channel.send({ embeds: [embed], components: [row] });
    await message.delete().catch(() => {});
  }

  // ── !joins ─────────────────────────────────────────────────────────────────
  if (command === '!joins') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild))
      return message.reply('You do not have permission to use this command.');

    joinLogChannelId = message.channel.id;
    await message.reply(`Join/Leave logs will now be sent to: <#${message.channel.id}>`);
    await message.delete().catch(() => {});
  }

  // ── !ban @ [reason] ────────────────────────────────────────────────────────
  if (command === '!ban') {
    if (!message.member.permissions.has(PermissionFlagsBits.BanMembers))
      return message.reply('You do not have permission to use this command.');

    const target = message.mentions.members.first();
    if (!target) return message.reply('Please mention a valid member.');
    if (!target.bannable) return message.reply('I cannot ban this user.');

    const reason = args.slice(2).join(' ') || 'No reason provided';
    await target.ban({ reason });
    message.reply(`**${target.user.tag}** has been banned. Reason: ${reason}`);

    sendLog(message.guild, modEmbed(0xED4245, 'Member Banned', [
      { name: 'User', value: `${target.user.tag} (${target.id})`, inline: true },
      { name: 'Moderator', value: message.author.tag, inline: true },
      { name: 'Reason', value: reason },
    ]));
  }

  // ── !unban ID ──────────────────────────────────────────────────────────────
  if (command === '!unban') {
    if (!message.member.permissions.has(PermissionFlagsBits.BanMembers))
      return message.reply('You do not have permission to use this command.');

    const userId = args[1];
    if (!userId) return message.reply('Please provide a user ID.');

    try {
      const user = await client.users.fetch(userId);
      await message.guild.members.unban(userId);
      message.reply(`**${user.tag}** has been unbanned.`);

      sendLog(message.guild, modEmbed(0x57F287, 'Member Unbanned', [
        { name: 'User', value: `${user.tag} (${user.id})`, inline: true },
        { name: 'Moderator', value: message.author.tag, inline: true },
      ]));
    } catch {
      message.reply('Could not find a banned user with that ID.');
    }
  }

  // ── !kick @ [reason] ───────────────────────────────────────────────────────
  if (command === '!kick') {
    if (!message.member.permissions.has(PermissionFlagsBits.KickMembers))
      return message.reply('You do not have permission to use this command.');

    const target = message.mentions.members.first();
    if (!target) return message.reply('Please mention a valid member.');
    if (!target.kickable) return message.reply('I cannot kick this user.');

    const reason = args.slice(2).join(' ') || 'No reason provided';
    await target.kick(reason);
    message.reply(`**${target.user.tag}** has been kicked. Reason: ${reason}`);

    sendLog(message.guild, modEmbed(0xFEE75C, 'Member Kicked', [
      { name: 'User', value: `${target.user.tag} (${target.id})`, inline: true },
      { name: 'Moderator', value: message.author.tag, inline: true },
      { name: 'Reason', value: reason },
    ]));
  }

  // ── !timeout @ [time] [reason] ─────────────────────────────────────────────
  if (command === '!timeout') {
    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers))
      return message.reply('You do not have permission to use this command.');

    const target = message.mentions.members.first();
    if (!target) return message.reply('Please mention a valid member.');

    const timeStr = args[2];
    if (!timeStr) return message.reply('Please provide a duration. Example: `10s`, `5m`, `1h`, `1d`');

    const units = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
    const unit = timeStr.slice(-1);
    const amount = parseInt(timeStr);
    if (!units[unit] || isNaN(amount)) return message.reply('Invalid duration. Use: `10s`, `5m`, `1h`, `1d`');

    const ms = amount * units[unit];
    const reason = args.slice(3).join(' ') || 'No reason provided';

    try {
      await target.timeout(ms, reason);
      message.reply(`**${target.user.tag}** has been timed out for **${timeStr}**. Reason: ${reason}`);

      sendLog(message.guild, modEmbed(0xFFA500, 'Member Timed Out', [
        { name: 'User', value: `${target.user.tag} (${target.id})`, inline: true },
        { name: 'Moderator', value: message.author.tag, inline: true },
        { name: 'Duration', value: timeStr, inline: true },
        { name: 'Reason', value: reason },
      ]));
    } catch {
      message.reply('Failed to timeout this user.');
    }
  }

  // ── !del [amount] ──────────────────────────────────────────────────────────
  if (command === '!del') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages))
      return message.reply('You do not have permission to use this command.');

    const amount = parseInt(args[1]);
    if (isNaN(amount) || amount < 1 || amount > 100)
      return message.reply('Please provide a number between 1 and 100.');

    await message.channel.bulkDelete(amount + 1, true).catch(() => {
      message.reply('Could not delete messages. Messages older than 14 days cannot be bulk deleted.');
    });

    sendLog(message.guild, modEmbed(0x99AAB5, 'Messages Deleted', [
      { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
      { name: 'Amount', value: `${amount}`, inline: true },
      { name: 'Moderator', value: message.author.tag, inline: true },
    ]));
  }

  // ── !whois @ ───────────────────────────────────────────────────────────────
  if (command === '!whois') {
    const target = message.mentions.members.first() || message.member;

    const roles = target.roles.cache
      .filter(r => r.id !== message.guild.id)
      .sort((a, b) => b.position - a.position)
      .map(r => `<@&${r.id}>`)
      .join(', ') || 'None';

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setAuthor({ name: target.user.tag, iconURL: target.user.displayAvatarURL({ dynamic: true }) })
      .setThumbnail(target.user.displayAvatarURL({ dynamic: true, size: 256 }))
      .addFields(
        { name: 'Username', value: target.user.tag, inline: true },
        { name: 'ID', value: target.id, inline: true },
        { name: 'Nickname', value: target.nickname || 'None', inline: true },
        { name: 'Account Created', value: `<t:${Math.floor(target.user.createdTimestamp / 1000)}:R>`, inline: true },
        { name: 'Joined Server', value: `<t:${Math.floor(target.joinedTimestamp / 1000)}:R>`, inline: true },
        { name: `Roles (${target.roles.cache.size - 1})`, value: roles },
      )
      .setTimestamp();

    message.reply({ embeds: [embed] });
  }

  // ── !say #channel message ──────────────────────────────────────────────────
  if (command === '!say') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages))
      return message.reply('You do not have permission to use this command.');

    const targetChannel = message.mentions.channels.first();
    if (!targetChannel) return message.reply('Please mention a channel. Example: `!say #general Hello!`');

    const content = args.slice(2).join(' ');
    if (!content) return message.reply('Please provide a message to send.');

    await targetChannel.send(content);
    await message.delete().catch(() => {});
  }

  // ── .shelp ─────────────────────────────────────────────────────────────────
  if (command === '.shelp') {
    if (!message.member.roles.cache.has(SHELP_ROLE_ID))
      return message.reply('You do not have permission to use this command.');

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('Staff Help — Command List')
      .addFields(
        { name: 'Moderation', value: '`!ban @user [reason]`\n`!unban <id>`\n`!kick @user [reason]`\n`!timeout @user <10s/5m/1h/1d> [reason]`\n`!del <1-100>`' },
        { name: 'Info', value: '`!whois [@user]`\n`!ping`' },
        { name: 'Utility', value: '`!say #channel <message>`\n`!getmember`\n`!joins`\n`!support`\n`!purchase`' },
        { name: 'Staff Only', value: '`.shelp`' },
      )
      .setFooter({ text: 'AevumDevs Staff Panel' })
      .setTimestamp();

    message.reply({ embeds: [embed] });
  }

  // ── !support ───────────────────────────────────────────────────────────────
  if (command === '!support') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels))
      return message.reply('You do not have permission to use this command.');

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('AevumDevs | Support Ticket')
      .setDescription(
        'If you have any problems, you can open a Support Ticket.\n\n' +
        '• Only staff and you can see the ticket.\n' +
        '• Provide as much detail as possible.\n' +
        '• Close the ticket when you are done.'
      )
      .setImage('https://cdn.discordapp.com/attachments/1492511561158365256/1492517573445812345/SupportTicket.gif?ex=69db9ecf&is=69da4d4f&hm=0cd856e9260e64cb9052fc821ce18ab006ce602a0677e54b21b354b56f4974ec&')
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('open_support').setLabel('Support Ticket').setStyle(ButtonStyle.Primary)
    );

    await message.channel.send({ embeds: [embed], components: [row] });
    await message.delete().catch(() => {});
  }

  // ── !purchase ──────────────────────────────────────────────────────────────
  if (command === '!purchase') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels))
      return message.reply('You do not have permission to use this command.');

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('AevumDevs | Purchase Ticket')
      .setDescription(
        'If you want to make a purchase, you can open a Purchase Ticket.\n\n' +
        '• Only staff and you can see the ticket.\n' +
        '• Provide as much detail as possible.\n' +
        '• Close the ticket when you are done.'
      )
      .setImage('https://cdn.discordapp.com/attachments/1492511561158365256/1492520168616759346/PurchaseTicket.gif?ex=69dba139&is=69da4fb9&hm=ae25fbb2d8b5c3da07d2f9c67bea9ed9a6b16e2f06d4f3feb7530cd4134e94dd&')
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('open_purchase').setLabel('Purchase Ticket').setStyle(ButtonStyle.Success)
    );

    await message.channel.send({ embeds: [embed], components: [row] });
    await message.delete().catch(() => {});
  }

  // ── !close (ticket kanalında) ──────────────────────────────────────────────
  if (command === '!close') {
    if (!message.channel.name.startsWith('support-') && !message.channel.name.startsWith('purchase-')) return;

    const hasPermission =
      message.member.permissions.has(PermissionFlagsBits.ManageChannels) ||
      message.member.roles.cache.has(SUPPORT_STAFF_ROLE);

    if (!hasPermission) return message.reply('You do not have permission to close this ticket.');

    await closeTicket(message.channel, message.guild, message.author);
  }
});

// ─── CLOSE TICKET FUNCTION ────────────────────────────────────────────────────
async function closeTicket(channel, guild, closedBy) {
  try {
    const messages = await channel.messages.fetch({ limit: 100 });
    const sorted = [...messages.values()].reverse();

    let transcript = `Ticket: ${channel.name}\nClosed by: ${closedBy.tag}\nDate: ${new Date().toISOString()}\n\n`;
    transcript += '─'.repeat(50) + '\n\n';

    for (const msg of sorted) {
      const time = new Date(msg.createdTimestamp).toLocaleString('en-US');
      transcript += `[${time}] ${msg.author.tag}: ${msg.content || '[embed/attachment]'}\n`;
    }

    const buffer = Buffer.from(transcript, 'utf-8');
    const attachment = new AttachmentBuilder(buffer, { name: `${channel.name}.txt` });

    const logChannel = guild.channels.cache.get(TICKET_LOG_CHANNEL);
    if (logChannel) {
      const logEmbed = new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle('Ticket Closed')
        .addFields(
          { name: 'Ticket', value: channel.name, inline: true },
          { name: 'Closed By', value: closedBy.tag, inline: true },
        )
        .setTimestamp();

      await logChannel.send({ embeds: [logEmbed], files: [attachment] });
    }

    await channel.send('Ticket is being closed...');
    setTimeout(() => channel.delete().catch(() => {}), 3000);
  } catch (err) {
    console.error('[CloseTicket] Error:', err);
  }
}

// ─── BUTTONS ──────────────────────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  // ── get_member ─────────────────────────────────────────────────────────────
  if (interaction.customId === 'get_member') {
    const role = interaction.guild.roles.cache.get(MEMBER_ROLE_ID);
    if (!role)
      return interaction.reply({ content: 'Member role not found. Contact an administrator.', ephemeral: true });

    if (interaction.member.roles.cache.has(MEMBER_ROLE_ID))
      return interaction.reply({ content: 'You already have the member role.', ephemeral: true });

    try {
      await interaction.member.roles.add(role);
      await interaction.reply({ content: 'Member role successfully assigned. Enjoy the server.', ephemeral: true });
    } catch (err) {
      console.error('[GetMember] Error:', err);
      await interaction.reply({ content: 'Failed to assign role. Contact an administrator.', ephemeral: true });
    }
  }

  // ── open_support ───────────────────────────────────────────────────────────
  if (interaction.customId === 'open_support') {
    await interaction.deferReply({ ephemeral: true });

    ticketCounter++;
    const channelName = `support-${interaction.user.username}-${ticketCounter}`;

    try {
      const ticketChannel = await interaction.guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: SUPPORT_CATEGORY_ID,
        permissionOverwrites: [
          {
            id: interaction.guild.id,
            deny: [PermissionFlagsBits.ViewChannel],
          },
          {
            id: interaction.user.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
          },
          {
            id: SUPPORT_STAFF_ROLE,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
          },
        ],
      });

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('Support')
        .setDescription(`${interaction.user.username}\n\nA staff member will be with you shortly.`)
        .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true, size: 128 }))
        .setFooter({ text: `AevumDevs • ${new Date().toLocaleString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}` });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('close_ticket').setLabel('Close').setStyle(ButtonStyle.Danger)
      );

      await ticketChannel.send({
        content: `<@${interaction.user.id}> <@&${SUPPORT_STAFF_ROLE}>`,
        embeds: [embed],
        components: [row],
      });

      await interaction.editReply({ content: `Your ticket has been created: <#${ticketChannel.id}>` });
    } catch (err) {
      console.error('[OpenSupport] Error:', err);
      await interaction.editReply({ content: 'Failed to create ticket. Contact an administrator.' });
    }
  }

  // ── open_purchase ──────────────────────────────────────────────────────────
  if (interaction.customId === 'open_purchase') {
    await interaction.deferReply({ ephemeral: true });

    ticketCounter++;
    const channelName = `purchase-${interaction.user.username}-${ticketCounter}`;

    try {
      const ticketChannel = await interaction.guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: PURCHASE_CATEGORY_ID,
        permissionOverwrites: [
          { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
          { id: SUPPORT_STAFF_ROLE, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
        ],
      });

      const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('Purchase')
        .setDescription(`${interaction.user.username}\n\nA staff member will be with you shortly.`)
        .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true, size: 128 }))
        .setFooter({ text: `AevumDevs • ${new Date().toLocaleString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}` });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('close_ticket').setLabel('Close').setStyle(ButtonStyle.Danger)
      );

      await ticketChannel.send({
        content: `<@${interaction.user.id}> <@&${SUPPORT_STAFF_ROLE}>`,
        embeds: [embed],
        components: [row],
      });

      await interaction.editReply({ content: `Your ticket has been created: <#${ticketChannel.id}>` });
    } catch (err) {
      console.error('[OpenPurchase] Error:', err);
      await interaction.editReply({ content: 'Failed to create ticket. Contact an administrator.' });
    }
  }

  // ── close_ticket (button) ──────────────────────────────────────────────────
  if (interaction.customId === 'close_ticket') {
    const hasPermission =
      interaction.member.permissions.has(PermissionFlagsBits.ManageChannels) ||
      interaction.member.roles.cache.has(SUPPORT_STAFF_ROLE);

    if (!hasPermission)
      return interaction.reply({ content: 'You do not have permission to close this ticket.', ephemeral: true });

    await interaction.reply({ content: 'Closing ticket...', ephemeral: true });
    await closeTicket(interaction.channel, interaction.guild, interaction.user);
  }
});

// ─── READY ────────────────────────────────────────────────────────────────────
client.once('ready', () => {
  console.log(`AevumBot online | ${client.user.tag}`);
});

client.login(BOT_TOKEN);
