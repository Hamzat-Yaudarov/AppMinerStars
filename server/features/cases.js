import express from "express";
import { getAuthorizedUser } from "../utils/twa.js";
import { query } from "../db/pool.js";

const router = express.Router();

// Case definitions
const CASES = {
  cheap: {
    cost_stars: 100,
    prizes: [
      { amt: 25, p: 0.10 },
      { amt: 50, p: 0.25 },
      { amt: 75, p: 0.30 },
      { amt: 150, p: 0.30 },
      { amt: 300, p: 0.05 }
    ]
  },
  premium: {
    cost_stars: 700,
    prizes: [
      { id: 'snoop_dogg', name: 'Snoop Dogg (NFT)', p: 0.66 },
      { id: 'swag_bag', name: 'Swag Bag (NFT)', p: 0.30 },
      { id: 'snoop_cigar', name: 'Snoop Cigar (NFT)', p: 0.03 },
      { id: 'low_rider', name: 'Low Rider (NFT)', p: 0.01 }
    ]
  }
};

function weightedPick(list) {
  const r = Math.random();
  let acc = 0;
  for (const item of list) {
    acc += item.p;
    if (r <= acc) return item;
  }
  return list[list.length - 1];
}

router.post('/open', async (req, res) => {
  try {
    const initData = req.header("X-Telegram-InitData") || req.header("authorization")?.replace(/^twa\s+/i, "") || "";
    const tgUser = getAuthorizedUser(initData, process.env.TG_BOT_TOKEN);
    if (!tgUser) return res.status(401).json({ ok: false, error: 'unauthorized' });

    const userRow = await query('SELECT id, stars_balance FROM users WHERE telegram_id = $1', [BigInt(tgUser.id)]);
    if (userRow.rowCount === 0) return res.status(403).json({ ok: false, error: 'no_user' });
    const user = userRow.rows[0];

    const { caseType } = req.body || {};
    if (!caseType || (caseType !== 'cheap' && caseType !== 'premium')) return res.status(400).json({ ok: false, error: 'invalid_case' });

    const def = CASES[caseType];
    if (user.stars_balance < def.cost_stars) return res.status(400).json({ ok: false, error: 'insufficient_stars' });

    // Deduct stars
    await query('UPDATE users SET stars_balance = stars_balance - $1 WHERE id = $2', [def.cost_stars, user.id]);

    // Determine prize
    if (caseType === 'cheap') {
      const prize = weightedPick(def.prizes);
      // add stars to user
      await query('UPDATE users SET stars_balance = stars_balance + $1 WHERE id = $2', [prize.amt, user.id]);
      return res.json({ ok: true, type: 'stars', prize: prize.amt });
    } else {
      const prize = weightedPick(def.prizes);
      // generate nft link/id
      const nftId = `${prize.id}_${Date.now()}_${Math.floor(Math.random()*9000+1000)}`;
      // store as a simple record in withdrawals table as placeholder OR in a separate table; for now return nft id
      return res.json({ ok: true, type: 'nft', prize: { id: prize.id, name: prize.name, nft_id: nftId } });
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'internal' });
  }
});

export default router;
