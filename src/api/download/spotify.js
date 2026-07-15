'use strict';

const axios = require('axios');

const API = 'https://spotyloader.com/api/spotify';
const HEADERS = { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' };
const POLL_ATTEMPTS = 15;
const POLL_INTERVAL_MS = 2000;
const COLLECTION_BATCH_SIZE = 3;
const COLLECTION_MAX_TRACKS = 10;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function downloadTrack(trackUrl) {
  const res = await axios.post(`${API}/track`, { url: trackUrl }, { headers: HEADERS, timeout: 15000 });
  const trackId = res.data?.jobId;
  if (!trackId) throw new Error('Gagal memulai proses download.');

  for (let i = 0; i < POLL_ATTEMPTS; i += 1) {
    await delay(POLL_INTERVAL_MS);
    const statusRes = await axios.get(`${API}/track/status/${trackId}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 15000
    });
    const data = statusRes.data;

    if (data.status === 'ready' || data.status === 'success') {
      const downloadUrl = data.downloadLink || data.downloadUrl || data.post?.download_url;
      if (downloadUrl) {
        return {
          url: downloadUrl,
          title: data.post?.name || 'Unknown',
          artist: data.post?.artist || 'Unknown',
          image: data.post?.image || null
        };
      }
    } else if (data.status === 'error' || data.status === 'failed') {
      throw new Error('Konversi gagal di server.');
    }
  }

  throw new Error('Timeout menunggu proses konversi.');
}

async function getTracksFromCollection(url, type) {
  const res = await axios.post(`${API}/${type}`, { url }, { headers: HEADERS, timeout: 15000 });
  return { title: res.data.post?.name || type, tracks: res.data.post?.tracks || [] };
}

module.exports = function register(app, registry) {
  const route = {
    method: 'GET',
    path: '/download/spotify',
    group: 'download',
    name: 'Spotify Download',
    description: 'Download lagu, album, atau playlist Spotify. Untuk album/playlist, maksimal 10 track pertama yang diproses.',
    params: [
      { key: 'url', required: true, hint: 'Link Spotify (track/album/playlist)', example: 'https://open.spotify.com/track/xxxxx' }
    ]
  };
  registry.push(route);

  app.get(route.path, async (req, res) => {
    const url = (req.query.url || '').trim();

    if (!url || !url.includes('open.spotify.com')) {
      return res.status(400).json({
        ok: false,
        error: { code: 'INVALID_URL', message: 'Parameter "url" wajib diisi dengan link Spotify yang valid.' }
      });
    }

    const isCollection = url.includes('/album/') || url.includes('/playlist/');

    try {
      if (!isCollection) {
        const track = await downloadTrack(url);
        return res.json({
          result: {
            type: 'track',
            title: track.title,
            artist: track.artist,
            image: track.image,
            download_url: track.url
          }
        });
      }

      const type = url.includes('/album/') ? 'album' : 'playlist';
      const collection = await getTracksFromCollection(url, type);

      if (!collection.tracks.length) {
        return res.status(404).json({
          ok: false,
          error: { code: 'NOT_FOUND', message: `Tidak ada track ditemukan di ${type} ini.` }
        });
      }

      const targetTracks = collection.tracks.slice(0, COLLECTION_MAX_TRACKS);
      const results = [];

      for (let i = 0; i < targetTracks.length; i += COLLECTION_BATCH_SIZE) {
        const batch = targetTracks.slice(i, i + COLLECTION_BATCH_SIZE);
        const batchResults = await Promise.all(
          batch.map((t) =>
            downloadTrack(t.url)
              .then((track) => ({ ok: true, title: track.title, artist: track.artist, download_url: track.url }))
              .catch((err) => ({ ok: false, title: t.name || t.url, error: err.message }))
          )
        );
        results.push(...batchResults);
      }

      res.json({
        result: {
          type,
          title: collection.title,
          total_tracks: collection.tracks.length,
          processed: results.length,
          truncated: collection.tracks.length > COLLECTION_MAX_TRACKS,
          tracks: results
        }
      });
    } catch (err) {
      console.error('[spotify] error:', err.message);
      res.status(502).json({
        ok: false,
        error: { code: 'UPSTREAM_ERROR', message: err.response?.data?.message || err.message || 'Gagal memproses link Spotify.' }
      });
    }
  });
};
