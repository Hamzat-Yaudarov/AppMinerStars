import { query } from '../db/pool.js';

let _hasTgId = null;

async function detectTgIdColumn() {
  if (_hasTgId !== null) return _hasTgId;
  try {
    const res = await query("SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name = 'tg_id'");
    _hasTgId = res.rowCount > 0;
  } catch (e) {
    console.warn('Failed to detect tg_id column', e?.message || e);
    _hasTgId = false;
  }
  return _hasTgId;
}

export async function findUserByTelegramId(tgId, select = 'id') {
  const hasTg = await detectTgIdColumn();
  const fields = select;
  if (hasTg) {
    const q = `SELECT ${fields} FROM users WHERE telegram_id = $1 OR tg_id = $1`;
    return await query(q, [tgId]);
  }
  const q = `SELECT ${fields} FROM users WHERE telegram_id = $1`;
  return await query(q, [tgId]);
}

export async function ensureUserFromTelegram(tgUser) {
  // tgUser: { id, username, first_name, last_name }
  const tgId = String(tgUser.id);
  // try find
  const found = await findUserByTelegramId(tgId, 'id, username, first_name, last_name, pickaxe_level, stars_balance, mines_coins');
  if (found.rowCount > 0) return found.rows[0];
  // insert new user with available fields
  const cols = ['telegram_id'];
  const vals = [tgId];
  const placeholders = ['$1'];
  let idx = 2;
  if (tgUser.username) { cols.push('username'); vals.push(tgUser.username); placeholders.push(`$${idx++}`); }
  if (tgUser.first_name) { cols.push('first_name'); vals.push(tgUser.first_name); placeholders.push(`$${idx++}`); }
  if (tgUser.last_name) { cols.push('last_name'); vals.push(tgUser.last_name); placeholders.push(`$${idx++}`); }
  const sql = `INSERT INTO users (${cols.join(',')}) VALUES (${placeholders.join(',')}) RETURNING id, username, first_name, last_name, pickaxe_level, stars_balance, mines_coins`;
  const res = await query(sql, vals);
  const user = res.rows[0];
  // ensure resources
  await query('INSERT INTO resources (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [user.id]);
  return user;
}
