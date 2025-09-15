export function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env:${name}`);
  return v;
}
