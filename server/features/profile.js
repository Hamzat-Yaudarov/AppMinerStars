import express from "express";
import { getAuthorizedUser } from "../utils/twa.js";
import { pool, query } from "../db/pool.js";

const router = express.Router();

async function ensureUser(telegramUser) {
  const tgId = BigInt(telegramUser.id);

  // detect which telegram id column exists (telegram_id or tg_id or both)
  const cols = (await query(`SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name IN ('telegram_id','tg_id')`)).rows.map(r=>r.column_name);
  const hasTelegramId = cols.includes('telegram_id');
  const hasTgId = cols.includes('tg_id');

  // try to find existing user by either column
  const whereClauses = [];
  const params = [tgId];
  if (hasTelegramId) whereClauses.push('telegram_id = $1');
  if (hasTgId) whereClauses.push('tg_id = $1');
  const where = whereClauses.length ? `WHERE ${whereClauses.join(' OR ')}` : '';

  const found = where ? (await query(`SELECT id, pickaxe_level, stars_balance, mines_coins FROM users ${where} LIMIT 1`, params)) : null;
  if (found && found.rowCount > 0) {
    // update profile fields
    const fields = [];
    const vals = [];
    let idx = 1;
    if (telegramUser.username) { fields.push(`username = $${idx++}`); vals.push(telegramUser.username); }
    if (telegramUser.first_name) { fields.push(`first_name = $${idx++}`); vals.push(telegramUser.first_name); }
    if (telegramUser.last_name) { fields.push(`last_name = $${idx++}`); vals.push(telegramUser.last_name); }
    if (fields.length) {
      vals.push(found.rows[0].id);
      await query(`UPDATE users SET ${fields.join(', ')} WHERE id = $${vals.length}`, vals);
    }
    return found.rows[0];
  }

  // not found -> insert. Build insert with available columns
  const insertCols = [];
  const insertVals = [];
  const placeholders = [];
  let i = 1;
  if (hasTelegramId) { insertCols.push('telegram_id'); insertVals.push(tgId); placeholders.push(`$${i++}`); }
  if (hasTgId) { insertCols.push('tg_id'); insertVals.push(tgId); placeholders.push(`$${i++}`); }
  if (telegramUser.username) { insertCols.push('username'); insertVals.push(telegramUser.username); placeholders.push(`$${i++}`); }
  if (telegramUser.first_name) { insertCols.push('first_name'); insertVals.push(telegramUser.first_name); placeholders.push(`$${i++}`); }
  if (telegramUser.last_name) { insertCols.push('last_name'); insertVals.push(telegramUser.last_name); placeholders.push(`$${i++}`); }

  // fallback: if no telegram columns exist, insert without them (but then cannot map user)
  const insertSql = `INSERT INTO users (${insertCols.join(',')}) VALUES (${placeholders.join(',')}) RETURNING id, pickaxe_level, stars_balance, mines_coins`;
  const res = await query(insertSql, insertVals);
  const user = res.rows[0];

  // ensure resources row
  await query(`INSERT INTO resources (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, [user.id]);
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
