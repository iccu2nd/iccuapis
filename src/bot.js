'use strict';

const TelegramBot = require('node-telegram-bot-api');
const monitor = require('./monitor');
const { getDb } = require('./mongoClient');
const { ObjectId } = require('mongodb');

let botInstance = null;
let configInstance = null;

function startBot(config) {
  const token = config.telegram?.token;
  const ownerIds = config.telegram?.ownerIds || [];

  if (!token || token === 'PASTE_BOT_TOKEN_HERE') {
    console.log('[bot] Telegram token not set in src/config.js, skipping bot startup');
    return null;
  }

  configInstance = config;
  botInstance = new TelegramBot(token, { polling: true });

  const mainMenu = {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📊 Statistik Request', callback_data: 'stats' }],
        [{ text: '📋 Log Terbaru', callback_data: 'logs' }],
        [{ text: '🔝 IP Teratas', callback_data: 'top_ips' }],
        [{ text: '🚫 Daftar IP Diblokir', callback_data: 'list_blocked' }],
        [{ text: '🔒 Blokir IP', callback_data: 'block_prompt' }],
        [{ text: '🔓 Buka Blokir IP', callback_data: 'unblock_prompt' }]
      ]
    }
  };

  function isOwner(msg) {
    if (!ownerIds.length) return true;
    return ownerIds.includes(String(msg.chat.id));
  }

  function deny(chatId) {
    botInstance.sendMessage(chatId, '❌ Kamu tidak punya akses ke bot ini.');
  }

  botInstance.onText(/\/start|\/menu/, (msg) => {
    if (!isOwner(msg)) return deny(msg.chat.id);
    botInstance.sendMessage(
      msg.chat.id,
      `🤖 ${config.identity.name} Monitor\nPilih menu di bawah:`,
      mainMenu
    );
  });

  botInstance.onText(/\/block (.+)/, async (msg, match) => {
    if (!isOwner(msg)) return deny(msg.chat.id);
    const value = match[1].trim();
    try {
      await monitor.blockIp(value);
      const isSubnet = value.includes('/');
      botInstance.sendMessage(
        msg.chat.id,
        isSubnet
          ? `✅ Subnet \`${value}\` sudah diblokir. Semua IP di rentang ini akan ditolak.`
          : `✅ IP \`${value}\` sudah diblokir.`,
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      botInstance.sendMessage(msg.chat.id, `❌ Gagal blokir: ${err.message}`);
    }
  });

  botInstance.onText(/\/unblock (.+)/, async (msg, match) => {
    if (!isOwner(msg)) return deny(msg.chat.id);
    const value = match[1].trim();
    const removed = await monitor.unblockIp(value);
    botInstance.sendMessage(
      msg.chat.id,
      removed ? `✅ \`${value}\` sudah dibuka blokirnya.` : `❌ \`${value}\` tidak ada di daftar blokir.`,
      { parse_mode: 'Markdown' }
    );
  });

  botInstance.onText(/\/addnotif(?:\s+([\s\S]+))?/, async (msg, match) => {
    if (!isOwner(msg)) return deny(msg.chat.id);
    const text = match[1] ? match[1].trim() : '';
    if (!text) {
      botInstance.sendMessage(msg.chat.id, '⚠️ Format salah.\nContoh: `/addnotif Server maintenance jam 22.00 - 23.00`', { parse_mode: 'Markdown' });
      return;
    }

    const db = await getDb();
    if (!db) {
      botInstance.sendMessage(msg.chat.id, '❌ MongoDB tidak terhubung, notif tidak tersimpan.');
      return;
    }

    const result = await db.collection('notifications').insertOne({ text, createdAt: new Date() });
    botInstance.sendMessage(msg.chat.id, `✅ Notif #${result.insertedId} ditambahkan ke website.`);
  });

  botInstance.onText(/\/delnotif(?:\s+(\S+))?/, async (msg, match) => {
    if (!isOwner(msg)) return deny(msg.chat.id);
    const id = match[1];
    const db = await getDb();
    if (!db) {
      botInstance.sendMessage(msg.chat.id, '❌ MongoDB tidak terhubung.');
      return;
    }

    if (!id) {
      const list = await db.collection('notifications').find().sort({ createdAt: -1 }).limit(10).toArray();
      if (!list.length) {
        botInstance.sendMessage(msg.chat.id, '📭 Belum ada notif tersimpan.');
        return;
      }
      const lines = list.map((n) => `#${n._id}  ${n.text.slice(0, 40)}`).join('\n');
      botInstance.sendMessage(msg.chat.id, `📋 Notif tersimpan (pakai /delnotif <id>):\n${lines}`);
      return;
    }

    try {
      const result = await db.collection('notifications').deleteOne({ _id: new ObjectId(id) });
      botInstance.sendMessage(msg.chat.id, result.deletedCount ? `✅ Notif #${id} dihapus.` : `❌ Notif #${id} tidak ditemukan.`);
    } catch (err) {
      botInstance.sendMessage(msg.chat.id, `❌ ID tidak valid.`);
    }
  });

  botInstance.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    if (!isOwner({ chat: { id: chatId } })) {
      await botInstance.answerCallbackQuery(query.id);
      return deny(chatId);
    }

    const data = query.data;

    if (data && data.startsWith('block_')) {
      const ip = data.replace('block_', '');
      await monitor.blockIp(ip);
      await botInstance.answerCallbackQuery(query.id, { text: `✅ IP ${ip} diblokir!` });
      botInstance.sendMessage(chatId, `✅ IP \`${ip}\` berhasil diblokir.`, { parse_mode: 'Markdown' });
      return;
    }

    switch (data) {
      case 'stats': {
        const total = monitor.totalRequests();
        const top = monitor.topEndpoints(5);
        const lines = top.map((r) => `${r.count}x  ${r.path}`).join('\n') || 'Belum ada data.';
        botInstance.sendMessage(chatId, `📊 Total request tercatat: ${total}\n\n🔝 Top endpoint:\n${lines}`);
        break;
      }
      case 'logs': {
        const recent = monitor.recentLog(15);
        if (!recent.length) {
          botInstance.sendMessage(chatId, '📭 Belum ada request tercatat.');
          break;
        }
        const lines = recent
          .map((r) => `${r.status} ${escapeMarkdown(r.method)} ${escapeMarkdown(r.path)} (${r.ms}ms) — \`${r.ip}\``)
          .join('\n');
        botInstance.sendMessage(chatId, `📋 Log 15 request terakhir:\n${lines}`, { parse_mode: 'Markdown' });
        break;
      }
      case 'top_ips': {
        const top = monitor.topIps(10);
        if (!top.length) {
          botInstance.sendMessage(chatId, '📭 Belum ada data IP.');
          break;
        }
        const lines = top
          .map((r) => `${r.count}x  \`${r.ip}\`${r.blocked ? ' 🚫' : ''}`)
          .join('\n');
        botInstance.sendMessage(chatId, `🔝 IP teratas:\n${lines}`, { parse_mode: 'Markdown' });
        break;
      }
      case 'list_blocked': {
        const blocked = monitor.listBlocked();
        const lines = blocked.map((ip) => `\`${ip}\``).join('\n');
        botInstance.sendMessage(
          chatId,
          blocked.length ? `🚫 IP yang diblokir:\n${lines}` : '✅ Belum ada IP yang diblokir.',
          blocked.length ? { parse_mode: 'Markdown' } : undefined
        );
        break;
      }
      case 'block_prompt': {
        botInstance.sendMessage(chatId, '🔒 Kirim perintah:\n/block 1.2.3.4  (satu IP)\n/block 1.2.3.0/24  (satu subnet, semua IP di rentang ini ikut terblokir)');
        break;
      }
      case 'unblock_prompt': {
        botInstance.sendMessage(chatId, '🔓 Kirim perintah:\n/unblock 1.2.3.4\n/unblock 1.2.3.0/24');
        break;
      }
      default:
        break;
    }

    await botInstance.answerCallbackQuery(query.id);
  });

  botInstance.on('polling_error', (err) => {
    console.error('[bot] polling error:', err.message);
  });

  console.log('[bot] Telegram bot started');
  return botInstance;
}

function escapeMarkdown(value) {
  return String(value).replace(/([_*`\[])/g, '\\$1');
}

function sendNotification(ip, method, path, status, ms, userAgent, query) {
  if (!botInstance || !configInstance) return;

  const ownerIds = configInstance.telegram?.ownerIds || [];
  if (!ownerIds.length) return;

  const statusLabel = status >= 200 && status < 300 ? 'OK' : 'GAGAL';
  const paramsEntries = query && typeof query === 'object' ? Object.entries(query) : [];
  const paramsLine = paramsEntries.length
    ? paramsEntries.map(([k, v]) => `${k}=${v}`).join('&')
    : '(tidak ada)';

  const message = `
Request Masuk

IP        : \`${ip}\`
Method    : ${escapeMarkdown(method)}
Path      : ${escapeMarkdown(path)}
Params    : ${escapeMarkdown(paramsLine)}
Status    : ${status} (${statusLabel})
Durasi    : ${ms}ms
Waktu     : ${new Date().toISOString()}
User Agent: ${escapeMarkdown(userAgent || 'Tidak diketahui')}
  `;

  const inlineKeyboard = {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: `Block IP: ${ip}`, callback_data: `block_${ip}` }],
        [{ text: 'Lihat Statistik', callback_data: 'stats' }]
      ]
    }
  };

  ownerIds.forEach(ownerId => {
    botInstance.sendMessage(ownerId, message.trim(), {
      ...inlineKeyboard
    }).catch(err => console.error('[bot] Failed to send notification:', err.message));
  });
}

function sendErrorAlert(context) {
  if (!botInstance || !configInstance) return;

  const ownerIds = configInstance.telegram?.ownerIds || [];
  if (!ownerIds.length) return;

  const { endpoint, message, extra } = context;
  const text = `
⚠️ Error di Endpoint

Endpoint : ${escapeMarkdown(endpoint)}
Error    : ${escapeMarkdown(message)}
${extra ? `Detail   : ${escapeMarkdown(extra)}\n` : ''}Waktu    : ${new Date().toISOString()}
  `;

  ownerIds.forEach((ownerId) => {
    botInstance.sendMessage(ownerId, text.trim(), { parse_mode: 'Markdown' })
      .catch((err) => console.error('[bot] Failed to send error alert:', err.message));
  });
}

module.exports = { startBot, sendNotification, sendErrorAlert };