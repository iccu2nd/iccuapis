'use strict';

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage, registerFont } = require('canvas');

const FONT_URL = 'https://raw.githubusercontent.com/reyzdesu/bot-assets/main/fonts/impact.ttf';
const FONT_DIR = path.join(__dirname, '..', '..', '..', '.cache', 'fonts');
const FONT_PATH = path.join(FONT_DIR, 'impact.ttf');
const FONT_FAMILY = 'ImpactMeme';

const MAX_DIMENSION = 2000; // batas aman biar gak makan memori kalo gambar kegedean
const MAX_FONT_SIZE_RATIO = 1 / 6; // ukuran font maksimal relatif ke lebar canvas
const MIN_FONT_SIZE = 6; // batas paling kecil, garansi teks selalu ke-render tanpa crop
const SECTION_HEIGHT_RATIO = 0.32; // tinggi maksimal blok teks (atas/bawah) relatif ke tinggi canvas
const SIDE_MARGIN_RATIO = 0.05; // margin kiri-kanan relatif ke lebar canvas
const TOP_BOTTOM_MARGIN_RATIO = 0.035; // jarak teks dari tepi atas/bawah

let fontLoadPromise = null;

/**
 * Pastikan font Impact ke-download & ke-register ke node-canvas.
 * Kalau gagal (mis. gak ada koneksi ke GitHub), fallback ke font default
 * biar endpoint tetap jalan (no bug / no crash).
 */
async function ensureFontLoaded() {
  if (fontLoadPromise) return fontLoadPromise;

  fontLoadPromise = (async () => {
    try {
      if (!fs.existsSync(FONT_PATH)) {
        fs.mkdirSync(FONT_DIR, { recursive: true });
        const { data } = await axios.get(FONT_URL, {
          responseType: 'arraybuffer',
          timeout: 20000
        });
        fs.writeFileSync(FONT_PATH, data);
      }
      registerFont(FONT_PATH, { family: FONT_FAMILY });
      return FONT_FAMILY;
    } catch (err) {
      console.error('[maker/meme] gagal load font Impact, fallback ke font default:', err.message);
      fontLoadPromise = null; // biar request berikutnya nyoba download lagi
      return 'sans-serif';
    }
  })();

  return fontLoadPromise;
}

/**
 * Bungkus teks jadi beberapa baris supaya gak pernah melebihi maxWidth.
 * Kalau ada satu kata yang tetap kepanjangan sendirian, dipotong per-karakter
 * (bukan di-crop / dibuang) supaya gak ada bagian teks yang hilang.
 */
function wrapText(ctx, text, maxWidth) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';

  for (let word of words) {
    while (ctx.measureText(word).width > maxWidth) {
      let cut = 1;
      while (cut <= word.length && ctx.measureText(word.slice(0, cut)).width <= maxWidth) {
        cut++;
      }
      cut = Math.max(1, cut - 1);
      const piece = word.slice(0, cut);
      if (line) {
        lines.push(line);
        line = '';
      }
      lines.push(piece);
      word = word.slice(cut);
    }

    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      line = candidate;
    } else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Cari ukuran font paling besar yang bikin teks (setelah di-wrap) tetap muat
 * di dalam maxWidth x maxBlockHeight. Kalo teks sedikit -> font gede.
 * Kalo teks banyak -> font otomatis mengecil sampai muat, no overflow.
 */
function fitText(ctx, text, family, maxWidth, maxBlockHeight, maxFontSize) {
  let fontSize = Math.max(Math.floor(maxFontSize), MIN_FONT_SIZE);
  let lines = [];
  let lineHeight = 0;

  for (; fontSize >= MIN_FONT_SIZE; fontSize -= 1) {
    ctx.font = `bold ${fontSize}px "${family}"`;
    lines = wrapText(ctx, text, maxWidth);
    lineHeight = fontSize * 1.15;
    const blockHeight = lines.length * lineHeight;
    if (blockHeight <= maxBlockHeight) {
      return { fontSize, lines, lineHeight };
    }
  }

  // fallback ekstrem (teks super panjang banget): tetap render di ukuran minimum
  ctx.font = `bold ${MIN_FONT_SIZE}px "${family}"`;
  lines = wrapText(ctx, text, maxWidth);
  return { fontSize: MIN_FONT_SIZE, lines, lineHeight: MIN_FONT_SIZE * 1.15 };
}

function drawTextBlock(ctx, { lines, fontSize, lineHeight }, canvasWidth, startY) {
  const strokeWidth = Math.max(2, Math.round(fontSize / 12));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.lineWidth = strokeWidth;
  ctx.strokeStyle = '#000000';
  ctx.fillStyle = '#ffffff';

  lines.forEach((line, i) => {
    const y = startY + i * lineHeight + fontSize;
    ctx.strokeText(line, canvasWidth / 2, y);
    ctx.fillText(line, canvasWidth / 2, y);
  });
}

module.exports = function register(app, registry) {
  const route = {
    method: 'GET',
    path: '/maker/meme',
    group: 'maker',
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
      const [{ data: imageBuffer }, fontFamily] = await Promise.all([
        axios.get(url, { responseType: 'arraybuffer', timeout: 20000 }),
        ensureFontLoaded()
      ]);

      let image;
      try {
        image = await loadImage(Buffer.from(imageBuffer));
      } catch (err) {
        return res.status(400).json({
          ok: false,
          error: { code: 'INVALID_IMAGE', message: 'URL yang dikirim bukan gambar yang valid.' }
        });
      }

      let { width, height } = image;
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        const scale = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }

      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0, width, height); // full gambar, gak ada yang ke-crop

      const maxWidth = width * (1 - SIDE_MARGIN_RATIO * 2);
      const maxBlockHeight = height * SECTION_HEIGHT_RATIO;
      const maxFontSize = width * MAX_FONT_SIZE_RATIO;
      const edgeMargin = height * TOP_BOTTOM_MARGIN_RATIO;

      if (topText) {
        const fit = fitText(ctx, topText.toUpperCase(), fontFamily, maxWidth, maxBlockHeight, maxFontSize);
        drawTextBlock(ctx, fit, width, edgeMargin);
      }

      if (bottomText) {
        const fit = fitText(ctx, bottomText.toUpperCase(), fontFamily, maxWidth, maxBlockHeight, maxFontSize);
        const blockHeight = fit.lines.length * fit.lineHeight;
        const startY = height - edgeMargin - blockHeight;
        drawTextBlock(ctx, fit, width, startY);
      }

      const outBuffer = canvas.toBuffer('image/png');
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
