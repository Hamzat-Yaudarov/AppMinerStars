const crypto = require('crypto');

function parseInitData(initData) {
  const urlParams = new URLSearchParams(initData);
  const data = {};
  for (const [k, v] of urlParams.entries()) data[k] = v;
  return data;
}

function checkTelegramAuth(initData, botToken) {
  if (!initData) return { ok: false, error: 'missing_init_data' };
  const data = parseInitData(initData);
  const hash = data.hash;
  delete data.hash;
  const pairs = Object.keys(data)
    .sort()
    .map((key) => `${key}=${data[key]}`)
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const check = crypto.createHmac('sha256', secret).update(pairs).digest('hex');
  const ok = check === hash;
  if (!ok) return { ok: false, error: 'invalid_hash' };
  let user;
  try {
    user = JSON.parse(data.user);
  } catch (e) {
    return { ok: false, error: 'invalid_user' };
  }
  return { ok: true, user, authDate: Number(data.auth_date) };
}

module.exports = { checkTelegramAuth };
