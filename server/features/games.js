import express from "express";
import { getAuthorizedUser } from "../utils/twa.js";
import { query } from "../db/pool.js";

const router = express.Router();

// Ladder game: 7 levels, 8 choices per level. Broken count per level = level (1..7).
// Multipliers: level1=1.14, level2=1.28, level3=1.42 ... +0.14 per level
const LEVELS = 7;
const CHOICES = 8;

function multiplierForLevel(level) {
  return +(1.0 + 0.14 * level + 0.0).toFixed(2); // level starts at 1
}

router.post('/ladder', async (req, res) => {
  try {
    const initData = req.header("X-Telegram-InitData") || req.header("authorization")?.replace(/^twa\s+/i, "") || "";
    const tgUser = getAuthorizedUser(initData, process.env.TG_BOT_TOKEN);
    if (!tgUser) return res.status(401).json({ ok: false, error: 'unauthorized' });

    const userRow = await query('SELECT id, stars_balance FROM users WHERE telegram_id = $1', [BigInt(tgUser.id)]);
    if (userRow.rowCount === 0) return res.status(403).json({ ok: false, error: 'no_user' });
    const user = userRow.rows[0];

    const bet = Number(req.body?.bet || 0);
    const pick = Number(req.body?.pick || 0); // 1..8
    if (!Number.isFinite(bet) || bet <= 0) return res.status(400).json({ ok: false, error: 'invalid_bet' });
    if (!Number.isFinite(pick) || pick < 1 || pick > CHOICES) return res.status(400).json({ ok: false, error: 'invalid_pick' });
    if (user.stars_balance < bet) return res.status(400).json({ ok: false, error: 'insufficient_stars' });

    // Deduct bet immediately
    await query('UPDATE users SET stars_balance = stars_balance - $1 WHERE id = $2', [bet, user.id]);

    let currentBet = bet;
    const history = [];
    for (let level = 1; level <= LEVELS; level++) {
      // choose broken positions
      const broken = new Set();
      while (broken.size < level) broken.add(Math.floor(Math.random() * CHOICES) + 1);
      const broke = broken.has(pick);
      const mult = multiplierForLevel(level);
      if (broke) {
        history.push({ level, result: 'lose', broken: Array.from(broken) });
        // user loses bet, done
        return res.json({ ok: true, result: 'lost', history, final_stars: (await query('SELECT stars_balance FROM users WHERE id = $1', [user.id])).rows[0].stars_balance });
      } else {
        currentBet = +(currentBet * mult).toFixed(2);
        history.push({ level, result: 'win', multiplier: mult, value: currentBet, broken: Array.from(broken) });
        // auto-continue until end; player can cash out by calling another endpoint — in this simplified flow we simulate until level 7 and then add winnings to balance
      }
    }

    // Survived all levels
    const winStars = Math.floor(currentBet);
    await query('UPDATE users SET stars_balance = stars_balance + $1 WHERE id = $2', [winStars, user.id]);
    const final = (await query('SELECT stars_balance FROM users WHERE id = $1', [user.id])).rows[0].stars_balance;
    return res.json({ ok: true, result: 'win', history, win: winStars, final_stars: final });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'internal' });
  }
});

export default router;
