'use strict';

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const FONT_URL = 'https://raw.githubusercontent.com/reyzdesu/bot-assets/main/fonts/impact.ttf';
const FONT_PATH = path.join(os.homedir(), '.fonts', 'impact.ttf');
const MAX_DIMENSION = 1600;
const MIN_FONT_SIZE = 16;

let fontReady = null;

function ensureFont() {
  if (!fontReady) {
    fontReady = (async () => {
      if (!fs.existsSync(FONT_PATH)) {
        const res = await axios.get(FONT_URL, { responseType: 'arraybuffer', timeout: 20000 });
        fs.mkdirSync(path.dirname(FONT_PATH), { recursive: true });
        fs.writeFileSync(FONT_PATH, Buffer.from(res.data));
        try {
          execSync(`fc-cache -f "${path.dirname(FONT_PATH)}"`);
        } catch (e) {
          console.error('[maker/meme] fc-cache failed:', e.message);
        }
      }
    })().catch((err) => {
      fontReady = null;
      throw err;
    });
  }
  return fontReady;
}

function escapeXml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

function fitLines(text, maxWidth, maxHeight, startFontSize) {
  for (let size = startFontSize; size >= MIN_FONT_SIZE; size--) {
    const maxChars = Math.max(1, Math.floor(maxWidth / (size * 0.58)));
    const lines = [];
    let line = '';
    for (let word of text.split(/\s+/).filter(Boolean)) {
      while (word.length > maxChars) {
        if (line) lines.push(line), (line = '');
        lines.push(word.slice(0, maxChars));
        word = word.slice(maxChars);
      }
      const candidate = line ? `${line} ${word}` : word;
      if (candidate.length <= maxChars) line = candidate;
      else lines.push(line), (line = word);
    }
    if (line) lines.push(line);

    const lineHeight = size * 1.15;
    if (lines.length * lineHeight <= maxHeight || size === MIN_FONT_SIZE) {
      return { size, lines, lineHeight };
    }
  }
}

function renderBlock(text, width, maxWidth, maxHeight, startFontSize, startY) {
  const { size, lines, lineHeight } = fitLines(text.toUpperCase(), maxWidth, maxHeight, startFontSize);
  const stroke = Math.max(2, Math.round(size / 12));
  return {
    svg: lines
      .map(
        (line, i) =>
          `<text x="${width / 2}" y="${startY + i * lineHeight + size}" text-anchor="middle" font-family="Impact" font-size="${size}" fill="#fff" stroke="#000" stroke-width="${stroke}" stroke-linejoin="round" paint-order="stroke">${escapeXml(line)}</text>`
      )
      .join(''),
    height: lines.length * lineHeight
  };
}

module.exports = function register(app, registry) {
  const route = {
    method: 'GET',
    path: '/maker/meme',
    group: 'api',
    name: 'Meme Text Maker',
    description: 'Timpa foto dari URL dengan teks meme (atas/bawah), font Impact, auto-resize otomatis, no crop.',
    params: [
      { key: 'url', required: true, hint: 'Direct URL gambar', example: 'https://i.ibb.co/cKvjChq9/1b458a250595.jpg' },
      { key: 'top', required: false, hint: 'Teks di atas', example: 'KETIKA' },
      { key: 'bottom', required: false, hint: 'Teks di bawah', example: 'CUMA DEMI KAMU' }
    ]
  };
  registry.push(route);

  app.get(route.path, async (req, res) => {
    const url = (req.query.url || '').trim();
    const topText = (req.query.top || '').trim();
    const bottomText = (req.query.bottom || '').trim();

    if (!url) {
      return res.status(400).json({
        ok: false,
        error: { code: 'MISSING_PARAM', message: 'Parameter "url" wajib diisi.' }
      });
    }
    if (!topText && !bottomText) {
      return res.status(400).json({
        ok: false,
        error: { code: 'MISSING_PARAM', message: 'Isi minimal salah satu parameter "top" atau "bottom".' }
      });
    }

    try {
      const sharp = require('sharp');

      const [{ data: imageData }] = await Promise.all([
        axios.get(url, { responseType: 'arraybuffer', timeout: 20000 }),
        ensureFont()
      ]);
      const imageBuffer = Buffer.from(imageData);

      let meta;
      try {
        meta = await sharp(imageBuffer).metadata();
      } catch (err) {
        return res.status(400).json({
          ok: false,
          error: { code: 'INVALID_IMAGE', message: 'URL yang dikirim bukan gambar yang valid.' }
        });
      }

      let width = meta.width;
      let height = meta.height;
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        const scale = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }

      const resized = await sharp(imageBuffer).resize(width, height).png().toBuffer();

      const maxWidth = width * 0.9;
      const maxFontSize = Math.floor(width / 5);
      const margin = height * 0.03;
      const maxHeight = height * (topText && bottomText ? 0.3 : 0.4);

      let overlays = '';
      if (topText) overlays += renderBlock(topText, width, maxWidth, maxHeight, maxFontSize, margin).svg;
      if (bottomText) {
        const block = renderBlock(bottomText, width, maxWidth, maxHeight, maxFontSize, 0);
        overlays += renderBlock(bottomText, width, maxWidth, maxHeight, maxFontSize, height - margin - block.height).svg;
      }

      const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${overlays}</svg>`;
      const outBuffer = await sharp(resized)
        .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
        .png()
        .toBuffer();

      res.set('Content-Type', 'image/png');
      res.send(outBuffer);
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: { code: 'UPSTREAM_ERROR', message: err.message || 'Gagal memproses gambar.' }
      });
    }
  });
};
