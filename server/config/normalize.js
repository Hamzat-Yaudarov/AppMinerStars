// Normalize environment variable names so deployments using alternate names still work
// This file should be imported as early as possible (from app.js)

// Telegram token: accept TG_BOT_TOKEN or TELEGRAM_BOT_TOKEN
if (!process.env.TG_BOT_TOKEN && process.env.TELEGRAM_BOT_TOKEN) {
  process.env.TG_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
}

// Neon DB URL: accept NEON_DATABASE_URL or DATABASE_URL
if (!process.env.NEON_DATABASE_URL && process.env.DATABASE_URL) {
  process.env.NEON_DATABASE_URL = process.env.DATABASE_URL;
}

// Admin / chats: multiple variants
if (!process.env.ADMIN_WITHDRAW_CHAT && process.env.ADMIN_REVIEW_CHAT) {
  process.env.ADMIN_WITHDRAW_CHAT = process.env.ADMIN_REVIEW_CHAT;
}
if (!process.env.ADMIN_WITHDRAW_COMPLETED_CHAT && process.env.ADMIN_DONE_CHAT) {
  process.env.ADMIN_WITHDRAW_COMPLETED_CHAT = process.env.ADMIN_DONE_CHAT;
}
if (!process.env.ADMIN_NFT_CHAT && process.env.ADMIN_NFT_REVIEW_CHAT) {
  process.env.ADMIN_NFT_CHAT = process.env.ADMIN_NFT_REVIEW_CHAT;
}

// Other common aliases
if (!process.env.ADMIN_ID && process.env.ADMIN) {
  process.env.ADMIN_ID = process.env.ADMIN;
}
if (!process.env.BOT_USERNAME && process.env.TELEGRAM_BOT_USERNAME) {
  process.env.BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME;
}

// If BASE_URL provided with trailing slash, strip it
if (process.env.BASE_URL) {
  process.env.BASE_URL = process.env.BASE_URL.replace(/\/$/, "");
}

// Log normalization in dev (avoid logging tokens in production)
if (process.env.NODE_ENV !== 'production') {
  console.log('ENV normalization complete');
}
