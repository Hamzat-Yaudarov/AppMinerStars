import express from "express";
import { getAuthorizedUser } from "../utils/twa.js";
import { query } from "../db/pool.js";
import { bot } from "../telegram/bot.js";

const router = express.Router();

// Public webhook for successful payments (e.g., Telegram Stars or external)
// Body: { telegram_id, stars_amount, mc_amount, provider }
router.post('/notify', async (req, res) => {
  try {
    const { telegram_id, stars_amount, mc_amount, provider } = req.body || {};
    if (!telegram_id || !stars_amount) return res.status(400).json({ ok: false, error: 'missing' });

    const tg = String(telegram_id);
    const ures = await query('SELECT id, username, first_name FROM users WHERE telegram_id = $1 OR tg_id = $1', [tg]);
    if (ures.rowCount === 0) return res.status(404).json({ ok: false, error: 'no_user' });
    const user = ures.rows[0];

    // credit user stars
    await query('UPDATE users SET stars_balance = stars_balance + $1 WHERE id = $2', [stars_amount, user.id]);
    await query('INSERT INTO transactions (user_id, kind, stars_amount, mc_amount, meta) VALUES ($1,$2,$3,$4,$5)', [user.id, 'deposit', stars_amount, mc_amount || null, JSON.stringify({ provider })]);

    // credit referral bonus (5%)
    const refRow = await query('SELECT referrer_user_id FROM users WHERE id = $1', [user.id]);
    const referrer = refRow.rows[0]?.referrer_user_id;
    if (referrer) {
      const bonus = Math.floor(stars_amount * 0.05);
      if (bonus > 0) {
        await query('UPDATE users SET stars_balance = stars_balance + $1 WHERE id = $2', [bonus, referrer]);
        await query('INSERT INTO transactions (user_id, kind, stars_amount, mc_amount, meta) VALUES ($1,$2,$3,$4,$5)', [referrer, 'referral_bonus', bonus, null, JSON.stringify({ from_user: user.id })]);
      }
    }

    // notify admin about deposit
    try {
      const adminChat = process.env.ADMIN_WITHDRAW_CHAT || '-1003048387966';
      const text = `Пополнение: ${stars_amount}⭐\nПользователь: ${user.username ? '@'+user.username : `${user.first_name} (${telegram_id})`}\nПровайдер: ${provider || 'unknown'}`;
      await bot.api.sendMessage(adminChat, text);
    } catch (e) { console.error('notify admin failed', e); }

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'internal' });
  }
});

export default router;
