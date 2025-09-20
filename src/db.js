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
      last_mined_at timestamptz,
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

    create table if not exists nft_pool (
      id bigserial primary key,
      nft_type text not null,
      url text not null,
      created_at timestamptz not null default now()
    );

    create table if not exists nft_owned (
      id bigserial primary key,
      telegram_id bigint not null,
      nft_type text not null,
      url text not null,
      obtained_at timestamptz not null default now()
    );
    create index if not exists idx_nft_owned_user on nft_owned(telegram_id);

    create table if not exists lesenka_sessions (
      telegram_id bigint primary key,
      stake int not null,
      started_at timestamptz not null default now(),
      current_level int not null default 1,
      cleared_levels int not null default 0,
      broken_map jsonb not null
    );

    create table if not exists withdrawals (
      id bigserial primary key,
      telegram_id bigint not null,
      type text not null,
      amount bigint,
      nft_type text,
      nft_url text,
      fee bigint default 0,
      status text not null default 'pending',
      admin_comment text,
      admin_id bigint,
      requested_at timestamptz not null default now(),
      processed_at timestamptz
    );

    create table if not exists topup_requests (
      id bigserial primary key,
      telegram_id bigint not null,
      amount bigint not null,
      payload text not null,
      status text not null default 'pending',
      created_at timestamptz not null default now()
    );
  `);
  // Ensure legacy databases get the last_mined_at column if missing
  try{
    await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS last_mined_at timestamptz`);
  }catch(e){ console.warn('failed to ensure last_mined_at column', e); }
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
  // If nothing to update, still touch updated_at to avoid SQL error and return current row
  if (fields.length === 0) {
    const res = await pool.query('update players set updated_at = now() where telegram_id = $1 returning *', [telegram_id]);
    return res.rows[0] || null;
  }
  values.push(telegram_id);
  const sql = `update players set ${fields.join(', ')} where telegram_id = $${idx} returning *`;
  const res = await pool.query(sql, values);
  return res.rows[0];
}

async function listOwnedNfts(telegram_id){
  const r = await pool.query('select id, nft_type, url, obtained_at from nft_owned where telegram_id=$1 order by id desc', [telegram_id]);
  return r.rows;
}

async function takeRandomNftOfType(nft_type){
  const client = await pool.connect();
  try{
    await client.query('begin');
    const r = await client.query('select id, url from nft_pool where nft_type=$1 order by random() limit 1 for update skip locked', [nft_type]);
    if (r.rowCount === 0){ await client.query('rollback'); return null; }
    const row = r.rows[0];
    await client.query('delete from nft_pool where id=$1', [row.id]);
    await client.query('commit');
    return { id: row.id, url: row.url };
  } catch(e){ await client.query('rollback'); throw e; } finally { client.release(); }
}

async function grantNftToUser(telegram_id, nft_type, url){
  const r = await pool.query('insert into nft_owned (telegram_id, nft_type, url) values ($1,$2,$3) returning *', [telegram_id, nft_type, url]);
  return r.rows[0];
}

async function getLesenka(telegram_id){
  const r = await pool.query('select * from lesenka_sessions where telegram_id=$1', [telegram_id]);
  return r.rows[0] || null;
}

async function setLesenka(telegram_id, data){
  const r = await pool.query(`
    insert into lesenka_sessions (telegram_id, stake, current_level, cleared_levels, broken_map)
    values ($1,$2,$3,$4,$5)
    on conflict (telegram_id) do update
      set stake=excluded.stake,
          current_level=excluded.current_level,
          cleared_levels=excluded.cleared_levels,
          broken_map=excluded.broken_map
    returning *
  `, [telegram_id, data.stake, data.current_level, data.cleared_levels, data.broken_map]);
  return r.rows[0];
}

async function updateLesenka(telegram_id, patch){
  const current = await getLesenka(telegram_id);
  if (!current) return null;
  const data = { ...current, ...patch };
  const r = await pool.query(`
    update lesenka_sessions set stake=$1, current_level=$2, cleared_levels=$3, broken_map=$4 where telegram_id=$5 returning *
  `, [data.stake, data.current_level, data.cleared_levels, data.broken_map, telegram_id]);
  return r.rows[0];
}

async function deleteLesenka(telegram_id){
  await pool.query('delete from lesenka_sessions where telegram_id=$1', [telegram_id]);
}

// Withdrawals table and helpers
async function createWithdrawal({ telegram_id, type, amount, nft_type, nft_url, fee }){
  const r = await pool.query(`insert into withdrawals (telegram_id, type, amount, nft_type, nft_url, fee) values ($1,$2,$3,$4,$5,$6) returning *`, [telegram_id, type, amount || null, nft_type || null, nft_url || null, fee || 0]);
  return r.rows[0];
}
async function createTopupRequest({ telegram_id, amount, payload }){
  const r = await pool.query('insert into topup_requests (telegram_id, amount, payload) values ($1,$2,$3) returning *', [telegram_id, amount, payload]);
  return r.rows[0];
}
async function getWithdrawal(id){
  const r = await pool.query('select * from withdrawals where id=$1', [id]);
  return r.rows[0] || null;
}
async function countCompletedWithdrawals(){
  const r = await pool.query("select count(*)::int as cnt from withdrawals where status='completed'");
  return r.rows[0].cnt || 0;
}
async function updateWithdrawal(id, patch){
  const fields = [];
  const values = [];
  let idx = 1;
  for (const [k,v] of Object.entries(patch)){
    fields.push(`${k} = $${idx++}`); values.push(v);
  }
  if (fields.length === 0) return getWithdrawal(id);
  values.push(id);
  const sql = `update withdrawals set ${fields.join(', ')} where id = $${idx} returning *`;
  const r = await pool.query(sql, values);
  return r.rows[0];
}

module.exports = { pool, initDb, upsertPlayer, getPlayer, updateResources, listOwnedNfts, takeRandomNftOfType, grantNftToUser, getLesenka, setLesenka, updateLesenka, deleteLesenka, createWithdrawal, getWithdrawal, updateWithdrawal, countCompletedWithdrawals, createTopupRequest };
