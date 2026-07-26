'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const cache = require('../../cache');

const UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36';
const TTL_MS = 10 * 60 * 1000;

function decodeHtml(text) {
  return String(text || '')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function cleanText(text) {
  return decodeHtml(text)
    .replace(/<\/?[^>]+>/g, '')
    .replace(/\[\d+\]/g, '')
    .replace(/\[[a-z]\]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanBlock(text) {
  return decodeHtml(text)
    .replace(/<\/?[^>]+>/g, '')
    .replace(/\[\d+\]/g, '')
    .replace(/\[[a-z]\]/gi, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function uniqueBy(array, key) {
  return array.filter((item, index, self) => self.findIndex((x) => x[key] === item[key]) === index);
}

async function searchWikipedia(base, query) {
  const { data } = await axios.get(`${base}/w/api.php`, {
    params: { action: 'query', list: 'search', srsearch: query, srlimit: 5, format: 'json', origin: '*' },
    headers: { 'user-agent': UA, 'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7' },
    timeout: 15000
  });
  return data?.query?.search || [];
}

async function getFullArticle(base, title) {
  function fixUrl(url) {
    if (!url) return null;
    if (url.startsWith('//')) return `https:${url}`;
    if (url.startsWith('/')) return `${base}${url}`;
    return url;
  }

  const pageUrl = `${base}/wiki/${encodeURIComponent(title.replaceAll(' ', '_'))}`;
  const { data } = await axios.get(pageUrl, {
    headers: {
      'user-agent': UA,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
      referer: 'https://www.wikipedia.org/'
    },
    timeout: 15000
  });

  const $ = cheerio.load(data);
  $('script, style, noscript, sup.reference, .mw-editsection, .navbox, .metadata, .ambox, .hatnote, .toc, #toc, table.vertical-navbox').remove();

  const pageTitle = cleanText($('#firstHeading').text()) || title;
  const description = cleanText($('.tagline').first().text()) || null;

  const introParagraphs = [];
  $('.mw-parser-output > section').first().find('p').each((_, el) => {
    const text = cleanBlock($(el).text());
    if (text.length > 40) introParagraphs.push(text);
  });
  if (!introParagraphs.length) {
    $('.mw-parser-output > p').each((_, el) => {
      const text = cleanBlock($(el).text());
      if (text.length > 40) introParagraphs.push(text);
    });
  }

  const sections = [];
  $('.mw-parser-output > section').each((_, section) => {
    const heading = cleanText($(section).find('h2, h3').first().text());
    if (!heading || heading.toLowerCase() === 'daftar isi') return;

    const texts = [];
    $(section).find('p, ul, ol').each((_, el) => {
      const text = cleanBlock($(el).text());
      if (text.length > 40) texts.push(text);
    });
    if (texts.length) sections.push({ title: heading, text: texts.join('\n\n') });
  });

  const infobox = {};
  $('.infobox tr').each((_, tr) => {
    const key = cleanText($(tr).find('th').first().text());
    const value = cleanText($(tr).find('td').first().text());
    if (key && value && key.length < 100) infobox[key] = value;
  });

  const images = [];
  $('.mw-parser-output img').each((_, img) => {
    const src = fixUrl($(img).attr('src'));
    const alt = cleanText($(img).attr('alt'));
    if (!src) return;
    if (src.includes('static/images')) return;
    if (src.includes('Semi-protection')) return;
    if (src.includes('OOjs_UI')) return;
    images.push({ alt: alt || null, url: src });
  });

  return {
    title: pageTitle,
    description,
    url: pageUrl,
    extract: introParagraphs.join('\n\n') || null,
    sections,
    infobox,
    images: uniqueBy(images, 'url')
  };
}

module.exports = function register(app, registry) {
  const route = {
    method: 'GET',
    path: '/search/wikipedia',
    group: 'search',
    name: 'Wikipedia Search',
    description: 'Cari artikel Wikipedia dan ambil isi lengkapnya: ringkasan, section, infobox, dan gambar.',
    params: [
      { key: 'q', required: true, hint: 'kata kunci pencarian', example: 'Rendang' },
      { key: 'lang', required: false, hint: 'kode bahasa Wikipedia (default: id)', example: 'id' }
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

    const lang = (req.query.lang || 'id').trim().toLowerCase().replace(/[^a-z-]/g, '') || 'id';
    const base = `https://${lang}.wikipedia.org`;

    try {
      const cacheKey = `wikipedia:${lang}:${q.trim().toLowerCase()}`;
      const result = await cache.wrap(cacheKey, TTL_MS, async () => {
        const searchResults = await searchWikipedia(base, q.trim());
        if (!searchResults.length) return null;

        const first = searchResults[0];
        const article = await getFullArticle(base, first.title);

        return {
          selected: { title: first.title, pageId: first.pageid, snippet: cleanText(first.snippet) },
          article
        };
      });

      if (!result) {
        return res.status(404).json({
          ok: false,
          error: { code: 'NOT_FOUND', message: `Artikel tidak ditemukan untuk: ${q.trim()}` }
        });
      }

      res.json({ result });
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: { code: 'UPSTREAM_ERROR', message: err.message || 'Gagal mengambil artikel Wikipedia.' }
      });
    }
  });
};
