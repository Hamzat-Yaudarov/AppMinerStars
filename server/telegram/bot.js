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

// Payments: handle pre_checkout_query and successful_payment for Stars (XTR)
import { query } from "../db/pool.js";
import { ensureUserFromTelegram } from "../utils/users.js";

bot.on('pre_checkout_query', async (ctx) => {
  try {
    await ctx.answerPreCheckoutQuery(true);
  } catch (e) {
    console.error('pre_checkout_query handling failed', e);
  }
});

bot.on('message', async (ctx) => {
  try {
    const msg = ctx.message;
    if (msg && msg.successful_payment) {
      const sp = msg.successful_payment;
      // invoice_payload expected format: buy_stars:<amount>
      const payload = sp.invoice_payload || '';
      if (payload.startsWith('buy_stars:')) {
        const parts = payload.split(':');
        const amount = Number(parts[1]) || 0;
        const tgUser = ctx.from;
        const user = await ensureUserFromTelegram(tgUser);
        if (!user) {
          console.warn('Could not ensure user for successful_payment', tgUser.id);
          return;
        }
        // credit stars
        await query('UPDATE users SET stars_balance = stars_balance + $1 WHERE id = $2', [amount, user.id]);
        await query('INSERT INTO transactions (user_id, kind, stars_amount, mc_amount, meta) VALUES ($1,$2,$3,$4,$5)', [user.id, 'deposit', amount, null, JSON.stringify({ provider: 'stars', msg_id: msg.message_id })]);
        // notify user
        try { await ctx.reply(`Покупка успешна — начислено ${amount}⭐`); } catch(e){console.error('reply after payment failed', e)}
        // notify admin
        try { const adminChat = process.env.ADMIN_WITHDRAW_CHAT || '@zazarara2'; await bot.api.sendMessage(adminChat, `Покупка Stars: ${amount}⭐\nПользователь: ${user.username ? `@${user.username}` : `${user.first_name} (${tgUser.id})`}`); } catch(e){console.error('admin notify failed', e)}
      }
    }
  } catch (e) { console.error('successful_payment handler failed', e); }
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
