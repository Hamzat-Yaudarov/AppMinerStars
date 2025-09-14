import express from "express";
import { getAuthorizedUser } from "../utils/twa.js";
import { query } from "../db/pool.js";

const router = express.Router();

const MC_VALUES = { coal: 1, copper: 2, iron: 4, gold: 5, diamond: 7 };
const CHANCES = { coal: 1.0, copper: 0.45, iron: 0.25, gold: 0.12, diamond: 0.09 };
const LIMITS = { 1: 350, 2: 450, 3: 700, 4: 900, 5: 1150, 6: 1400, 7: 1700, 8: 2250, 9: 2400, 10: 2750 };
const RANGES = {
  coal: [
    null,
    [85, 480], [182, 582], [279, 684], [377, 787], [474, 889], [571, 991], [668, 1093], [766, 1196], [863, 1298], [960, 1400]
  ],
  copper: [
    null,
    [36, 78], [49, 93], [63, 107], [76, 122], [89, 137], [103, 151], [116, 166], [129, 180], [143, 195], [156, 210]
  ],
  iron: [
    null,
    [14, 24], [17, 30], [21, 37], [25, 44], [29, 51], [33, 59], [37, 66], [41, 74], [47, 82], [48, 90]
  ],
  gold: [
    null,
    [6, 9], [8, 11], [10, 14], [11, 17], [13, 20], [14, 23], [16, 26], [17, 29], [19, 33], [18, 38]
  ],
  diamond: [
    null,
    [1, 3], [2, 4], [2, 5], [3, 5], [3, 6], [4, 7], [4, 8], [5, 8], [5, 9], [6, 10]
  ]
};

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function calculateDrop(level) {
  const drop = { coal: 0, copper: 0, iron: 0, gold: 0, diamond: 0 };
  for (const res of Object.keys(drop)) {
    const [min, max] = RANGES[res][level];
    if (res === "coal" || Math.random() < CHANCES[res]) {
      drop[res] = randInt(min, max);
    }
  }
  return drop;
}

function dropToMC(drop) {
  return Object.entries(drop).reduce((s, [k, v]) => s + v * MC_VALUES[k], 0);
}

function clampToLimit(drop, limit) {
  let total = dropToMC(drop);
  if (total <= limit) return drop;
  const factor = limit / total;
  const keys = Object.keys(drop);
  const adjusted = {};
  for (const k of keys) adjusted[k] = Math.floor(drop[k] * factor);
  // If still underfilled due to floors, greedily add units with least MC first
  let remaining = limit - dropToMC(adjusted);
  const sorted = keys.sort((a, b) => MC_VALUES[a] - MC_VALUES[b]);
  let idx = 0;
  while (remaining >= MC_VALUES[sorted[0]]) {
    const k = sorted[idx % sorted.length];
    if (remaining >= MC_VALUES[k]) {
      adjusted[k] += 1;
      remaining -= MC_VALUES[k];
    }
    idx++;
    if (idx > 100000) break; // safety
  }
  return adjusted;
}

router.post("/dig", async (req, res) => {
  try {
    const initData = req.header("X-Telegram-InitData") || req.header("authorization")?.replace(/^twa\s+/i, "") || "";
    const tgUser = getAuthorizedUser(initData, process.env.TG_BOT_TOKEN);
    if (!tgUser) return res.status(401).json({ ok: false, error: "unauthorized" });

    const tgId = String(tgUser.id);
    const ures = await query("SELECT id, pickaxe_level, last_dig_at FROM users WHERE telegram_id = $1 OR tg_id = $1", [tgId]);
    if (ures.rowCount === 0) return res.status(403).json({ ok: false, error: "no_user" });
    const user = ures.rows[0];

    if (user.pickaxe_level <= 0) return res.status(400).json({ ok: false, error: "no_pickaxe" });

    const now = new Date();
    const last = user.last_dig_at ? new Date(user.last_dig_at) : null;
    if (last && now.getTime() - last.getTime() < 3 * 60 * 60 * 1000) {
      const remainMs = 3 * 60 * 60 * 1000 - (now.getTime() - last.getTime());
      return res.status(429).json({ ok: false, error: "cooldown", remain_ms: remainMs });
    }

    const level = Math.min(10, Math.max(1, user.pickaxe_level));
    const rawDrop = calculateDrop(level);
    const limited = clampToLimit(rawDrop, LIMITS[level]);
    const totalMC = dropToMC(limited);

    await query(
      `UPDATE resources SET coal = coal + $1, copper = copper + $2, iron = iron + $3, gold = gold + $4, diamond = diamond + $5 WHERE user_id = $6`,
      [limited.coal, limited.copper, limited.iron, limited.gold, limited.diamond, user.id]
    );
    await query(`UPDATE users SET last_dig_at = now() WHERE id = $1`, [user.id]);

    res.json({ ok: true, drop: limited, total_mc: totalMC, limit: LIMITS[level] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "internal" });
  }
});

// Sell endpoint
router.post("/sell", async (req, res) => {
  try {
    const initData = req.header("X-Telegram-InitData") || req.header("authorization")?.replace(/^twa\s+/i, "") || "";
    const tgUser = getAuthorizedUser(initData, process.env.TG_BOT_TOKEN);
    if (!tgUser) return res.status(401).json({ ok: false, error: "unauthorized" });

    const { resource, amount } = req.body || {};
    if (!resource || !["coal","copper","iron","gold","diamond"].includes(resource)) return res.status(400).json({ ok: false, error: "invalid_resource" });

    const tgId = String(tgUser.id);
    const ures = await query("SELECT id FROM users WHERE telegram_id = $1 OR tg_id = $1", [tgId]);
    if (ures.rowCount === 0) return res.status(403).json({ ok: false, error: "no_user" });
    const user = ures.rows[0];

    const rres = await query(`SELECT coal, copper, iron, gold, diamond FROM resources WHERE user_id = $1`, [user.id]);
    const resources = rres.rows[0];
    if (!resources) return res.status(500).json({ ok: false, error: "no_resources" });

    const prices = MC_VALUES; // per-unit MC
    let toSell = 0;
    if (amount === "all") {
      toSell = resources[resource];
    } else {
      const n = Number(amount);
      if (!Number.isFinite(n) || n <= 0) return res.status(400).json({ ok: false, error: "invalid_amount" });
      toSell = Math.floor(n);
    }

    if (toSell <= 0) return res.status(400).json({ ok: false, error: "nothing_to_sell" });
    if (resources[resource] < toSell) return res.status(400).json({ ok: false, error: "not_enough_resource" });

    const mcGain = toSell * prices[resource];

    // Deduct resource and add mines_coins
    await query(`UPDATE resources SET ${resource} = ${resource} - $1 WHERE user_id = $2`, [toSell, user.id]);
    await query(`UPDATE users SET mines_coins = mines_coins + $1 WHERE id = $2`, [mcGain, user.id]);

    res.json({ ok: true, sold: { resource, amount: toSell }, mc_gain: mcGain });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "internal" });
  }
});

export default router;
