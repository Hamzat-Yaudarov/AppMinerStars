const { Telegraf, Markup } = require('telegraf');
const { upsertPlayer } = require('./db');

const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN;
const BASE_URL = process.env.BASE_URL;
const BOT_USERNAME = process.env.BOT_USERNAME;

async function startBot() {
  if (!TG_BOT_TOKEN) {
    console.warn('TG_BOT_TOKEN not set, bot will not start');
    return;
  }
  const bot = new Telegraf(TG_BOT_TOKEN, { handlerTimeout: 9_000 });

  bot.start(async (ctx) => {
    try {
      const user = ctx.from;
      await upsertPlayer({ telegram_id: user.id, username: user.username || null });
      const url = `${BASE_URL || ''}/miniapp.html`;
      const text = 'Добро пожаловать в MineStars! Нажмите ��нопку ниже, чтобы открыть MiniApp.';
      const keyboard = Markup.inlineKeyboard([
        Markup.button.webApp('Открыть игру', url)
      ]);
      await ctx.reply(text, keyboard);
    } catch (e) {
      console.error('start handler error', e);
      await ctx.reply('Произошла ошибка. Попробуйте позже.');
    }
  });

  // Optional command to share MiniApp link
  bot.command('app', (ctx) => {
    const url = `${BASE_URL || ''}/miniapp.html`;
    return ctx.reply(`Откройте игру: ${url}`);
  });

  await bot.launch();
  console.log(`Bot @${BOT_USERNAME || ''} started`);

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

module.exports = { startBot };
