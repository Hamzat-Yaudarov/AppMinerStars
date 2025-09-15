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
