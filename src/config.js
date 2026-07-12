'use strict';

module.exports = {
  identity: {
    name: 'ICCU APIS',
    creator: 'reisange',
    tagline: 'Rest API simple, free, dan 100% lebih lengkap.',
    version: '1.0.0'
  },
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || '',
    ownerIds: (process.env.TELEGRAM_OWNER_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }
};