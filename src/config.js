'use strict';

module.exports = {
  identity: {
    name: 'Sasane APIS',
    creator: 'reyzdesu',
    tagline: 'Rest API simple, free, dan 100% lebih lengkap.',
    version: '1.0.0'
  },
  // Grup endpoint sekarang otomatis dibaca dari nama folder di src/api/**
  // (lihat server.js). Tidak perlu didaftarkan manual di sini lagi — cukup
  // tambah folder baru di src/api/ dan grup baru langsung muncul.
  links: {
    // Ganti dengan link saluran WhatsApp kamu, contoh:
    // 'https://whatsapp.com/channel/0029VaXXXXXXXXXXXXXXXX'
    whatsappChannel: 'https://whatsapp.com/channel/0029VbC7SGt65yDCUxYwUS3U',
    // Ganti dengan link kontak owner (WA pribadi, contoh: 'https://wa.me/62812xxxxxxx')
    ownerContact: 'https://wa.me/qr/YXGCZD45ECBJJ1'
  },
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || '',
    ownerIds: (process.env.TELEGRAM_OWNER_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }
};