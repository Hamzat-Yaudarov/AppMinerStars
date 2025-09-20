const { Pool } = require('pg');

const connectionString = process.env.NEON_DATABASE_URL;
if (!connectionString) {
  console.warn('NEON_DATABASE_URL is not set. Database operations will fail.');
}

const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });

async function initDb() {
  await pool.query(`
    create table if not exists players (
      telegram_id bigint primary key,
      username text,
      pickaxe_level int not null default 0,
      stars bigint not null default 0,
      mcoin bigint not null default 0,
      coal int not null default 0,
      copper int not null default 0,
      iron int not null default 0,
      gold int not null default 0,
      diamond int not null default 0,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create or replace function set_updated_at()
    returns trigger as $$
    begin
      new.updated_at = now();
      return new;
    end;
    $$ language plpgsql;
    drop trigger if exists trg_players_updated on players;
    create trigger trg_players_updated before update on players
    for each row execute procedure set_updated_at();
  `);
}

async function upsertPlayer({ telegram_id, username }) {
  const res = await pool.query(
    `insert into players (telegram_id, username)
     values ($1, $2)
     on conflict (telegram_id) do update set username = excluded.username
     returning *`,
    [telegram_id, username]
  );
  return res.rows[0];
}

async function getPlayer(telegram_id) {
  const res = await pool.query('select * from players where telegram_id = $1', [telegram_id]);
  return res.rows[0] || null;
}

async function updateResources(telegram_id, delta, extra = {}) {
  const fields = [];
  const values = [];
  let idx = 1;
  function pushField(name, inc) {
    fields.push(`${name} = ${name} + $${idx++}`);
    values.push(inc);
  }
  for (const key of ['coal','copper','iron','gold','diamond','stars','mcoin']) {
    if (delta[key]) pushField(key, delta[key]);
  }
  for (const [k,v] of Object.entries(extra)) {
    fields.push(`${k} = $${idx++}`);
    values.push(v);
  }
  values.push(telegram_id);
  const sql = `update players set ${fields.join(', ')} where telegram_id = $${idx} returning *`;
  const res = await pool.query(sql, values);
  return res.rows[0];
}

module.exports = { pool, initDb, upsertPlayer, getPlayer, updateResources };
