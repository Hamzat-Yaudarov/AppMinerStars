import express from "express";
import { getAuthorizedUser } from "../utils/twa.js";
import { query } from "../db/pool.js";

const router = express.Router();

// Set referrer for current user (only if not set)
// POST /api/referral/set { referrer_telegram_id }
router.post('/set', async (req, res) => {
  try {
    const initData = req.header("X-Telegram-InitData") || req.header("authorization")?.replace(/^twa\s+/i, "") || "";
    const tgUser = getAuthorizedUser(initData, process.env.TG_BOT_TOKEN);
    if (!tgUser) return res.status(401).json({ ok: false, error: 'unauthorized' });

    const refTg = req.body?.referrer_telegram_id;
    if (!refTg) return res.status(400).json({ ok: false, error: 'missing_referrer' });

    const userRow = await query('SELECT id, referrer_user_id FROM users WHERE telegram_id = $1', [BigInt(tgUser.id)]);
    if (userRow.rowCount === 0) return res.status(403).json({ ok: false, error: 'no_user' });
    const user = userRow.rows[0];
    if (user.referrer_user_id) return res.status(400).json({ ok: false, error: 'already_has_referrer' });

    // find referrer
    const refRow = await query('SELECT id FROM users WHERE telegram_id = $1', [BigInt(refTg)]);
    if (refRow.rowCount === 0) return res.status(404).json({ ok: false, error: 'referrer_not_found' });
    const refId = refRow.rows[0].id;

    await query('UPDATE users SET referrer_user_id = $1 WHERE id = $2', [refId, user.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'internal' });
  }
});

// Credit referral bonus: POST /api/referral/credit { user_id, deposit_amount_stars }
// This endpoint would be called after a successful deposit to credit 5% of deposit to referrer
router.post('/credit', async (req, res) => {
  try {
    const uid = Number(req.body?.user_id);
    const deposit = Number(req.body?.deposit_amount_stars);
    if (!Number.isFinite(uid) || !Number.isFinite(deposit) || deposit <= 0) return res.status(400).json({ ok: false, error: 'invalid' });

    const urow = await query('SELECT referrer_user_id FROM users WHERE id = $1', [uid]);
    if (urow.rowCount === 0) return res.status(404).json({ ok: false, error: 'no_user' });
    const ref = urow.rows[0].referrer_user_id;
    if (!ref) return res.json({ ok: true, credited: 0 });

    const bonus = Math.floor(deposit * 0.05);
    if (bonus <= 0) return res.json({ ok: true, credited: 0 });
    await query('UPDATE users SET stars_balance = stars_balance + $1 WHERE id = $2', [bonus, ref]);
    res.json({ ok: true, credited: bonus });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'internal' });
  }
});

export default router;
