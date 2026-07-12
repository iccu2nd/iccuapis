'use strict';

const axios = require('axios');

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';

function randomIp() {
  const octet = () => Math.floor(Math.random() * 255) + 1;
  return `${octet()}.${octet()}.${octet()}.${octet()}`;
}

async function scrapeTikTok(username) {
  const ip = randomIp();
  const { data } = await axios.get(`https://www.tiktok.com/@${username}`, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate, br',
      Connection: 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'X-Forwarded-For': ip,
      'X-Real-IP': ip
    },
    timeout: 10000
  });

  const match = data.match(
    /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application\/json">(.*?)<\/script>/s
  );
  if (!match) return null;

  const json = JSON.parse(match[1]);
  const info = json.__DEFAULT_SCOPE__?.['webapp.user-detail']?.userInfo || {};
  const user = info.user || {};
  const stats = info.stats || {};
  if (!user.id) return null;

  return {
    id: user.id,
    uniqueId: user.uniqueId,
    nickname: user.nickname,
    bio: user.signature?.trim() || 'No bio yet',
    region: user.region,
    verified: !!user.verified,
    private: !!user.privateAccount,
    avatar: user.avatarLarger,
    followers: stats.followerCount,
    following: stats.followingCount,
    hearts: stats.heartCount,
    videos: stats.videoCount
  };
}

module.exports = function register(app, registry) {
  const route = {
    method: 'GET',
    path: '/stalk/tiktok',
    group: 'stalk',
    name: 'TikTok Stalk',
    description: 'Cari informasi tentang profil TikTok berdasarkan nama pengguna: jumlah pengikut, suka, bio, dan lainnya.,
    params: [{ key: 'username', required: true, hint: 'TikTok username (tanpa @)', example: 'rei.esemka' }]
  };
  registry.push(route);

  app.get(route.path, async (req, res) => {
    const { username } = req.query;
    if (!username || !username.trim()) {
      return res.status(400).json({
        ok: false,
        error: { code: 'MISSING_PARAM', message: 'The "username" parameter is required.' }
      });
    }

    try {
      const profile = await scrapeTikTok(username.trim());
      if (!profile) {
        return res.status(404).json({
          ok: false,
          error: { code: 'NOT_FOUND', message: 'TikTok user not found or profile is unavailable.' }
        });
      }
      res.json({ result: profile });
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: { code: 'UPSTREAM_ERROR', message: 'Failed to fetch TikTok profile right now.' }
      });
    }
  });
};
