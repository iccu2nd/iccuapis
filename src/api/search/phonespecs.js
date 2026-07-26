'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const cache = require('../../cache');

const TTL_MS = 30 * 60 * 1000;
const HEADERS = { 'User-Agent': 'Mozilla/5.0' };

async function request(url) {
  const { data } = await axios.get(url, { headers: HEADERS, timeout: 15000 });
  return data;
}

async function searchPhones(keyword) {
  const html = await request(`https://carisinyal.com/?s=${encodeURIComponent(keyword)}`);
  const $ = cheerio.load(html);
  const result = [];

  $('.oxy-post').each((_, el) => {
    const title = $(el).find('.oxy-post-title').text().trim();
    if (!title) return;
    result.push({
      title,
      type: $(el).find('.oxy-post-meta').text().trim(),
      url: $(el).find('.oxy-post-title').attr('href')
    });
  });

  return result;
}

async function getPhoneDetail(url) {
  const html = await request(url);
  const $ = cheerio.load(html);
  const specs = {};

  $('table.box-info tr.box-baris').each((_, el) => {
    const key = $(el).find('td.kolom-satu').text().trim();
    const value = $(el).find('td.kolom-dua').text().trim();
    if (key && value) specs[key] = value;
  });

  const get = (...keys) => {
    for (const key of keys) if (specs[key]) return specs[key];
    return null;
  };

  return {
    title: $('h1').first().text().trim(),
    image: $('meta[property="og:image"]').attr('content') || null,
    description: $('meta[name="description"]').attr('content') || '',
    release: get('Rilis'),
    network: get('Jaringan'),
    display: {
      type: get('Jenis'),
      size: get('Ukuran'),
      resolution: get('Resolusi'),
      refreshRate: get('Refresh Rate'),
      ratio: get('Rasio'),
      density: get('Kerapatan'),
      protection: get('Proteksi')
    },
    performance: {
      chipset: get('Chipset'),
      cpu: get('CPU'),
      gpu: get('GPU'),
      ram: get('RAM'),
      ramType: get('Jenis RAM'),
      storage: get('Memori Internal'),
      storageType: get('Jenis Memori'),
      external: get('Memori Eksternal')
    },
    battery: {
      capacity: get('Kapasitas'),
      charging: get('Daya Pengisian'),
      wireless: get('Wireless Charging'),
      reverse: get('Reverse Charging'),
      reverseWireless: get('Reverse Wireless Charging'),
      bypass: get('Bypass Charging')
    },
    camera: {
      total: get('Jumlah Kamera'),
      configuration: get('Konfigurasi'),
      features: get('Fitur'),
      video: get('Resolusi Video')
    },
    connectivity: {
      wlan: get('WLAN'),
      bluetooth: get('Bluetooth'),
      infrared: get('Infrared'),
      nfc: get('NFC'),
      gps: get('GPS'),
      usb: get('USB')
    },
    system: {
      os: get('OS (Saat Rilis)'),
      update: get('Jaminan Update')
    },
    body: {
      dimensions: get('Dimensi'),
      weight: get('Berat'),
      resistance: get('Ketahanan'),
      sim: get('SIM Card'),
      esim: get('eSIM'),
      colors: get('Warna')
    },
    sensors: get('Sensor'),
    audio: {
      jack: get('Jack 3.5mm'),
      features: get('Fitur Lainnya')
    },
    specs
  };
}

module.exports = function register(app, registry) {
  const route = {
    method: 'GET',
    path: '/search/phone-specs',
    group: 'search',
    name: 'Phone Specs Search',
    description: 'Cari spesifikasi lengkap HP berdasarkan nama, data diambil dari Carisinyal.',
    params: [{ key: 'q', required: true, hint: 'nama HP yang dicari', example: 'oppo a3s' }]
  };
  registry.push(route);

  app.get(route.path, async (req, res) => {
    const { q } = req.query;
    if (!q || !q.trim()) {
      return res.status(400).json({
        ok: false,
        error: { code: 'MISSING_PARAM', message: 'Parameter "q" wajib diisi.' }
      });
    }

    try {
      const cacheKey = `phone-specs:${q.trim().toLowerCase()}`;
      const result = await cache.wrap(cacheKey, TTL_MS, async () => {
        const results = await searchPhones(q.trim());
        const phone = results.find((r) => (r.type || '').toLowerCase().includes('ponsel')) || results[0];
        if (!phone) return null;
        return getPhoneDetail(phone.url);
      });

      if (!result) {
        return res.status(404).json({
          ok: false,
          error: { code: 'NOT_FOUND', message: `HP tidak ditemukan untuk: ${q.trim()}` }
        });
      }

      res.json({ result });
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: { code: 'UPSTREAM_ERROR', message: err.message || 'Gagal mengambil data spesifikasi HP.' }
      });
    }
  });
};
