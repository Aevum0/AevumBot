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
  white:  0xFFFFFF,
  gray:   0x888888,
  red:    0xFF4444,
  yellow: 0xFFCC00,
};

let joinLogChannelId  = process.env.JOIN_LOG_CHANNEL_ID || '';
let keyLogChannelId   = '';
let keyRightsChannelId = '';

// userId -> [{ key, expiresAt, notified }]
const userKeys = new Map();

// userId -> extraSlots (granted by !ukey)
const userKeySlots = new Map();

// keyRights log: [{ grantedTo, grantedBy, slots, timestamp }]
const keyRightsLog = [];

function footer() {
  return `AevumDevs  •  ${new Date().toLocaleString('en-US', { weekday: 'long', hour: '2-digit', minute: '2-digit' })}`;
}

async function sendKeyLog(embed) {
  if (!keyLogChannelId) return;
  const ch = client.channels.cache.get(keyLogChannelId);
  if (ch) ch.send({ embeds: [embed] }).catch(() => {});
}

async function sendKeyRightsLog(embed) {
  if (!keyRightsChannelId) return;
  const ch = client.channels.cache.get(keyRightsChannelId);
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

function getMaxKeys(userId) {
  return MAX_KEYS_PER_USER + (userKeySlots.get(userId) || 0);
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
              { name: 'Key',        value: `\`${k.key}\``,                    inline: false },
              { name: 'User',       value: `${user.tag} (${userId})`,          inline: true  },
              { name: 'Expired At', value: new Date().toLocaleString('en-US'), inline: true  }
            )
            .setFooter({ text: footer() });
          await sendKeyLog(expireEmbed);
        } catch {}
      }
    }
    userKeys.set(userId, keys.filter(k => k.expiresAt > now));
  }

  if (changed) await pushKeysToGitHub().catch(() => {});
}, 60 * 1000);

// ─── PARSE DURATION ──────────────────────────────────────────────────────────
function parseDuration(str) {
  const match = str.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return null;
  const n = parseInt(match[1]);
  const unit = match[2];
  const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return n * multipliers[unit];
}

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
    .setFooter({ text: footer() });

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
    .setFooter({ text: footer() });

  logChannel.send({ embeds: [embed] });
});

// ─── COMMANDS ─────────────────────────────────────────────────────────────────
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const args    = message.content.trim().split(/\s+/);
  const command = args[0].toLowerCase();

  // ─── !ban ────────────────────────────────────────────────────────────────
  if (command === '!ban') {
    if (!message.member.permissions.has(PermissionFlagsBits.BanMembers))
      return message.reply('You do not have permission to use this command.');

    const target = message.mentions.members.first();
    if (!target) return message.reply('Please mention a valid member.');
    const reason = args.slice(2).join(' ') || 'No reason provided.';

    try {
      await target.send(
        `You have been **banned** from **${message.guild.name}**.\nReason: ${reason}`
      ).catch(() => {});
      await target.ban({ reason });

      const embed = new EmbedBuilder()
        .setColor(COLOR.red)
        .setTitle('Member Banned')
        .addFields(
          { name: 'User',   value: `${target.user.tag} (${target.id})`, inline: true },
          { name: 'Mod',    value: `${message.author.tag}`,              inline: true },
          { name: 'Reason', value: reason,                               inline: false }
        )
        .setFooter({ text: footer() });

      await message.channel.send({ embeds: [embed] });
      await message.delete().catch(() => {});
    } catch (err) {
      message.reply(`Failed to ban: ${err.message}`);
    }
  }

  // ─── !unban ──────────────────────────────────────────────────────────────
  if (command === '!unban') {
    if (!message.member.permissions.has(PermissionFlagsBits.BanMembers))
      return message.reply('You do not have permission to use this command.');

    const userId = args[1];
    if (!userId) return message.reply('Please provide a user ID.');

    try {
      const banned = await message.guild.bans.fetch(userId).catch(() => null);
      if (!banned) return message.reply('That user is not banned.');

      await message.guild.members.unban(userId);

      const embed = new EmbedBuilder()
        .setColor(COLOR.white)
        .setTitle('Member Unbanned')
        .addFields(
          { name: 'User ID', value: userId,              inline: true },
          { name: 'Mod',     value: message.author.tag,  inline: true }
        )
        .setFooter({ text: footer() });

      await message.channel.send({ embeds: [embed] });
      await message.delete().catch(() => {});
    } catch (err) {
      message.reply(`Failed to unban: ${err.message}`);
    }
  }

  // ─── !kick ───────────────────────────────────────────────────────────────
  if (command === '!kick') {
    if (!message.member.permissions.has(PermissionFlagsBits.KickMembers))
      return message.reply('You do not have permission to use this command.');

    const target = message.mentions.members.first();
    if (!target) return message.reply('Please mention a valid member.');
    const reason = args.slice(2).join(' ') || 'No reason provided.';

    try {
      await target.send(
        `You have been **kicked** from **${message.guild.name}**.\nReason: ${reason}`
      ).catch(() => {});
      await target.kick(reason);

      const embed = new EmbedBuilder()
        .setColor(COLOR.yellow)
        .setTitle('Member Kicked')
        .addFields(
          { name: 'User',   value: `${target.user.tag} (${target.id})`, inline: true },
          { name: 'Mod',    value: `${message.author.tag}`,              inline: true },
          { name: 'Reason', value: reason,                               inline: false }
        )
        .setFooter({ text: footer() });

      await message.channel.send({ embeds: [embed] });
      await message.delete().catch(() => {});
    } catch (err) {
      message.reply(`Failed to kick: ${err.message}`);
    }
  }

  // ─── !timeout <duration> @user ───────────────────────────────────────────
  if (command === '!timeout') {
    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers))
      return message.reply('You do not have permission to use this command.');

    const durationStr = args[1];
    const target      = message.mentions.members.first();

    if (!durationStr || !target)
      return message.reply('Usage: `!timeout <duration> @user`  (e.g. `!timeout 10m @user`)');

    const ms = parseDuration(durationStr);
    if (!ms) return message.reply('Invalid duration. Use format: `10s`, `5m`, `2h`, `1d`.');

    try {
      await target.timeout(ms);

      await target.send(
        `You have been **timed out** in **${message.guild.name}** for **${durationStr}**.`
      ).catch(() => {});

      const embed = new EmbedBuilder()
        .setColor(COLOR.yellow)
        .setTitle('Member Timed Out')
        .addFields(
          { name: 'User',     value: `${target.user.tag} (${target.id})`, inline: true  },
          { name: 'Mod',      value: `${message.author.tag}`,              inline: true  },
          { name: 'Duration', value: durationStr,                          inline: false }
        )
        .setFooter({ text: footer() });

      await message.channel.send({ embeds: [embed] });
      await message.delete().catch(() => {});
    } catch (err) {
      message.reply(`Failed to timeout: ${err.message}`);
    }
  }

  // ─── !untimeout @user ─────────────────────────────────────────────────────
  if (command === '!untimeout') {
    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers))
      return message.reply('You do not have permission to use this command.');

    const target = message.mentions.members.first();
    if (!target) return message.reply('Please mention a valid member.');

    try {
      await target.timeout(null);

      await target.send(
        `Your timeout in **${message.guild.name}** has been removed.`
      ).catch(() => {});

      const embed = new EmbedBuilder()
        .setColor(COLOR.white)
        .setTitle('Timeout Removed')
        .addFields(
          { name: 'User', value: `${target.user.tag} (${target.id})`, inline: true },
          { name: 'Mod',  value: `${message.author.tag}`,              inline: true }
        )
        .setFooter({ text: footer() });

      await message.channel.send({ embeds: [embed] });
      await message.delete().catch(() => {});
    } catch (err) {
      message.reply(`Failed to remove timeout: ${err.message}`);
    }
  }

  // ─── !del <amount> ────────────────────────────────────────────────────────
  if (command === '!del') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages))
      return message.reply('You do not have permission to use this command.');

    const amount = parseInt(args[1]);
    if (isNaN(amount) || amount < 1 || amount > 100)
      return message.reply('Please provide a number between 1 and 100.');

    try {
      await message.delete().catch(() => {});
      const deleted = await message.channel.bulkDelete(amount, true);

      const confirm = await message.channel.send(
        `Deleted **${deleted.size}** message(s).`
      );
      setTimeout(() => confirm.delete().catch(() => {}), 4000);
    } catch (err) {
      message.channel.send(`Failed to delete messages: ${err.message}`);
    }
  }

  // ─── !userinfo @user ──────────────────────────────────────────────────────
  if (command === '!userinfo') {
    const target = message.mentions.members.first() || message.member;
    const user   = target.user;

    const roles = target.roles.cache
      .filter(r => r.id !== message.guild.id)
      .map(r => `<@&${r.id}>`)
      .join(', ') || 'None';

    const embed = new EmbedBuilder()
      .setColor(COLOR.white)
      .setTitle('User Info')
      .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 128 }))
      .addFields(
        { name: 'Username',   value: user.tag,                                               inline: true  },
        { name: 'ID',         value: user.id,                                                inline: true  },
        { name: 'Nickname',   value: target.nickname || 'None',                              inline: true  },
        { name: 'Joined Server', value: `<t:${Math.floor(target.joinedTimestamp / 1000)}:R>`, inline: true  },
        { name: 'Joined Discord', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true  },
        { name: 'Roles',      value: roles,                                                  inline: false }
      )
      .setFooter({ text: footer() });

    await message.reply({ embeds: [embed] });
  }

  // ─── !serverinfo ──────────────────────────────────────────────────────────
  if (command === '!serverinfo') {
    const guild = message.guild;
    await guild.members.fetch().catch(() => {});

    const totalMembers  = guild.memberCount;
    const humanMembers  = guild.members.cache.filter(m => !m.user.bot).size;
    const botMembers    = guild.members.cache.filter(m => m.user.bot).size;
    const textChannels  = guild.channels.cache.filter(c => c.type === 0).size;
    const voiceChannels = guild.channels.cache.filter(c => c.type === 2).size;
    const roleCount     = guild.roles.cache.size - 1;

    const embed = new EmbedBuilder()
      .setColor(COLOR.white)
      .setTitle('Server Info')
      .setThumbnail(guild.iconURL({ dynamic: true, size: 128 }))
      .addFields(
        { name: 'Server',        value: guild.name,                                         inline: true  },
        { name: 'Owner',         value: `<@${guild.ownerId}>`,                              inline: true  },
        { name: 'Created',       value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true },
        { name: 'Members',       value: `${totalMembers} (${humanMembers} users, ${botMembers} bots)`, inline: false },
        { name: 'Channels',      value: `${textChannels} text / ${voiceChannels} voice`,    inline: true  },
        { name: 'Roles',         value: `${roleCount}`,                                     inline: true  },
        { name: 'Boost Level',   value: `${guild.premiumTier}`,                             inline: true  },
        { name: 'Boosts',        value: `${guild.premiumSubscriptionCount}`,                inline: true  }
      )
      .setFooter({ text: footer() });

    await message.reply({ embeds: [embed] });
  }

  // ─── !ukey <amount> @user ────────────────────────────────────────────────
  if (command === '!ukey') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild))
      return message.reply('You do not have permission to use this command.');

    const amount = parseInt(args[1]);
    const target = message.mentions.members.first();

    if (isNaN(amount) || amount < 1 || !target)
      return message.reply('Usage: `!ukey <amount> @user`');

    const prev = userKeySlots.get(target.id) || 0;
    userKeySlots.set(target.id, prev + amount);

    keyRightsLog.push({
      grantedTo:  target.id,
      grantedBy:  message.author.id,
      slots:      amount,
      timestamp:  Date.now(),
    });

    const embed = new EmbedBuilder()
      .setColor(COLOR.white)
      .setTitle('Key Rights Granted')
      .addFields(
        { name: 'Granted To', value: `${target.user.tag} (${target.id})`,    inline: true  },
        { name: 'Granted By', value: `${message.author.tag}`,                 inline: true  },
        { name: 'Slots Added', value: `${amount}`,                            inline: true  },
        { name: 'Total Slots', value: `${getMaxKeys(target.id)}`,             inline: true  }
      )
      .setFooter({ text: footer() });

    await sendKeyRightsLog(embed);

    // DM both parties
    await target.send(
      `You have been granted **${amount}** additional key slot(s) by **${message.author.tag}**.\nYou can now generate up to **${getMaxKeys(target.id)}** keys.`
    ).catch(() => {});

    await message.reply({ embeds: [embed] });
    await message.delete().catch(() => {});
  }

  // ─── !keyrights ───────────────────────────────────────────────────────────
  if (command === '!keyrights') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild))
      return message.reply('You do not have permission to use this command.');

    keyRightsChannelId = message.channel.id;

    if (keyRightsLog.length === 0) {
      await message.reply(`Key rights log channel set to <#${message.channel.id}>. No entries yet.`);
      await message.delete().catch(() => {});
      return;
    }

    const lines = keyRightsLog.map(e => {
      const ts = `<t:${Math.floor(e.timestamp / 1000)}:R>`;
      return `<@${e.grantedTo}> — **+${e.slots}** slots — by <@${e.grantedBy}> — ${ts}`;
    }).join('\n');

    const embed = new EmbedBuilder()
      .setColor(COLOR.white)
      .setTitle('Key Rights Log')
      .setDescription(lines.length > 4096 ? lines.slice(0, 4090) + '...' : lines)
      .setFooter({ text: footer() });

    await message.channel.send({ embeds: [embed] });
    await message.delete().catch(() => {});
  }

  // ─── !delallkey @user ─────────────────────────────────────────────────────
  if (command === '!delallkey') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild))
      return message.reply('You do not have permission to use this command.');

    const target = message.mentions.members.first();
    if (!target) return message.reply('Please mention a valid member.');

    const keys = getUserKeys(target.id);
    const count = keys.length;
    userKeys.set(target.id, []);

    await pushKeysToGitHub().catch(() => {});

    const embed = new EmbedBuilder()
      .setColor(COLOR.red)
      .setTitle('All Keys Deleted')
      .addFields(
        { name: 'User',    value: `${target.user.tag} (${target.id})`, inline: true },
        { name: 'Deleted', value: `${count} key(s)`,                   inline: true },
        { name: 'Mod',     value: `${message.author.tag}`,              inline: true }
      )
      .setFooter({ text: footer() });

    await sendKeyLog(embed);
    await message.reply({ embeds: [embed] });
    await message.delete().catch(() => {});
  }

  // ─── !delkey <KEY> ────────────────────────────────────────────────────────
  if (command === '!delkey') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild))
      return message.reply('You do not have permission to use this command.');

    const keyArg = args[1];
    if (!keyArg) return message.reply('Usage: `!delkey <KEY>`');

    let found = false;
    let ownerTag = 'Unknown';

    for (const [userId, keys] of userKeys.entries()) {
      const idx = keys.findIndex(k => k.key === keyArg);
      if (idx !== -1) {
        keys.splice(idx, 1);
        found = true;
        try {
          const u = await client.users.fetch(userId);
          ownerTag = u.tag;
        } catch {}
        break;
      }
    }

    if (!found) return message.reply('Key not found.');

    await pushKeysToGitHub().catch(() => {});

    const embed = new EmbedBuilder()
      .setColor(COLOR.red)
      .setTitle('Key Deleted')
      .addFields(
        { name: 'Key',   value: `\`${keyArg}\``,   inline: false },
        { name: 'Owner', value: ownerTag,            inline: true  },
        { name: 'Mod',   value: message.author.tag,  inline: true  }
      )
      .setFooter({ text: footer() });

    await sendKeyLog(embed);
    await message.reply({ embeds: [embed] });
    await message.delete().catch(() => {});
  }

  // ─── !ping ────────────────────────────────────────────────────────────────
  if (command === '!ping') {
    const sent = await message.reply('Pinging...');
    const latency = sent.createdTimestamp - message.createdTimestamp;
    const wsLatency = client.ws.ping;

    const embed = new EmbedBuilder()
      .setColor(COLOR.white)
      .setTitle('Pong')
      .addFields(
        { name: 'Roundtrip', value: `${latency}ms`,   inline: true },
        { name: 'WebSocket', value: `${wsLatency}ms`, inline: true }
      )
      .setFooter({ text: footer() });

    await sent.edit({ content: null, embeds: [embed] });
  }

  // ─── !avatar @user ────────────────────────────────────────────────────────
  if (command === '!avatar') {
    const target = message.mentions.users.first() || message.author;
    const url    = target.displayAvatarURL({ dynamic: true, size: 1024 });

    const embed = new EmbedBuilder()
      .setColor(COLOR.white)
      .setTitle(`${target.username}'s Avatar`)
      .setImage(url)
      .setFooter({ text: footer() });

    await message.reply({ embeds: [embed] });
  }

  // ─── !getmember ───────────────────────────────────────────────────────────
  if (command === '!getmember') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageRoles))
      return message.reply('You do not have permission to use this command.');

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

  // ─── !joins ───────────────────────────────────────────────────────────────
  if (command === '!joins') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild))
      return message.reply('You do not have permission to use this command.');

    joinLogChannelId = message.channel.id;
    const reply = await message.reply(`Join/Leave logs will now be sent to: <#${message.channel.id}>`);
    await message.delete().catch(() => {});
    setTimeout(() => reply.delete().catch(() => {}), 5000);
  }

  // ─── !keylog ──────────────────────────────────────────────────────────────
  if (command === '!keylog') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild))
      return message.reply('You do not have permission to use this command.');

    keyLogChannelId = message.channel.id;
    const reply = await message.reply(`Key logs will now be sent to: <#${message.channel.id}>`);
    await message.delete().catch(() => {});
    setTimeout(() => reply.delete().catch(() => {}), 5000);
  }

  // ─── !keypanel ────────────────────────────────────────────────────────────
  if (command === '!keypanel') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild))
      return message.reply('You do not have permission to use this command.');

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

  // ─── !mykey ───────────────────────────────────────────────────────────────
  if (command === '!mykey') {
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

  // ─── !cmd ─────────────────────────────────────────────────────────────────
  if (command === '!cmd') {
    const embed = new EmbedBuilder()
      .setColor(COLOR.white)
      .setTitle('Commands')
      .addFields(
        {
          name: 'Moderation',
          value:
            '`!ban @user [reason]` — Ban a member\n' +
            '`!unban <id>` — Unban a user by ID\n' +
            '`!kick @user [reason]` — Kick a member\n' +
            '`!timeout <duration> @user` — Timeout a member  (e.g. `10m`, `2h`)\n' +
            '`!untimeout @user` — Remove timeout\n' +
            '`!del <amount>` — Bulk delete messages (1-100)',
          inline: false,
        },
        {
          name: 'Info',
          value:
            '`!userinfo [@user]` — Show user info\n' +
            '`!serverinfo` — Show server info\n' +
            '`!avatar [@user]` — Show avatar\n' +
            '`!ping` — Show bot latency',
          inline: false,
        },
        {
          name: 'Key System',
          value:
            '`!keypanel` — Post key panel  *(staff)*\n' +
            '`!keylog` — Set key log channel  *(staff)*\n' +
            '`!mykey` — View your active keys via DM\n' +
            '`!ukey <amount> @user` — Grant key slots  *(staff)*\n' +
            '`!keyrights` — Set key rights log channel & view log  *(staff)*\n' +
            '`!delallkey @user` — Delete all keys of a user  *(staff)*\n' +
            '`!delkey <KEY>` — Delete a specific key  *(staff)*',
          inline: false,
        },
        {
          name: 'Server',
          value:
            '`!getmember` — Post member role button  *(staff)*\n' +
            '`!joins` — Set join/leave log channel  *(staff)*',
          inline: false,
        }
      )
      .setFooter({ text: footer() });

    await message.reply({ embeds: [embed] });
  }
});

// ─── INTERACTIONS ─────────────────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  // get_member
  if (interaction.customId === 'get_member') {
    const role = interaction.guild.roles.cache.get(MEMBER_ROLE_ID);
    if (!role)
      return interaction.reply({ content: 'Member role not found. Contact an administrator.', ephemeral: true });

    if (interaction.member.roles.cache.has(MEMBER_ROLE_ID))
      return interaction.reply({ content: 'You already have the member role.', ephemeral: true });

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

    const active  = getActiveKeys(interaction.user.id);
    const maxKeys = getMaxKeys(interaction.user.id);

    if (active.length >= maxKeys) {
      return interaction.reply({
        content: `You already have ${maxKeys} active keys. Wait for one to expire.`,
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const key       = generateKey();
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
        { name: 'Key',      value: `\`${key}\``,                                   inline: false },
        { name: 'Type',     value: 'Universal',                                    inline: true  },
        { name: 'User',     value: `${interaction.user.tag} (${interaction.user.id})`, inline: true },
        { name: 'Duration', value: '10 hours',                                     inline: true  },
        { name: 'Expires',  value: expiresDate,                                    inline: false }
      )
      .setFooter({ text: footer() });

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
