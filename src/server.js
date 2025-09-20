const express = require('express');
const path = require('path');
const { initDb, upsertPlayer, getPlayer, updateResources } = require('./db');
const { checkTelegramAuth } = require('./telegram-auth');

const BASE_URL = process.env.BASE_URL || '';
const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN || '';

const PRICES = { coal: 1, copper: 2, iron: 4, gold: 5, diamond: 7 };
const LIMITS = [350,450,700,900,1150,1400,1700,2250,2400,2750];
const COSTS = [10000,50000,100000,150000,200000,250000,300000,350000,400000,500000];
const EXCHANGE_RATE = 200; // 200 MC = 1 Star

function authMiddleware(req, res, next) {
  const initData = req.query.initData || req.header('X-Telegram-InitData');
  const result = checkTelegramAuth(initData, TG_BOT_TOKEN);
  if (!result.ok) return res.status(401).json({ ok: false, error: result.error });
  req.tgUser = result.user;
  req.initData = initData;
  next();
}

function getQuantity(resource, level) {
  const ranges = {
    coal: [
      [85,480],[182,582],[279,684],[377,787],[474,889],[571,991],[668,1093],[766,1196],[863,1298],[960,1400]
    ],
    copper: [
      [36,78],[49,93],[63,107],[76,122],[89,137],[103,151],[116,166],[129,180],[143,195],[156,210]
    ],
    iron: [
      [14,24],[17,30],[21,37],[25,44],[29,51],[33,59],[37,66],[41,74],[47,82],[48,90]
    ],
    gold: [
      [6,9],[8,11],[10,14],[11,17],[13,20],[14,23],[16,26],[17,29],[19,33],[18,38]
    ],
    diamond: [
      [1,3],[2,4],[2,5],[3,5],[3,6],[4,7],[4,8],[5,8],[5,9],[6,10]
    ]
  };
  const arr = ranges[resource];
  const idx = Math.max(1, Math.min(10, level)) - 1;
  const [min, max] = arr[idx];
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getProbabilities(level) {
  const idx = Math.max(1, Math.min(10, level)) - 1;
  const coal = 0.90;
  const copper = [0.65,0.67,0.69,0.71,0.74,0.75,0.77,0.78,0.78,0.78][idx];
  const iron = [0.29,0.31,0.32,0.33,0.35,0.37,0.39,0.41,0.42,0.42][idx];
  const gold = [0.15,0.16,0.17,0.18,0.19,0.20,0.22,0.23,0.24,0.26][idx];
  const diamond = [0.09,0.10,0.11,0.11,0.12,0.13,0.14,0.15,0.16,0.17][idx];
  return { coal, copper, iron, gold, diamond };
}

function totalMC(drops){
  return Object.entries(drops).reduce((sum,[k,v])=>sum + (PRICES[k]||0)*v, 0);
}

function applyLimit(drops, level){
  const idx = Math.max(1, Math.min(10, level)) - 1;
  let budget = LIMITS[idx];
  if (!drops || !Object.keys(drops).length) return drops;
  const ordered = ['coal','copper','iron','gold','diamond'];
  const result = {};
  for (const key of ordered){
    const have = drops[key] || 0;
    if (!have) continue;
    const price = PRICES[key];
    const maxByBudget = Math.floor(budget / price);
    const take = Math.min(have, Math.max(0, maxByBudget));
    if (take > 0){
      result[key] = take;
      budget -= take * price;
    }
    if (budget <= 0) break;
  }
  return result;
}

async function createServer() {
  await initDb();
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.get('/health', (_, res) => res.send('ok'));

  app.use('/public', express.static(path.join(__dirname, '..', 'public')));

  app.get('/miniapp.html', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'miniapp.html'));
  });

  app.get('/api/auth', authMiddleware, async (req, res) => {
    const { id, username } = req.tgUser;
    const player = await upsertPlayer({ telegram_id: id, username: username || null });
    res.json({ ok: true, player, prices: PRICES, rate: EXCHANGE_RATE });
  });

  app.get('/api/profile', authMiddleware, async (req, res) => {
    const player = await getPlayer(req.tgUser.id);
    res.json({ ok: true, player });
  });

  app.post('/api/mine', authMiddleware, async (req, res) => {
    const player = await getPlayer(req.tgUser.id);
    if (!player) return res.status(404).json({ ok: false, error: 'player_not_found' });
    const level = Number(player.pickaxe_level) || 0;
    if (level < 1) return res.status(400).json({ ok: false, error: 'no_pickaxe' });

    const probs = getProbabilities(level);
    const drops = {};
    function roll(p) { return Math.random() < p; }
    if (roll(probs.coal)) drops.coal = getQuantity('coal', level);
    if (roll(probs.copper)) drops.copper = getQuantity('copper', level);
    if (roll(probs.iron)) drops.iron = getQuantity('iron', level);
    if (roll(probs.gold)) drops.gold = getQuantity('gold', level);
    if (roll(probs.diamond)) drops.diamond = getQuantity('diamond', level);

    if (Object.keys(drops).length === 0) {
      return res.json({ ok: true, drops: {}, player });
    }

    const limited = applyLimit(drops, level);
    if (Object.keys(limited).length === 0) {
      return res.json({ ok: true, drops: {}, player });
    }

    const updated = await updateResources(req.tgUser.id, limited);
    res.json({ ok: true, drops: limited, player: updated, mc_value: totalMC(limited), limit: LIMITS[Math.max(1, Math.min(10, level)) - 1] });
  });

  app.post('/api/exchange', authMiddleware, async (req, res) => {
    const { direction, amount } = req.body || {};
    const n = Math.floor(Number(amount) || 0);
    if (!['m2s','s2m'].includes(direction) || n <= 0) return res.status(400).json({ ok: false, error: 'bad_request' });
    const player = await getPlayer(req.tgUser.id);
    if (!player) return res.status(404).json({ ok: false, error: 'player_not_found' });
    if (direction === 'm2s') {
      const cost = n * EXCHANGE_RATE;
      if (player.mcoin < cost) return res.status(400).json({ ok: false, error: 'not_enough_mcoin' });
      const updated = await updateResources(player.telegram_id, { mcoin: -cost, stars: n });
      return res.json({ ok: true, player: updated });
    } else {
      if (player.stars < n) return res.status(400).json({ ok: false, error: 'not_enough_stars' });
      const gain = n * EXCHANGE_RATE;
      const updated = await updateResources(player.telegram_id, { mcoin: gain, stars: -n });
      return res.json({ ok: true, player: updated });
    }
  });

  app.post('/api/sell', authMiddleware, async (req, res) => {
    const q = req.body || {};
    const toSell = {};
    for (const k of ['coal','copper','iron','gold','diamond']) {
      const v = Math.floor(Number(q[k]) || 0);
      if (v < 0) return res.status(400).json({ ok: false, error: 'bad_request' });
      if (v > 0) toSell[k] = v;
    }
    if (Object.keys(toSell).length === 0) return res.status(400).json({ ok: false, error: 'nothing_to_sell' });

    const player = await getPlayer(req.tgUser.id);
    if (!player) return res.status(404).json({ ok: false, error: 'player_not_found' });
    for (const [k,v] of Object.entries(toSell)) {
      if (player[k] < v) return res.status(400).json({ ok: false, error: 'insufficient_'+k });
    }
    const gain = Object.entries(toSell).reduce((sum,[k,v])=> sum + (PRICES[k]||0)*v, 0);
    const neg = Object.fromEntries(Object.entries(toSell).map(([k,v])=>[k,-v]));
    neg.mcoin = gain;
    const updated = await updateResources(player.telegram_id, neg);
    res.json({ ok: true, player: updated, gain });
  });

  app.post('/api/shop/upgradePickaxe', authMiddleware, async (req, res) => {
    const player = await getPlayer(req.tgUser.id);
    if (!player) return res.status(404).json({ ok: false, error: 'player_not_found' });
    const current = Number(player.pickaxe_level) || 0;
    if (current >= 10) return res.status(400).json({ ok: false, error: 'max_level' });
    const next = current + 1;
    const cost = COSTS[next - 1];
    if (player.mcoin < cost) return res.status(400).json({ ok: false, error: 'not_enough_mcoin' });
    const updated = await updateResources(player.telegram_id, { mcoin: -cost }, { pickaxe_level: next });
    res.json({ ok: true, player: updated, level: next, cost });
  });

  return app;
}

module.exports = { createServer };
