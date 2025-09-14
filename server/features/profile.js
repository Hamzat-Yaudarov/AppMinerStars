import express from "express";
import { getAuthorizedUser } from "../utils/twa.js";
import { pool, query } from "../db/pool.js";

const router = express.Router();

async function ensureUser(telegramUser) {
  const tgId = BigInt(telegramUser.id);
  const res = await query(
    `INSERT INTO users (telegram_id, username, first_name, last_name)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (telegram_id) DO UPDATE SET username = EXCLUDED.username, first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name
     RETURNING id, pickaxe_level, stars_balance, mines_coins`,
    [tgId, telegramUser.username || null, telegramUser.first_name || null, telegramUser.last_name || null]
  );
  const user = res.rows[0];
  await query(
    `INSERT INTO resources (user_id) VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING`,
    [user.id]
  );
  return user;
}

router.get("/", async (req, res) => {
  try {
    const initData = req.header("X-Telegram-InitData") || req.header("authorization")?.replace(/^twa\s+/i, "") || "";
    const tgUser = getAuthorizedUser(initData, process.env.TG_BOT_TOKEN);
    if (!tgUser) return res.status(401).json({ ok: false, error: "unauthorized" });

    const user = await ensureUser(tgUser);
    const { rows } = await query(
      `SELECT u.id, u.pickaxe_level, u.stars_balance, u.mines_coins, u.last_dig_at,
              r.coal, r.copper, r.iron, r.gold, r.diamond
       FROM users u JOIN resources r ON r.user_id = u.id WHERE u.id = $1`,
      [user.id]
    );
    res.json({ ok: true, data: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "internal" });
  }
});

export default router;
