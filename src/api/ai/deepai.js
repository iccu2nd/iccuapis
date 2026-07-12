'use strict';

const axios = require('axios');

module.exports = function register(app, registry) {
  const route = {
    method: 'GET',
    path: '/ai/deepai',
    group: 'ai',
    name: 'DeepAI Chat',
    description: 'Chat dengan AI DeepAI (gratis). Kirim prompt dan dapatkan respons.',
    params: [
      {
        key: 'prompt',
        required: true,
        hint: 'Pertanyaan atau perintah untuk AI',
        example: 'Apa itu logic?'
      }
    ]
  };
  registry.push(route);

  app.get(route.path, async (req, res) => {
    const { prompt } = req.query;

    if (!prompt || !prompt.trim()) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'MISSING_PARAM',
          message: 'Parameter "prompt" wajib diisi.'
        }
      });
    }

    try {
      const result = await deepai(prompt.trim());
      
      res.json({
        result: {
          prompt: prompt.trim(),
          response: result,
          source: 'DeepAI.org'
        }
      });
    } catch (err) {
      console.error('[deepai] error:', err.message);
      res.status(502).json({
        ok: false,
        error: {
          code: 'API_ERROR',
          message: err.message || 'Gagal mendapatkan respons dari DeepAI'
        }
      });
    }
  });
};

async function deepai(prompt) {
  const url = 'https://api.deepai.org/hacking_is_a_serious_crime';

  const headers = {
    'api-key': 'tryit-84303483976-293520c15ccc5fada63d9e51c4639dbb',
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36',
    Accept: '*/*',
    Origin: 'https://deepai.org',
    Referer: 'https://deepai.org/chat',
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  const chatHistory = JSON.stringify([{ role: 'user', content: prompt }]);

  const payload = new URLSearchParams();
  payload.append('chat_style', 'chat');
  payload.append('chatHistory', chatHistory);

  try {
    const response = await axios.post(url, payload.toString(), {
      headers,
      timeout: 30000
    });

    return response.data;
  } catch (error) {
    throw new Error(error.response?.data?.message || error.message || 'DeepAI error');
  }
}
