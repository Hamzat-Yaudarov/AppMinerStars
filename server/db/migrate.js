import { query } from "./pool.js";

const schemaSql = `
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  telegram_id BIGINT UNIQUE NOT NULL,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  referrer_user_id BIGINT REFERENCES users(id),
  stars_balance BIGINT NOT NULL DEFAULT 0,
  mines_coins BIGINT NOT NULL DEFAULT 0,
  pickaxe_level INT NOT NULL DEFAULT 0,
  last_dig_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS resources (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  coal BIGINT NOT NULL DEFAULT 0,
  copper BIGINT NOT NULL DEFAULT 0,
  iron BIGINT NOT NULL DEFAULT 0,
  gold BIGINT NOT NULL DEFAULT 0,
  diamond BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS withdrawals (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- 'stars' or 'nft'
  amount BIGINT, -- amount in stars (for type=stars)
  nft_id TEXT, -- external id/link for nft
  fee BIGINT NOT NULL DEFAULT 0,
  net_amount BIGINT,
  status TEXT NOT NULL DEFAULT 'pending',
  admin_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transactions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, -- deposit, withdraw, sale, reward
  stars_amount BIGINT,
  mc_amount BIGINT,
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION trg_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_timestamp_users ON users;
CREATE TRIGGER set_timestamp_users
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE PROCEDURE trg_set_timestamp();

DROP TRIGGER IF EXISTS set_timestamp_resources ON resources;
CREATE TRIGGER set_timestamp_resources
BEFORE UPDATE ON resources
FOR EACH ROW
EXECUTE PROCEDURE trg_set_timestamp();
`;

export async function initDb() {
  await query(schemaSql);
}
