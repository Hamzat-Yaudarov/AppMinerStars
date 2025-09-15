import { Bot, InlineKeyboard, webhookCallback } from "grammy";

const token = process.env.TG_BOT_TOKEN;
if (!token) throw new Error("TG_BOT_TOKEN is required");

export const bot = new Bot(token);

// Handlers
bot.command("start", async (ctx) => {
  const user = ctx.from;
  console.log('Received /start from', user.id, user.username);
  const webAppUrl = (process.env.BASE_URL || "").replace(/\/$/, "");
  const kb = new InlineKeyboard().webApp("Play", `${webAppUrl}/miniapp/`);

  const welcome = [
    `Добро пожаловать в Mines Stars, ${user.first_name || "игрок"}!`,
    "Добывай руду, улучшай кирку, открывай кейсы и поднимайся в рейтингах.",
    "Нажми Play, чтобы открыть MiniApp."
  ].join("\n\n");

  try {
    await ctx.reply(welcome, { reply_markup: kb });
    console.log('/start reply sent to', user.id);
  } catch (e) {
    console.error("/start reply error", e);
  }
});

// Payments: pre_checkout and successful payment handlers
bot.on('pre_checkout_query', async (ctx) => {
  try {
    await ctx.answerPreCheckoutQuery(true);
    console.log('Pre-checkout answered for', ctx.from?.id);
  } catch (e) {
    console.error('pre_checkout_query handler error', e);
  }
});

bot.on('message', async (ctx) => {
  try {
    const msg = ctx.message;
    if (msg && msg.successful_payment) {
      const sp = msg.successful_payment;
      console.log('Received successful_payment from', ctx.from?.id, sp);
      // payload should include action and amount
      let payload = null;
      try { payload = JSON.parse(sp.invoice_payload); } catch { payload = null; }
      if (payload && payload.action === 'buy_stars') {
        const amount = Number(payload.amount) || Math.floor((sp.total_amount || 0) / 100);
        // credit user
        try {
          const { query } = await import('../db/pool.js');
          const { findUserByTelegramId } = await import('../utils/users.js');
          const tg = String(ctx.from.id);
          const ures = await findUserByTelegramId(tg, 'id');
          if (ures.rowCount === 0) {
            console.warn('successful_payment: user not found', tg); return;
          }
          const uid = ures.rows[0].id;
          await query('UPDATE users SET stars_balance = stars_balance + $1 WHERE id = $2', [amount, uid]);
          await query('INSERT INTO transactions (user_id, kind, stars_amount, mc_amount, meta) VALUES ($1,$2,$3,$4,$5)', [uid, 'deposit', amount, null, JSON.stringify({ provider: 'telegram_stars', payment: sp })]);
          console.log('Credited', amount, 'stars to user', uid);
        } catch (e) { console.error('failed to credit user after successful_payment', e); }
      }
    }
  } catch (e) { console.error('message handler error', e); }
});

import express from "express";

// Express router handler for webhook POSTs
const router = express.Router();
router.post("/", express.json(), async (req, res) => {
  try {
    if (!bot.botInfo) {
      try { await bot.init(); } catch (e) { console.warn('bot.init failed in webhook', e?.message || e); }
    }
    await bot.handleUpdate(req.body);
    res.sendStatus(200);
  } catch (err) {
    console.error("bot webhook handler error", err);
    res.sendStatus(500);
  }
});

export const webhookCallbackInstance = router;

// Helper to ensure webhook set
export async function ensureWebhook(url) {
  await bot.api.setWebhook(url);
}

// In case of local dev (no BASE_URL), app.js will start long polling via bot.start()
