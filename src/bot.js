const { Telegraf, Markup } = require('telegraf');
const { upsertPlayer, updateResources } = require('./db');

const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN;
const BASE_URL = process.env.BASE_URL;
const BOT_USERNAME = process.env.BOT_USERNAME;

let botInstance = null;

async function startBot() {
  if (!TG_BOT_TOKEN) {
    console.warn('TG_BOT_TOKEN not set, bot will not start');
    return null;
  }
  const bot = new Telegraf(TG_BOT_TOKEN, { handlerTimeout: 9_000 });
  botInstance = bot;

  bot.start(async (ctx) => {
    try {
      const user = ctx.from;
      await upsertPlayer({ telegram_id: user.id, username: user.username || null });
      const url = `${BASE_URL || ''}/miniapp.html`;
      const text = 'Добро пожаловать в MineStars! Нажмите кнопку ниже, чтобы открыть MiniApp.';
      const keyboard = Markup.inlineKeyboard([
        Markup.button.webApp('Открыть игру', url)
      ]);
      await ctx.reply(text, keyboard);
    } catch (e) {
      console.error('start handler error', e);
      await ctx.reply('Произошла ошиб��а. Попробуйте позже.');
    }
  });

  // Optional command to share MiniApp link
  bot.command('app', (ctx) => {
    const url = `${BASE_URL || ''}/miniapp.html`;
    return ctx.reply(`Откройте игру: ${url}`);
  });

  // Accept pre-checkout queries for Stars invoices
  bot.on('pre_checkout_query', (ctx) => {
    try{ ctx.answerPreCheckoutQuery(true); }catch(e){ console.warn('pre_checkout_query failed', e); }
  });

  bot.on('successful_payment', async (ctx) => {
    try{
      const userId = ctx.from && ctx.from.id;
      const amount = ctx.message && ctx.message.successful_payment && ctx.message.successful_payment.total_amount;
      const payload = ctx.message && ctx.message.successful_payment && ctx.message.successful_payment.invoice_payload;
      const starsToCredit = Number(amount) || 0;
      if (userId && starsToCredit>0){
        await updateResources(userId, { stars: starsToCredit });
        await ctx.reply(`Баланс пополнен: +${starsToCredit}★ (payload=${payload || ''})`);
      } else {
        await ctx.reply('Оплата получена, но не удалось обновить баланс.');
      }
    }catch(e){ console.error('successful_payment handler error', e); }
  });

  await bot.launch();
  console.log(`Bot @${BOT_USERNAME || ''} started`);

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
  return bot;
}

async function sendAdminMessage(chat, text, extra){
  if (!botInstance) { console.warn('Bot not ready, cannot send admin message', chat, text); return null; }
  try{ return await botInstance.telegram.sendMessage(chat, text, extra || {}); }catch(e){ console.error('sendAdminMessage failed', e); return null; }
}

module.exports = { startBot, sendAdminMessage, getBot: ()=>botInstance };
