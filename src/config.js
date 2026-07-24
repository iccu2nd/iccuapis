'use strict';

module.exports = {
  identity: {
    name: 'Sasane APIS',
    creator: 'reyzdesu',
    tagline: 'Rest API simple, free, dan 100% lebih lengkap.',
    version: '1.0.0'
  },
  links: {
    whatsappChannel: 'https://whatsapp.com/channel/0029VbC7SGt65yDCUxYwUS3U',
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