import { Bot, InlineKeyboard, webhookCallback } from "grammy";

const token = process.env.TG_BOT_TOKEN;
if (!token) throw new Error("TG_BOT_TOKEN is required");

export const bot = new Bot(token);

// Handlers
bot.command("start", async (ctx) => {
  const user = ctx.from;
  const webAppUrl = (process.env.BASE_URL || "").replace(/\/$/, "");
  const kb = new InlineKeyboard().webApp("Play", `${webAppUrl}/miniapp/`);

  const welcome = [
    `Д��бро пожаловать в Mines Stars, ${user.first_name || "игрок"}!`,
    "Добывай руду, улучшай кирку, открывай кейсы и поднимайся в рейтингах.",
    "Нажми Play, чтобы открыть MiniApp."
  ].join("\n\n");

  try {
    await ctx.reply(welcome, { reply_markup: kb });
  } catch (e) {
    console.error("/start reply error", e);
  }
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
