const {
  Client, GatewayIntentBits, Partials, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits
} = require('discord.js');
const https = require('https');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.GuildMember, Partials.Channel],
});

const AUTO_ROLE_ID   = process.env.AUTO_ROLE_ID;
const MEMBER_ROLE_ID = process.env.MEMBER_ROLE_ID;
const BOT_TOKEN      = process.env.BOT_TOKEN;
const GITHUB_TOKEN   = process.env.GITHUB_TOKEN;
const GITHUB_REPO    = process.env.GITHUB_REPO;
const GITHUB_FILE    = process.env.GITHUB_FILE_PATH;

const KEY_ROLE_IDS      = ['1491479203869098056', '1491478838390034635'];
const KEY_DURATION_MS   = 10 * 60 * 60 * 1000;
const MAX_KEYS_PER_USER = 10;

const COLOR = {
  white: 0xFFFFFF,
  gray:  0x888888,
};

let joinLogChannelId = process.env.JOIN_LOG_CHANNEL_ID || '';
let keyLogChannelId  = '';

// userId -> [{ key, expiresAt, notified }]
const userKeys = new Map();

async function sendKeyLog(embed) {
  if (!keyLogChannelId) return;
  const ch = client.channels.cache.get(keyLogChannelId);
  if (ch) ch.send({ embeds: [embed] }).catch(() => {});
}

// ─── KEY HELPERS ──────────────────────────────────────────────────────────────
function generateKey() {
  const rand = Math.floor(Math.random() * 1e20).toString().padStart(20, '0');
  return `AEVD-Free-10h-${rand}`;
}

function getUserKeys(userId) {
  if (!userKeys.has(userId)) userKeys.set(userId, []);
  return userKeys.get(userId);
}

function getActiveKeys(userId) {
  const now = Date.now();
  return getUserKeys(userId).filter(k => k.expiresAt > now);
}

// ─── GITHUB ───────────────────────────────────────────────────────────────────
async function githubRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.github.com',
      path,
      method,
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'AevumBot',
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch { resolve(raw); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function getFileSha() {
  const res = await githubRequest('GET', `/repos/${GITHUB_REPO}/contents/${GITHUB_FILE}`);
  return res.sha;
}

async function getAllActiveKeysFromMemory() {
  const now = Date.now();
  const all = [];
  for (const keys of userKeys.values()) {
    for (const k of keys) {
      if (k.expiresAt > now) all.push(k.key);
    }
  }
  return all;
}

async function pushKeysToGitHub() {
  const keys = await getAllActiveKeysFromMemory();
  let sha;
  try { sha = await getFileSha(); } catch {}
  const content = Buffer.from(keys.join('\n') + '\n').toString('base64');
  await githubRequest('PUT', `/repos/${GITHUB_REPO}/contents/${GITHUB_FILE}`, {
    message: 'AevumBot: key update',
    content,
    ...(sha ? { sha } : {}),
  });
}

// ─── KEY EXPIRY CHECKER ───────────────────────────────────────────────────────
setInterval(async () => {
  const now = Date.now();
  let changed = false;

  for (const [userId, keys] of userKeys.entries()) {
    for (const k of keys) {
      if (!k.notified && k.expiresAt <= now) {
        k.notified = true;
        changed = true;
        try {
          const user = await client.users.fetch(userId);
          await user.send(
            `Your key has expired.\n\`\`\`${k.key}\`\`\`\nYou can generate a new one from the server.`
          );
          const expireEmbed = new EmbedBuilder()
            .setColor(COLOR.gray)
            .setTitle('Key Expired')
            .addFields(
              { name: 'Key',  value: `\`${k.key}\``, inline: false },
              { name: 'User', value: `${user.tag} (${userId})`, inline: true },
              { name: 'Expired At', value: new Date().toLocaleString('en-US'), inline: true }
            );
          await sendKeyLog(expireEmbed);
        } catch {}
      }
    }
    userKeys.set(userId, keys.filter(k => k.expiresAt > now));
  }

  if (changed) await pushKeysToGitHub().catch(() => {});
}, 60 * 1000);

// ─── AUTO ROLE + JOIN LOG ─────────────────────────────────────────────────────
client.on('guildMemberAdd', async (member) => {
  try {
    const role = member.guild.roles.cache.get(AUTO_ROLE_ID);
    if (!role) return console.log('[AutoRole] Role not found.');
    await member.roles.add(role);
  } catch (err) {
    console.error('[AutoRole] Error:', err);
  }

  if (!joinLogChannelId) return;
  const logChannel = member.guild.channels.cache.get(joinLogChannelId);
  if (!logChannel) return;

  const embed = new EmbedBuilder()
    .setColor(COLOR.white)
    .setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL({ dynamic: true }) })
    .setTitle('Welcome to AevumDevs')
    .setDescription(member.user.tag)
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 128 }))
    .setFooter({ text: `AevumDevs  •  ${new Date().toLocaleString('en-US', { weekday: 'long', hour: '2-digit', minute: '2-digit' })}` });

  logChannel.send({ embeds: [embed] });
});

// ─── LEAVE LOG ────────────────────────────────────────────────────────────────
client.on('guildMemberRemove', async (member) => {
  if (!joinLogChannelId) return;
  const logChannel = member.guild.channels.cache.get(joinLogChannelId);
  if (!logChannel) return;

  const embed = new EmbedBuilder()
    .setColor(COLOR.gray)
    .setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL({ dynamic: true }) })
    .setTitle('See You Later')
    .setDescription(member.user.tag)
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 128 }))
    .setFooter({ text: `AevumDevs  •  ${new Date().toLocaleString('en-US', { weekday: 'long', hour: '2-digit', minute: '2-digit' })}` });

  logChannel.send({ embeds: [embed] });
});

// ─── COMMANDS ─────────────────────────────────────────────────────────────────
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // !getmember
  if (message.content === '!getmember') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return message.reply('You do not have permission to use this command.');
    }

    const embed = new EmbedBuilder()
      .setColor(COLOR.white)
      .setTitle('Get Member')
      .setDescription(
        '> To gain full access to the server, click the button below to receive the member role.\n' +
        '> This role allows you to join all public channels, chat, and access available content.\n' +
        '> Your role will be assigned instantly after clicking the button.\n' +
        '> If you experience any issues, feel free to contact the staff team.\n\n' +
        '`This process is safe and only grants access permissions.`'
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('get_member')
        .setLabel('Get Member')
        .setStyle(ButtonStyle.Secondary)
    );

    await message.channel.send({ embeds: [embed], components: [row] });
    await message.delete().catch(() => {});
  }

  // !joins
  if (message.content === '!joins') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return message.reply('You do not have permission to use this command.');
    }

    joinLogChannelId = message.channel.id;
    await message.reply(`Join/Leave logs will now be sent to: <#${message.channel.id}>`);
    await message.delete().catch(() => {});
  }

  // !keylog
  if (message.content === '!keylog') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return message.reply('You do not have permission to use this command.');
    }
    keyLogChannelId = message.channel.id;
    await message.reply(`Key logs will now be sent to: <#${message.channel.id}>`);
    await message.delete().catch(() => {});
  }

  // !keypanel
  if (message.content === '!keypanel') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return message.reply('You do not have permission to use this command.');
    }

    const embed = new EmbedBuilder()
      .setColor(COLOR.white)
      .setTitle('Key System')
      .setDescription(
        'Select a script below to generate a key.\n\n' +
        'Each user has a maximum of **10 keys** per category.'
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('key_universal')
        .setLabel('Universal')
        .setStyle(ButtonStyle.Secondary)
    );

    await message.channel.send({ embeds: [embed], components: [row] });
    await message.delete().catch(() => {});
  }

  // !mykey
  if (message.content === '!mykey') {
    const active = getActiveKeys(message.author.id);
    if (active.length === 0) {
      return message.author.send('You have no active keys.').catch(() => {
        message.reply('You have no active keys.');
      });
    }

    const now = Date.now();
    const keyList = active.map(k => {
      const remaining = Math.ceil((k.expiresAt - now) / 1000 / 60);
      return `\`${k.key}\`  —  ${remaining} min remaining`;
    }).join('\n');

    await message.author.send(`**Active Keys**\n\n${keyList}`).catch(() => {
      message.reply('Could not DM you. Please enable DMs.');
    });
  }

  // !cmd
  if (message.content === '!cmd') {
    const embed = new EmbedBuilder()
      .setColor(COLOR.white)
      .setTitle('Commands')
      .setDescription(
        '`!keypanel` — Post key panel  *(staff)*\n' +
        '`!keylog` — Set key log channel  *(staff)*\n' +
        '`!mykey` — View your active keys via DM\n' +
        '`!getmember` — Post member role button  *(staff)*\n' +
        '`!joins` — Set join/leave log channel  *(staff)*'
      );
    await message.reply({ embeds: [embed] });
  }
});

// ─── INTERACTIONS ─────────────────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  // get_member
  if (interaction.customId === 'get_member') {
    const role = interaction.guild.roles.cache.get(MEMBER_ROLE_ID);
    if (!role) {
      return interaction.reply({ content: 'Member role not found. Contact an administrator.', ephemeral: true });
    }

    if (interaction.member.roles.cache.has(MEMBER_ROLE_ID)) {
      return interaction.reply({ content: 'You already have the member role.', ephemeral: true });
    }

    try {
      await interaction.member.roles.add(role);
      await interaction.reply({ content: 'Member role assigned. Enjoy the server.', ephemeral: true });
    } catch (err) {
      console.error('[GetMember] Error:', err);
      await interaction.reply({ content: 'Failed to assign role. Contact an administrator.', ephemeral: true });
    }
  }

  // key_universal
  if (interaction.customId === 'key_universal') {
    const member = interaction.member;
    const hasRole = KEY_ROLE_IDS.some(id => member.roles.cache.has(id));

    if (!hasRole) {
      return interaction.reply({
        content: 'You do not have the required role to generate a key.',
        ephemeral: true,
      });
    }

    const active = getActiveKeys(interaction.user.id);
    if (active.length >= MAX_KEYS_PER_USER) {
      return interaction.reply({
        content: `You already have ${MAX_KEYS_PER_USER} active keys. Wait for one to expire.`,
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const key = generateKey();
    const expiresAt = Date.now() + KEY_DURATION_MS;
    getUserKeys(interaction.user.id).push({ key, expiresAt, notified: false });

    try {
      await pushKeysToGitHub();
    } catch (err) {
      console.error('[GitHub] Push error:', err);
      return interaction.editReply({ content: 'Failed to save key. Try again later.' });
    }

    const expiresDate = new Date(expiresAt).toLocaleString('en-US');
    const genEmbed = new EmbedBuilder()
      .setColor(COLOR.white)
      .setTitle('Key Generated')
      .addFields(
        { name: 'Key',      value: `\`${key}\``, inline: false },
        { name: 'Type',     value: 'Universal',  inline: true },
        { name: 'User',     value: `${interaction.user.tag} (${interaction.user.id})`, inline: true },
        { name: 'Duration', value: '10 hours',   inline: true },
        { name: 'Expires',  value: expiresDate,  inline: false }
      );
    await sendKeyLog(genEmbed);

    try {
      await interaction.user.send(
        `**Universal Key**\n\`\`\`${key}\`\`\`Expires in **10 hours**.`
      );
      await interaction.editReply({ content: 'Key sent to your DMs.' });
    } catch {
      await interaction.editReply({
        content: `**Your Key**\n\`\`\`${key}\`\`\`Expires in **10 hours**.\n\nEnable DMs to receive expiry notifications.`,
      });
    }
  }
});

// ─── READY ────────────────────────────────────────────────────────────────────
client.once('ready', () => {
  console.log(`AevumBot online | ${client.user.tag}`);
});

client.login(BOT_TOKEN);
