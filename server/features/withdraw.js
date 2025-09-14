import express from "express";
import { getAuthorizedUser } from "../utils/twa.js";
import { query } from "../db/pool.js";
import { bot } from "../telegram/bot.js";

const router = express.Router();

// POST /api/withdraw
// body: { type: 'stars' | 'nft', amount?: number, nft_id?: string }
router.post("/", async (req, res) => {
  try {
    const initData = req.header("X-Telegram-InitData") || req.header("authorization")?.replace(/^twa\s+/i, "") || "";
    const tgUser = getAuthorizedUser(initData, process.env.TG_BOT_TOKEN);
    if (!tgUser) return res.status(401).json({ ok: false, error: "unauthorized" });

    const tgId = String(tgUser.id);
    const ures = await query("SELECT id, stars_balance FROM users WHERE telegram_id = $1 OR tg_id = $1", [tgId]);
    if (ures.rowCount === 0) return res.status(403).json({ ok: false, error: "no_user" });
    const user = ures.rows[0];

    const { type } = req.body || {};
    if (!type || (type !== "stars" && type !== "nft")) return res.status(400).json({ ok: false, error: "invalid_type" });

    if (type === "stars") {
      const amount = Number(req.body.amount || 0);
      if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ ok: false, error: "invalid_amount" });
      const fee = Math.ceil(amount * 0.1);
      const needed = amount + fee;
      if (user.stars_balance < needed) return res.status(400).json({ ok: false, error: "insufficient_balance", needed, have: user.stars_balance });

      // deduct immediately to avoid double-withdraw
      await query(`UPDATE users SET stars_balance = stars_balance - $1 WHERE id = $2`, [needed, user.id]);
      const net = amount;
      const ins = await query(
        `INSERT INTO withdrawals (user_id, type, amount, fee, net_amount) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [user.id, "stars", amount, fee, net]
      );
      const wid = ins.rows[0].id;

      // send message to admin chat for processing
      const adminChat = process.env.ADMIN_WITHDRAW_CHAT || "@zazarara2";
      const text = `Новая заявка на вывод Stars\nID: ${wid}\nПользователь: ${tgUser.username ? `@${tgUser.username}` : `${tgUser.first_name} (${tgUser.id})`}\nСумма: ${amount}⭐️\nКомиссия: ${fee}⭐️\nНа проверке`;
      try { await bot.api.sendMessage(adminChat, text); } catch (e) { console.error("failed send admin message", e); }

      return res.json({ ok: true, id: wid, deducted: needed });
    } else {
      // nft withdrawal
      const nft_id = String(req.body.nft_id || "");
      if (!nft_id) return res.status(400).json({ ok: false, error: "invalid_nft" });
      const ins = await query(
        `INSERT INTO withdrawals (user_id, type, nft_id, fee, net_amount) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [user.id, "nft", nft_id, 0, null]
      );
      const wid = ins.rows[0].id;
      const adminChat = process.env.ADMIN_NFT_CHAT || "@zazarara4";
      const text = `Новая заявка на вывод NFT\nID: ${wid}\nПользователь: ${tgUser.username ? `@${tgUser.username}` : `${tgUser.first_name} (${tgUser.id})`}\nNFT: ${nft_id}\nНа проверке`;
      try { await bot.api.sendMessage(adminChat, text); } catch (e) { console.error("failed send admin message", e); }
      return res.json({ ok: true, id: wid });
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "internal" });
  }
});

// Admin endpoints
async function requireAdmin(req, res) {
  const initData = req.header("X-Telegram-InitData") || req.header("authorization")?.replace(/^twa\s+/i, "") || "";
  const tgUser = getAuthorizedUser(initData, process.env.TG_BOT_TOKEN);
  if (!tgUser) { res.status(401).json({ ok: false, error: "unauthorized" }); return null; }
  const adminId = process.env.ADMIN_ID ? String(process.env.ADMIN_ID) : null;
  if (!adminId || String(tgUser.id) !== adminId) { res.status(403).json({ ok: false, error: "forbidden" }); return null; }
  return tgUser;
}

router.get("/pending", async (req, res) => {
  try {
    const adm = await requireAdmin(req, res); if (!adm) return;
    const { rows } = await query(`SELECT w.id,w.type,w.amount,w.nft_id,w.fee,w.net_amount,w.status,w.created_at,u.telegram_id,u.username FROM withdrawals w JOIN users u ON u.id = w.user_id WHERE w.status = 'pending' ORDER BY w.created_at DESC`);
    res.json({ ok: true, data: rows });
  } catch (e) { console.error(e); res.status(500).json({ ok: false, error: "internal" }); }
});

router.post("/:id/approve", async (req, res) => {
  try {
    const adm = await requireAdmin(req, res); if (!adm) return;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "invalid_id" });
    const wr = await query(`SELECT * FROM withdrawals WHERE id = $1`, [id]);
    if (wr.rowCount === 0) return res.status(404).json({ ok: false, error: "not_found" });
    const w = wr.rows[0];
    if (w.status !== 'pending') return res.status(400).json({ ok: false, error: "not_pending" });

    await query(`UPDATE withdrawals SET status = 'completed', admin_note = $1 WHERE id = $2`, [req.body.note || null, id]);

    // notify completed chat
    const completedChat = process.env.ADMIN_WITHDRAW_COMPLETED_CHAT || "@zazarara3";
    const userRow = await query(`SELECT telegram_id, username, first_name FROM users WHERE id = $1`, [w.user_id]);
    const u = userRow.rows[0];
    const userRef = u.username ? `@${u.username}` : `${u.first_name} (${u.telegram_id})`;
    const text = `Заявка выполнена\nID: ${id}\nПользователь: ${userRef}\nТип: ${w.type}\nСумма: ${w.amount || ''}\nNFT: ${w.nft_id || ''}\nПримечание: ${req.body.note || ''}`;
    try { await bot.api.sendMessage(completedChat, text); } catch (e) { console.error("failed notify completed", e); }

    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ ok: false, error: "internal" }); }
});

router.post("/:id/decline", async (req, res) => {
  try {
    const adm = await requireAdmin(req, res); if (!adm) return;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "invalid_id" });
    const wr = await query(`SELECT * FROM withdrawals WHERE id = $1`, [id]);
    if (wr.rowCount === 0) return res.status(404).json({ ok: false, error: "not_found" });
    const w = wr.rows[0];
    if (w.status !== 'pending') return res.status(400).json({ ok: false, error: "not_pending" });

    const refund = !!req.body.refund;
    if (refund && w.type === 'stars') {
      // restore amount+fee
      await query(`UPDATE users SET stars_balance = stars_balance + $1 WHERE id = $2`, [ (w.amount || 0) + (w.fee || 0), w.user_id]);
    }
    await query(`UPDATE withdrawals SET status = 'declined', admin_note = $1 WHERE id = $2`, [req.body.note || null, id]);

    // notify completed chat about decline
    const completedChat = process.env.ADMIN_WITHDRAW_COMPLETED_CHAT || "@zazarara3";
    const userRow = await query(`SELECT telegram_id, username, first_name FROM users WHERE id = $1`, [w.user_id]);
    const u = userRow.rows[0];
    const userRef = u.username ? `@${u.username}` : `${u.first_name} (${u.telegram_id})`;
    const text = `Заявка отклонена\nID: ${id}\nПользователь: ${userRef}\nТип: ${w.type}\nСумма: ${w.amount || ''}\nВозврат: ${refund ? 'да' : 'нет'}\nПричина: ${req.body.note || ''}`;
    try { await bot.api.sendMessage(completedChat, text); } catch (e) { console.error("failed notify decline", e); }

    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ ok: false, error: "internal" }); }
});

export default router;
