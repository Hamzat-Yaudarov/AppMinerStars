import pg from "pg";

const { Pool } = pg;

const connectionString = process.env.NEON_DATABASE_URL;
if (!connectionString) {
  console.warn("NEON_DATABASE_URL is not set. Database features will fail.");
}

export const pool = new Pool({ connectionString, max: 10, idleTimeoutMillis: 30000 });

export async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (duration > 200) {
    console.log("slow query", { duration, text });
  }
  return res;
}
