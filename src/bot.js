const { Telegraf, Markup } = require('telegraf');
const { upsertPlayer, updateResources, getWithdrawal, updateWithdrawal, countCompletedWithdrawals, pool } = require('./db');

const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN;
const BASE_URL = process.env.BASE_URL;
const BOT_USERNAME = process.env.BOT_USERNAME;

let botInstance = null;
const pendingRejects = new Map(); // adminId -> withdrawalId

async function startBot(app, webhookUrl) {
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
      // If user opened bot with start payload like topup_250_123, launch invoice
      const payload = (ctx.startPayload || (ctx.message && ctx.message.text && ctx.message.text.split(' ')[1])) || '';
      if (payload && payload.startsWith('topup_')){
        const parts = payload.split('_');
        const amount = Number(parts[1]) || 0;
        try{
          await ctx.replyWithInvoice({
            title: `${amount} игровых звёзд`,
            description: `Пополнение баланса в MineStars на ${amount}⭐`,
            payload,
            provider_token: '',
            currency: 'XTR',
            prices: [{ label: `${amount}⭐`, amount }]
          });
          return;
        }catch(e){ console.warn('replyWithInvoice failed on start payload', e); }
      }
      const text = 'Добро пожаловать в MineStars! Нажмите кнопку ниже, чтобы открыть MiniApp.';
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

  // Buy commands to create Stars invoices (users can use in bot chat if WebApp payments fail)
  const buyAmounts = [100,250,500,1000];
  buyAmounts.forEach(a=>{
    bot.command(`buy${a}`, (ctx)=>{
      try{
        return ctx.replyWithInvoice({
          title: `${a} игровых звёзд`,
          description: `Пополнение баланса в MineStars на ${a}⭐`,
          payload: `topup_${a}_${Date.now()}`,
          provider_token: '',
          currency: 'XTR',
          prices: [{ label: `${a}⭐`, amount: a }]
        });
      }catch(e){ console.warn('replyWithInvoice failed', e); return ctx.reply('Оплата недоступна.'); }
    });
  });

  // Accept pre-checkout queries for Stars invoices
  bot.on('pre_checkout_query', (ctx) => {
    try{ ctx.answerPreCheckoutQuery(true); }catch(e){ console.warn('pre_checkout_query failed', e); }
  });

  // If webhookUrl and app provided, set webhook and register route
  if (app && webhookUrl) {
    try{
      const hookPath = `/telegraf/${TG_BOT_TOKEN}`;
      const fullUrl = webhookUrl.replace(/\/$/, '') + hookPath;
      (async ()=>{
        try{ await bot.telegram.setWebhook(fullUrl); console.log('Webhook set to', fullUrl); }catch(e){ console.warn('setWebhook failed', e); }
      })();
      app.post(hookPath, async (req, res) => {
        try{
          await bot.handleUpdate(req.body);
          res.sendStatus(200);
        }catch(e){
          console.error('handleUpdate failed', e);
          // If an error happens after headers sent, avoid crashing
          try{ res.sendStatus(500); }catch(_){ /* ignore headers already sent */ }
        }
      });
      console.log('Webhook route registered at', hookPath);
    }catch(e){ console.warn('webhook registration failed', e); }
  }

  bot.on('successful_payment', async (ctx) => {
    try{
      const userId = ctx.from && ctx.from.id;
      const amount = ctx.message && ctx.message.successful_payment && ctx.message.successful_payment.total_amount;
      const payload = ctx.message && ctx.message.successful_payment && ctx.message.successful_payment.invoice_payload;
      const starsToCredit = Number(amount) || 0;
      if (userId && starsToCredit>0){
        await updateResources(userId, { stars: starsToCredit });
        await ctx.reply(`Баланс пополнен: +${starsToCredit}`);
      } else {
        await ctx.reply('Оплата получена, но не удалось обновить баланс.');
      }
    }catch(e){ console.error('successful_payment handler error', e); }
  });

  // Handle admin inline actions on withdrawals
  bot.on('callback_query', async (ctx) => {
    try{
      const data = ctx.callbackQuery && ctx.callbackQuery.data;
      const adminId = ctx.from && ctx.from.id;
      if (!data) return ctx.answerCbQuery('No data');
      if (data.startsWith('withdraw:approve:')){
        const id = Number(data.split(':')[2]);
        const w = await getWithdrawal(id);
        if (!w) return ctx.answerCbQuery('Заявка не найдена');
        await updateWithdrawal(id, { status: 'completed', admin_id: adminId, processed_at: new Date() });
        const num = await countCompletedWithdrawals();
        try{ await bot.telegram.sendMessage('@zazarara3', `Выполнена заявка #${num} ID:${w.id} от ${w.telegram_id} type:${w.type} amount:${w.amount || ''}`); }catch(e){ console.warn('notify complete failed', e); }
        try{ await bot.telegram.sendMessage(w.telegram_id, `Ваша заявка ${w.id} помечена как выполненная.`); }catch(e){}
        return ctx.answerCbQuery('Отмечено как выполнено');
      }
      if (data.startsWith('withdraw:reject:')){
        const id = Number(data.split(':')[2]);
        pendingRejects.set(adminId, id);
        await ctx.answerCbQuery('Отправьте причину отклонения в ответном сообщении. Или нажмите «Отклонить (с возвратом)» если хотите вернуть средства.');
        return;
      }
      if (data.startsWith('withdraw:reject_refund:')){
        const id = Number(data.split(':')[2]);
        const w = await getWithdrawal(id);
        if (!w) return ctx.answerCbQuery('Заявка не найдена');
        await updateWithdrawal(id, { status: 'rejected', admin_id: adminId, processed_at: new Date(), admin_comment: 'Отклонено (авто, с возвратом)' });
        // refund
        if (w.type === 'stars'){
          await updateResources(w.telegram_id, { stars: Number(w.amount||0) + Number(w.fee||0) });
        } else if (w.type === 'nft'){
          await pool.query('insert into nft_owned (telegram_id, nft_type, url) values ($1,$2,$3)', [w.telegram_id, w.nft_type, w.nft_url]);
        }
        try{ await bot.telegram.sendMessage('@zazarara3', `Отклонена (с возвратом) заявка ID:${w.id} от ${w.telegram_id}`); }catch(e){ console.warn('notify reject failed', e); }
        try{ await bot.telegram.sendMessage(w.telegram_id, `Ваша заявка ${w.id} отклонена. Средства/ NFT возвращены.`); }catch(e){}
        return ctx.answerCbQuery('Отклонено и возвращено');
      }
    }catch(e){ console.error('callback_query handler error', e); try{ ctx.answerCbQuery('Ошибка'); }catch(_){} }
  });

  // Admin reply flow for rejections
  bot.on('message', async (ctx) => {
    try{
      const adminId = ctx.from && ctx.from.id;
      if (!pendingRejects.has(adminId)) return;
      const id = pendingRejects.get(adminId);
      const text = ctx.message && ctx.message.text || '';
      pendingRejects.delete(adminId);
      const w = await getWithdrawal(id);
      if (!w) return await ctx.reply('Заявка не найдена.');
      const wantsRefund = /REFUND/i.test(text);
      const reason = text.replace(/REFUND/i, '').trim();
      const updates = { status: 'rejected', admin_comment: reason || null, admin_id: adminId, processed_at: new Date() };
      await updateWithdrawal(id, updates);
      if (wantsRefund){
        if (w.type === 'stars'){
          await updateResources(w.telegram_id, { stars: Number(w.amount||0) + Number(w.fee||0) });
        } else if (w.type === 'nft'){
          await pool.query('insert into nft_owned (telegram_id, nft_type, url) values ($1,$2,$3)', [w.telegram_id, w.nft_type, w.nft_url]);
        }
      }
      try{ await bot.telegram.sendMessage('@zazarara3', `Отклонена заявка ID:${w.id} от ${w.telegram_id} reason:${reason || ''} refund:${wantsRefund}`); }catch(e){ console.warn('notify reject failed', e); }
      try{ await bot.telegram.sendMessage(w.telegram_id, `Ваша заявка ${w.id} отклонена. Причина: ${reason}`); }catch(e){}
      return;
    }catch(e){ console.error('admin reject flow error', e); }
  });

  // If webhook isn't configured, launch polling; otherwise don't launch polling
  if (!app || !webhookUrl) {
    try{
      await bot.launch();
      console.log(`Bot @${BOT_USERNAME || ''} started (polling)`);
    }catch(e){
      console.warn('Bot launch failed (polling):', e && e.response && e.response.description ? e.response.description : (e && e.message) || e);
      // continue without crashing
    }
  } else {
    console.log(`Bot ready (webhook mode)`);
  }

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
  return bot;
}

async function sendAdminMessage(chat, text, extra){
  if (!botInstance) { console.warn('Bot not ready, cannot send admin message', chat, text); return null; }
  try{ return await botInstance.telegram.sendMessage(chat, text, extra || {}); }catch(e){ console.error('sendAdminMessage failed', e); return null; }
}

async function sendTopupLink(telegramId, payload, amount){
  if (!botInstance) return null;
  try{
    const url = `https://t.me/${BOT_USERNAME}?start=${encodeURIComponent(payload)}`;
    const text = `Вы запросили пополнение ${amount}⭐. Нажмите кнопку, чтобы открыть бота и оплатить.`;
    return await botInstance.telegram.sendMessage(telegramId, text, { reply_markup: JSON.stringify({ inline_keyboard: [[{ text: 'Оплатить в боте', url }]] }) });
  }catch(e){ console.error('sendTopupLink failed', e); return null; }
}

module.exports = { startBot, sendAdminMessage, sendTopupLink, getBot: ()=>botInstance };
