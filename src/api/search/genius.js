'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const cache = require('../../cache');

const CACHE_TTL_MS = 60 * 60 * 1000;
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

async function searchSongs(query) {
  const url = `https://genius.com/api/search/multi?q=${encodeURIComponent(query)}`;
  const response = await axios.get(url, { headers: HEADERS, timeout: 10000 });

  const sections = response.data?.response?.sections || [];
  const songs = [];
  const seenIds = new Set();

  for (const section of sections) {
    const hits = section.hits || [];
    for (const hit of hits) {
      const result = hit.result || {};
      if (hit.type === 'song' || result._type === 'song') {
        const songId = result.id;
        if (songId && !seenIds.has(songId)) {
          seenIds.add(songId);
          songs.push({
            title: result.title,
            artist: result.artist_names,
            path: result.path,
            image: result.header_image_url,
            releaseDate: result.release_date_for_display
          });
        }
      }
    }
  }

  return songs;
}

async function getLyrics(songPath) {
  const url = songPath.startsWith('/') ? `https://genius.com${songPath}` : songPath;
  const response = await axios.get(url, { headers: HEADERS, timeout: 10000 });

  const $ = cheerio.load(response.data);
  const containers = $('div[data-lyrics-container="true"]');
  const lyricsList = [];

  containers.each((i, elem) => {
    const container = $(elem);
    container.find('[data-exclude-from-selection="true"]').remove();
    container.find('br').replaceWith('\n');
    lyricsList.push(container.text());
  });

  return lyricsList.join('\n').trim();
}

module.exports = function register(app, registry) {
  const route = {
    method: 'GET',
    path: '/search/genius-lyrics',
    group: 'search',
    name: 'Genius Lyrics',
    description: 'Cari lagu di Genius dan ambil liriknya sekaligus.',
    params: [
      { key: 'q', required: true, hint: 'Judul lagu atau artis', example: 'Let You Down NF' }
    ]
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

    const cacheKey = `genius-lyrics:${q.trim().toLowerCase()}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return res.json({ result: { ...cached, cache: true } });
    }

    try {
      const songs = await searchSongs(q.trim());

      if (!songs.length) {
        return res.status(404).json({
          ok: false,
          error: { code: 'NOT_FOUND', message: 'Lagu tidak ditemukan.' }
        });
      }

      const top = songs[0];
      const lyrics = await getLyrics(top.path);

      if (!lyrics) {
        return res.status(404).json({
          ok: false,
          error: { code: 'LYRICS_NOT_FOUND', message: 'Halaman lagu ketemu tapi lirik kosong.' }
        });
      }

      const result = { song: top, lyrics };
      cache.set(cacheKey, result, CACHE_TTL_MS);
      res.json({ result: { ...result, cache: false } });
    } catch (err) {
      console.error('[genius-lyrics] error:', err.message);
      res.status(502).json({
        ok: false,
        error: { code: 'UPSTREAM_ERROR', message: err.message || 'Gagal memproses permintaan.' }
      });
    }
  });
};