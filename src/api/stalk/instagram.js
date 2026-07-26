'use strict';

const axios = require('axios');
const cheerio = require('cheerio');

const HEADERS = {
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  referer: 'https://instaanalyzer.com/',
  'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'
};

function parseData(html) {
  const $ = cheerio.load(html);
  const data = {};

  const profileInfo = $('.d-flex.flex-column.flex-sm-row.flex-wrap.margin-bottom-6');
  data.username = profileInfo.find('.col-sm-8 a.text-dark').text().trim();
  data.fullName = profileInfo.find('.col-sm-8 h1').text().trim();
  data.avatar = profileInfo.find('img.instagram-avatar').attr('src');
  data.description = profileInfo.find('.col-sm-8 small.text-muted').text().trim();

  const stats = $('.col-md-12.col-lg-4 .col');
  data.followers = stats.eq(0).find('.report-header-number').text().trim();
  data.uploads = stats.eq(1).find('.report-header-number').text().trim();
  data.engagement = stats.eq(2).find('.report-header-number').text().trim();

  const nums = $('.report-content-number').map((_, el) => $(el).text().trim()).get();
  data.engagementRate = nums[0] || null;
  data.averageLikes = nums[1] || null;
  data.averageComments = nums[2] || null;

  data.futureProjections = $('table tbody tr').map((_, el) => {
    const cells = $(el).find('td');
    return cells.length ? {
      timeUntil: cells.eq(0).text().trim(),
      date: cells.eq(1).text().trim(),
      followers: cells.eq(2).text().trim(),
      uploads: cells.eq(3).text().trim()
    } : null;
  }).get().filter((v) => v && v.timeUntil);

  return data;
}

async function analyzeInstagram(username) {
  const url = `https://instaanalyzer.com/report/${username}/instagram`;
  const { data } = await axios.get(url, { headers: HEADERS, timeout: 15000 });
  return parseData(data);
}

module.exports = function register(app, registry) {
  const route = {
    method: 'GET',
    path: '/stalk/instagram',
    group: 'stalk',
    name: 'Instagram Analyzer',
    description: 'Analisa profil Instagram: followers, uploads, engagement rate, rata-rata likes/komentar, dan proyeksi pertumbuhan ke depan.',
    params: [{ key: 'username', required: true, hint: 'username instagram (tanpa @)', example: 'instagram' }]
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
      const result = await analyzeInstagram(username.trim());
      if (!result || !result.username) {
        return res.status(404).json({
          ok: false,
          error: { code: 'NOT_FOUND', message: 'Instagram user not found or profile is unavailable.' }
        });
      }
      res.json({ result });
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: { code: 'UPSTREAM_ERROR', message: 'Failed to fetch Instagram profile right now.' }
      });
    }
  });
};
