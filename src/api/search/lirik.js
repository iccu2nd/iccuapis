'use strict';

const axios = require('axios');
const cache = require('../../cache');

const CACHE_TTL_MS = 3600000;

module.exports = function register(app, registry) {
  const route = {
    method: 'GET',
    path: '/tools/lyrics',
    group: 'tools',
    name: 'Lyrics Finder',
    description: 'Cari lirik lagu berdasarkan judul. Response cepat dengan cache.',
    params: [
      {
        key: 'q',
        required: true,
        hint: 'Judul lagu',
        example: 'nina feast'
      }
    ]
  };
  registry.push(route);

  app.get(route.path, async (req, res) => {
    const { q } = req.query;

    if (!q || !q.trim()) {
      return res.status(400).json({
        ok: false,
        error: { code: 'MISSING_PARAM', message: 'Parameter "q" wajib diisi' }
      });
    }

    const startTime = Date.now();

    try {
      const cacheKey = `lyrics:${q.trim().toLowerCase()}`;
      const cached = cache.get(cacheKey);

      if (cached) {
        return res.json({
          result: {
            ...cached,
            cached: true,
            responseTime: `${Date.now() - startTime}ms`
          }
        });
      }

      const data = await fetchLyrics(q.trim());

      cache.set(cacheKey, data, CACHE_TTL_MS);

      res.json({
        result: {
          ...data,
          cached: false,
          responseTime: `${Date.now() - startTime}ms`
        }
      });

    } catch (err) {
      console.error('[lyrics] error:', err.message);
      res.status(404).json({
        ok: false,
        error: {
          code: 'NOT_FOUND',
          message: err.message || 'Lirik tidak ditemukan'
        },
        responseTime: `${Date.now() - startTime}ms`
      });
    }
  });
};

async function fetchLyrics(title) {
  const { data } = await axios.get(
    `https://lrclib.net/api/search?q=${encodeURIComponent(title)}`,
    {
      headers: {
        referer: `https://lrclib.net/search/${encodeURIComponent(title)}`,
        'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36'
      },
      timeout: 15000
    }
  );

  if (!data || !data[0]) {
    throw new Error('Lirik tidak ditemukan');
  }

  const song = data[0];

  const track = song.trackName || 'Unknown Track';
  const artist = song.artistName || 'Unknown Artist';
  const album = song.albumName || 'Unknown Album';
  const duration = song.duration
    ? `${Math.floor(song.duration / 60)}:${(song.duration % 60).toString().padStart(2, '0')}`
    : '-';

  let lyrics = song.plainLyrics || song.syncedLyrics || '';
  lyrics = lyrics.replace(/\[.*?\]/g, '').trim();

  if (!lyrics) {
    throw new Error('Lirik kosong');
  }

  return {
    title: track,
    artist: artist,
    album: album,
    duration: duration,
    lyrics: lyrics
  };
}