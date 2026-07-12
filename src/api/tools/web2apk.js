'use strict';

const axios = require('axios');
const FormData = require('form-data');

module.exports = function register(app, registry) {
  const route = {
    method: 'POST',
    path: '/tools/web2apk',
    group: 'tools',
    name: 'Web2Apk Builder',
    description: 'Ubah website jadi APK Android. Kirim URL icon dan URL website.',
    params: [
      {
        key: 'url',
        required: true,
        hint: 'URL website',
        example: 'https://www.google.com'
      },
      {
        key: 'name',
        required: true,
        hint: 'Nama aplikasi',
        example: 'Google App'
      },
      {
        key: 'icon',
        required: true,
        hint: 'URL icon (png/jpg)',
        example: 'https://example.com/icon.png'
      },
      {
        key: 'version',
        required: false,
        hint: 'Versi (default: 1.0.0)',
        example: '1.0.0'
      }
    ]
  };
  registry.push(route);

  app.post(route.path, async (req, res) => {
    const { url, name, icon, version = '1.0.0' } = req.body;

    if (!url || !/^https?:\/\//i.test(url)) {
      return res.status(400).json({
        ok: false,
        error: { code: 'INVALID_URL', message: 'URL tidak valid' }
      });
    }

    if (!name || !name.trim()) {
      return res.status(400).json({
        ok: false,
        error: { code: 'MISSING_NAME', message: 'Nama aplikasi wajib diisi' }
      });
    }

    if (!icon || !/^https?:\/\//i.test(icon)) {
      return res.status(400).json({
        ok: false,
        error: { code: 'INVALID_ICON', message: 'URL icon tidak valid' }
      });
    }

    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      return res.status(400).json({
        ok: false,
        error: { code: 'INVALID_VERSION', message: 'Versi harus 1.0.0' }
      });
    }

    try {
      const versionCode = version.split('.').reduce((acc, n) => acc * 100 + Number(n), 0);
      const packageName = `com.${name.toLowerCase().replace(/[^a-z0-9]/g, '')}.web2apk`;
      const baseUrl = 'https://webappcreator.amethystlab.org';

      const iconBuffer = await downloadImage(icon);
      if (!iconBuffer) {
        return res.status(400).json({
          ok: false,
          error: { code: 'ICON_FAILED', message: 'Gagal download icon' }
        });
      }

      const form = new FormData();
      form.append('websiteUrl', url);
      form.append('appName', name.trim());
      form.append('icon', iconBuffer, { filename: 'icon.png' });
      form.append('packageName', packageName);
      form.append('versionName', version);
      form.append('versionCode', versionCode);

      const response = await axios.post(`${baseUrl}/api/build-apk`, form, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          ...form.getHeaders()
        },
        timeout: 120000
      });

      if (!response.data.success) {
        return res.status(502).json({
          ok: false,
          error: { code: 'BUILD_FAILED', message: response.data.message || 'Gagal build APK' }
        });
      }

      res.json({
        result: {
          name: name.trim(),
          version: version,
          download: `${baseUrl}${response.data.downloadUrl}`
        }
      });

    } catch (err) {
      console.error('[web2apk] error:', err.message);
      res.status(502).json({
        ok: false,
        error: { code: 'API_ERROR', message: err.message || 'Gagal membuat APK' }
      });
    }
  });
};

async function downloadImage(url) {
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 15000
    });
    return response.headers['content-type']?.startsWith('image/') ? Buffer.from(response.data) : null;
  } catch {
    return null;
  }
}