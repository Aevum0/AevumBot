const { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.GuildMember],
});

const config = require('./config.json');

// ─── 1. OTOMATİK ROL (sunucuya giren herkese) ───────────────────────────────
client.on('guildMemberAdd', async (member) => {
  try {
    const role = member.guild.roles.cache.get(config.autoRoleId);
    if (!role) return console.log('[AutoRole] Role not found.');
    await member.roles.add(role);
    console.log(`[AutoRole] ${member.user.tag} -> role assigned`);
  } catch (err) {
    console.error('[AutoRole] Hata:', err);
  }

  // ─── 3. JOIN LOG ──────────────────────────────────────────────────────────
  if (!config.joinLogChannelId) return;
  const logChannel = member.guild.channels.cache.get(config.joinLogChannelId);
  if (!logChannel) return;

  const embed = new EmbedBuilder()
    .setColor(0x57F287)
    .setAuthor({
      name: member.user.tag,
      iconURL: member.user.displayAvatarURL({ dynamic: true }),
    })
    .setTitle('Welcome to AevumDevs')
    .setDescription(member.user.tag)
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 128 }))
    .setFooter({ text: `AevumDevs • ${new Date().toLocaleDateString('tr-TR', { weekday: 'long', hour: '2-digit', minute: '2-digit' })}` });

  logChannel.send({ embeds: [embed] });
});

// ─── LEAVE LOG ───────────────────────────────────────────────────────────────
client.on('guildMemberRemove', async (member) => {
  if (!config.joinLogChannelId) return;
  const logChannel = member.guild.channels.cache.get(config.joinLogChannelId);
  if (!logChannel) return;

  const embed = new EmbedBuilder()
    .setColor(0xED4245)
    .setAuthor({
      name: member.user.tag,
      iconURL: member.user.displayAvatarURL({ dynamic: true }),
    })
    .setTitle('See You Later')
    .setDescription(member.user.tag)
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 128 }))
    .setFooter({ text: `AevumDevs • ${new Date().toLocaleDateString('tr-TR', { weekday: 'long', hour: '2-digit', minute: '2-digit' })}` });

  logChannel.send({ embeds: [embed] });
});

// ─── MESAJ KOMUTları ─────────────────────────────────────────────────────────
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // ── !getmember ──────────────────────────────────────────────────────────
  if (message.content === '!getmember') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return message.reply('You do not have permission to use this command.');
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('## Get Member')
      .setDescription(
        '> To gain full access to the server, click the button below to receive the member role.\n' +
        '> This role allows you to join all public channels, chat, and access available content.\n' +
        '> Your role will be assigned instantly after clicking the button.\n' +
        '> If you experience any issues, feel free to contact the staff team.\n\n' +
        '`🔒 This process is safe and only grants access permissions.`'
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('get_member')
        .setLabel('Get Member')
        .setStyle(ButtonStyle.Primary)
    );

    await message.channel.send({ embeds: [embed], components: [row] });
    await message.delete().catch(() => {});
  }

  // ── !joins ───────────────────────────────────────────────────────────────
  if (message.content === '!joins') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return message.reply('You do not have permission to use this command.');
    }

    config.joinLogChannelId = message.channel.id;

    // Update config
    const fs = require('fs');
    fs.writeFileSync('./config.json', JSON.stringify(config, null, 2));

    await message.reply(`Join/Leave logs will now be sent to: <#${message.channel.id}>`);
    await message.delete().catch(() => {});
  }
});

// ─── BUTON: get_member ────────────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  if (interaction.customId === 'get_member') {
    const role = interaction.guild.roles.cache.get(config.memberRoleId);
    if (!role) {
      return interaction.reply({ content: 'Member role not found. Contact an administrator.', ephemeral: true });
    }

    if (interaction.member.roles.cache.has(config.memberRoleId)) {
      return interaction.reply({ content: 'You already have the member role.', ephemeral: true });
    }

    try {
      await interaction.member.roles.add(role);
      await interaction.reply({ content: 'Member role successfully assigned. Enjoy the server.', ephemeral: true });
    } catch (err) {
      console.error('[GetMember] Error:', err);
      await interaction.reply({ content: 'Failed to assign role. Contact an administrator.', ephemeral: true });
    }
  }
});

// ─── READY ───────────────────────────────────────────────────────────────────
client.once('ready', () => {
  console.log(`AevumBot online | ${client.user.tag}`);
});

client.login(config.token);