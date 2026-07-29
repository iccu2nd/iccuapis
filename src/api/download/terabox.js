'use strict';

const crypto = require('crypto');
const cache = require('../../cache');

const CACHE_TTL_MS = 15 * 60 * 1000;

class Tera {
    constructor() {
        this.secretSalt = "T9do@SM1?xGn5";
    }

    async downloadDirect(url) {
        const timestamp = Math.floor(Date.now() / 1000);
        const token = crypto
            .createHash("md5")
            .update(`${this.secretSalt}${timestamp}/api/stream.php`)
            .digest("hex");

        const response = await fetch(
            `https://playterabox.com/api/fetch-video?token=${token}&t=${timestamp}`,
            {
                method: "POST",
                headers: {
                    "authority": "playterabox.com",
                    "accept": "*/*",
                    "accept-language": "en-US,en;q=0.9",
                    "content-type": "application/json",
                    "origin": "https://playterabox.com",
                    "referer": "https://playterabox.com/",
                    "sec-ch-ua": '"Chromium";v="137", "Not/A)Brand";v="24"',
                    "sec-ch-ua-mobile": "?1",
                    "sec-ch-ua-platform": '"Android"',
                    "sec-fetch-dest": "empty",
                    "sec-fetch-mode": "cors",
                    "sec-fetch-site": "same-origin",
                    "user-agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36"
                },
                body: JSON.stringify({ url })
            }
        );

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        return response.json();
    }
}

module.exports = function register(app, registry) {
    const route = {
        method: 'GET',
        path: '/downloader/terabox',
        group: 'api',
        name: 'TeraBox Downloader',
        description: 'Download file dari TeraBox (support video, audio, file)',
        params: [
            {
                key: 'url',
                required: true,
                hint: 'URL share TeraBox',
                example: 'https://www.terabox.app/wap/share/filelist?surl=Mqckxu2XACBC0dc3Rh6dJg'
            }
        ]
    };
    registry.push(route);

    app.get(route.path, async (req, res) => {
        const { url } = req.query;

        if (!url) {
            return res.status(400).json({
                ok: false,
                error: {
                    code: 'MISSING_PARAM',
                    message: '"url" is required.'
                }
            });
        }

        try {
            const cacheKey = `terabox:${url}`;
            const cached = cache.get(cacheKey);
            if (cached) {
                return res.json({
                    result: cached,
                    cache: true
                });
            }

            const tera = new Tera();
            const rawResult = await tera.downloadDirect(url);

            const formatted = {
                status: rawResult.status || 'success',
                total_files: rawResult.total_files || 0,
                total_folders: rawResult.total_folders || 0,
                files: rawResult.list?.map(file => ({
                    name: file.name,
                    size: file.size_formatted || `${(file.size / 1024 / 1024).toFixed(2)} MB`,
                    type: file.type || 'unknown',
                    duration: file.duration || null,
                    quality: file.quality || null,
                    download_url: file.download_link || file.normal_dlink,
                    stream_url: file.stream_url || null,
                    thumbnail: file.thumbnail || null,
                    subtitle: file.subtitle_url || null,
                    fast_stream: file.fast_stream_url || null
                })) || [],
                credits: {
                    remaining: rawResult.free_credits_remaining || '0/100',
                    charged: rawResult.charged || '0'
                },
                balance: rawResult.current_balance || '0'
            };

            cache.set(cacheKey, formatted, CACHE_TTL_MS);

            res.json({
                result: formatted,
                cache: false
            });
        } catch (err) {
            res.status(500).json({
                ok: false,
                error: {
                    code: 'TERABOX_ERROR',
                    message: err.message
                }
            });
        }
    });
};