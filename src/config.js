'use strict';

module.exports = {
  identity: {
    name: 'ICCU APIS',
    creator: 'reisange',
    tagline: 'Rest API simple, free, dan 100% lebih lengkap.',
    version: '1.0.0'
  },
  groups: {
    ai: { label: 'AI', order: 1, icon: 'ai' },
    search: { label: 'Search', order: 2, icon: 'search' },
    image: { label: 'Image', order: 3, icon: 'image' },
    stalk: { label: 'Stalk', order: 4, icon: 'stalk' },
    download: { label: 'Downloader', order: 5, icon: 'download' },
    tools: { label: 'Tools', order: 6, icon: 'tools' }
  },
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || '',
    ownerIds: (process.env.TELEGRAM_OWNER_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }
};