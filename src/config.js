'use strict';

module.exports = {
  identity: {
    name: 'Sasane APIS',
    creator: 'reisange',
    tagline: 'Rest API simple, free, dan 100% lebih lengkap.',
    version: '1.0.0'
  },
  // Grup endpoint sekarang otomatis dibaca dari nama folder di src/api/**
  // (lihat server.js). Tidak perlu didaftarkan manual di sini lagi — cukup
  // tambah folder baru di src/api/ dan grup baru langsung muncul.
  links: {
    // Ganti dengan link saluran WhatsApp kamu, contoh:
    // 'https://whatsapp.com/channel/0029VaXXXXXXXXXXXXXXXX'
    whatsappChannel: process.env.WHATSAPP_CHANNEL_URL || ''
  },
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || '',
    ownerIds: (process.env.TELEGRAM_OWNER_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }
};