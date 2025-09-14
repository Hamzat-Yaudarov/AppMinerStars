import express from "express";
import { getAuthorizedUser } from "../utils/twa.js";
import { query } from "../db/pool.js";

const router = express.Router();

// Costs in Mines Coins for pickaxe levels 1..10
const PICKAXE_COSTS_MC = [0, 10000, 20000, 35000, 55000, 85000, 125000, 175000, 240000, 320000, 420000];
const MC_PER_STAR = 200; // 200 MC = 1 STAR

router.get("/", async (req, res) => {
  try {
    const initData = req.header("X-Telegram-InitData") || req.header("authorization")?.replace(/^twa\s+/i, "") || "";
    const tgUser = getAuthorizedUser(initData, process.env.TG_BOT_TOKEN);
    if (!tgUser) return res.status(401).json({ ok: false, error: "unauthorized" });

    const tgId = BigInt(tgUser.id);
    const ures = await query("SELECT id, pickaxe_level, stars_balance, mines_coins FROM users WHERE telegram_id = $1", [tgId]);
    if (ures.rowCount === 0) return res.status(403).json({ ok: false, error: "no_user" });
    const user = ures.rows[0];

    const nextLevel = Math.min(10, user.pickaxe_level + 1);
    const costMC = PICKAXE_COSTS_MC[nextLevel] || null;
    const costStars = costMC ? Math.ceil(costMC / MC_PER_STAR) : null;

    res.json({ ok: true, data: { pickaxe_level: user.pickaxe_level, next_level: nextLevel, cost_mc: costMC, cost_stars: costStars } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "internal" });
  }
});

router.post("/buy-pickaxe", async (req, res) => {
  try {
    const initData = req.header("X-Telegram-InitData") || req.header("authorization")?.replace(/^twa\s+/i, "") || "";
    const tgUser = getAuthorizedUser(initData, process.env.TG_BOT_TOKEN);
    if (!tgUser) return res.status(401).json({ ok: false, error: "unauthorized" });

    const method = req.body?.method || "mc"; // 'mc' or 'stars'
    const tgId = BigInt(tgUser.id);
    const ures = await query("SELECT id, pickaxe_level, stars_balance, mines_coins FROM users WHERE telegram_id = $1", [tgId]);
    if (ures.rowCount === 0) return res.status(403).json({ ok: false, error: "no_user" });
    const user = ures.rows[0];

    const nextLevel = Math.min(10, user.pickaxe_level + 1);
    const costMC = PICKAXE_COSTS_MC[nextLevel] || null;
    if (!costMC) return res.status(400).json({ ok: false, error: "max_level" });

    if (method === "mc") {
      if (Number(user.mines_coins) < costMC) return res.status(400).json({ ok: false, error: "insufficient_mc" });
      await query(`UPDATE users SET mines_coins = mines_coins - $1, pickaxe_level = $2 WHERE id = $3`, [costMC, nextLevel, user.id]);
      return res.json({ ok: true, paid: { method: "mc", amount: costMC }, new_level: nextLevel });
    }

    if (method === "stars") {
      const costStars = Math.ceil(costMC / MC_PER_STAR);
      if (Number(user.stars_balance) < costStars) return res.status(400).json({ ok: false, error: "insufficient_stars" });
      await query(`UPDATE users SET stars_balance = stars_balance - $1, pickaxe_level = $2 WHERE id = $3`, [costStars, nextLevel, user.id]);
      return res.json({ ok: true, paid: { method: "stars", amount: costStars }, new_level: nextLevel });
    }

    return res.status(400).json({ ok: false, error: "invalid_method" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "internal" });
  }
});

export default router;
