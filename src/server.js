const express = require('express');
const path = require('path');
const { initDb, upsertPlayer, getPlayer, updateResources, listOwnedNfts, takeRandomNftOfType, grantNftToUser, getLesenka, setLesenka, updateLesenka, deleteLesenka } = require('./db');
const { checkTelegramAuth } = require('./telegram-auth');

const BASE_URL = process.env.BASE_URL || '';
const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN || '';

const PRICES = { coal: 1, copper: 2, iron: 4, gold: 5, diamond: 7 };
const LIMITS = [350,450,700,900,1150,1400,1700,2250,2400,2750];
const COSTS = [10000,50000,100000,150000,200000,250000,300000,350000,400000,500000];
const EXCHANGE_RATE = 200; // 200 MC = 1 Star
const COOLDOWN_MS = 3 * 60 * 60 * 1000; // 3 hours
const ALLOWED_STAKES = [10,15,25,50,150,250,300,400,500];

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

function cooldownInfo(player){
  const last = player.last_mined_at ? new Date(player.last_mined_at).getTime() : 0;
  const nextAt = last ? last + COOLDOWN_MS : 0;
  const now = Date.now();
  const remainingMs = Math.max(0, nextAt - now);
  return { nextAvailableAt: nextAt || 0, remainingMs };
}

function lesenkaMultiplier(levelsCleared){
  if (!levelsCleared) return 0;
  return +(1.14 + 0.14 * (levelsCleared - 1)).toFixed(2);
}

function makeBrokenMap(){
  const map = {};
  for (let lvl=1; lvl<=7; lvl++){
    const broken = new Set();
    while (broken.size < lvl){
      broken.add(Math.floor(Math.random()*8));
    }
    map[lvl] = Array.from(broken);
  }
  return map;
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
    const cd = cooldownInfo(player);
    res.json({ ok: true, player, prices: PRICES, rate: EXCHANGE_RATE, cooldown: cd });
  });

  app.get('/api/profile', authMiddleware, async (req, res) => {
    const player = await getPlayer(req.tgUser.id);
    const cd = cooldownInfo(player || {});
    res.json({ ok: true, player, cooldown: cd });
  });

  app.get('/api/nft', authMiddleware, async (req, res) => {
    const items = await listOwnedNfts(req.tgUser.id);
    res.json({ ok: true, items });
  });

  app.post('/api/mine', authMiddleware, async (req, res) => {
    const player = await getPlayer(req.tgUser.id);
    if (!player) return res.status(404).json({ ok: false, error: 'player_not_found' });
    const level = Number(player.pickaxe_level) || 0;
    if (level < 1) return res.status(400).json({ ok: false, error: 'no_pickaxe' });

    const cd = cooldownInfo(player);
    if (cd.remainingMs > 0){
      return res.status(429).json({ ok: false, error: 'cooldown', nextAvailableAt: cd.nextAvailableAt, remainingMs: cd.remainingMs });
    }

    const probs = getProbabilities(level);
    const drops = {};
    function roll(p) { return Math.random() < p; }
    if (roll(probs.coal)) drops.coal = getQuantity('coal', level);
    if (roll(probs.copper)) drops.copper = getQuantity('copper', level);
    if (roll(probs.iron)) drops.iron = getQuantity('iron', level);
    if (roll(probs.gold)) drops.gold = getQuantity('gold', level);
    if (roll(probs.diamond)) drops.diamond = getQuantity('diamond', level);

    const limited = applyLimit(drops, level);

    const updated = await updateResources(req.tgUser.id, limited, { last_mined_at: new Date() });
    res.json({ ok: true, drops: limited, player: updated, mc_value: totalMC(limited), limit: LIMITS[Math.max(1, Math.min(10, level)) - 1], cooldown: cooldownInfo(updated) });
  });

  app.post('/api/exchange', authMiddleware, async (req, res) => {
    const { direction, amount } = req.body || {};
    const n = Math.floor(Number(amount) || 0);
    if (!['m2s','s2m'].includes(direction) || n <= 0) return res.status(400).json({ ok: false, error: 'bad_request' });
    const player = await getPlayer(req.tgUser.id);
    if (!player) return res.status(404).json({ ok: false, error: 'player_not_found' });
    if (direction === 'm2s') {
      const bal = Number(player.mcoin) || 0;
      const cost = n * EXCHANGE_RATE;
      if (bal < cost) return res.status(400).json({ ok: false, error: 'not_enough_mcoin' });
      const updated = await updateResources(player.telegram_id, { mcoin: -cost, stars: n });
      return res.json({ ok: true, player: updated });
    } else {
      const have = Number(player.stars) || 0;
      if (have < n) return res.status(400).json({ ok: false, error: 'not_enough_stars' });
      const gain = n * EXCHANGE_RATE;
      const updated = await updateResources(player.telegram_id, { mcoin: gain, stars: -n });
      return res.json({ ok: true, player: updated });
    }
  });

  app.post('/api/sellOne', authMiddleware, async (req, res) => {
    const { resource, mode, amount } = req.body || {};
    if (!['coal','copper','iron','gold','diamond'].includes(resource)) return res.status(400).json({ ok:false, error:'bad_resource' });
    const player = await getPlayer(req.tgUser.id);
    if (!player) return res.status(404).json({ ok:false, error:'player_not_found' });
    let qty = 0;
    const have = Number(player[resource]) || 0;
    if (mode === 'all') qty = have;
    else if (mode === 'part') qty = Math.floor(Number(amount)||0);
    else return res.status(400).json({ ok:false, error:'bad_request' });
    if (qty <= 0) return res.status(400).json({ ok:false, error:'nothing_to_sell' });
    if (qty > have) return res.status(400).json({ ok:false, error:'insufficient_'+resource });
    const gain = qty * (PRICES[resource]||0);
    const delta = { [resource]: -qty, mcoin: gain };
    const updated = await updateResources(player.telegram_id, delta);
    res.json({ ok:true, player: updated, gain, sold:{ [resource]: qty } });
  });

  app.post('/api/shop/upgradePickaxe', authMiddleware, async (req, res) => {
    const player = await getPlayer(req.tgUser.id);
    if (!player) return res.status(404).json({ ok: false, error: 'player_not_found' });
    const current = Number(player.pickaxe_level) || 0;
    if (current >= 10) return res.status(400).json({ ok: false, error: 'max_level' });
    const next = current + 1;
    const cost = COSTS[next - 1];
    const bal = Number(player.mcoin) || 0;
    if (bal < cost) return res.status(400).json({ ok: false, error: 'not_enough_mcoin' });
    const updated = await updateResources(player.telegram_id, { mcoin: -cost }, { pickaxe_level: next });
    res.json({ ok: true, player: updated, level: next, cost });
  });

  app.post('/api/shop/openCase', authMiddleware, async (req, res) => {
    const { caseId } = req.body || {};
    const player = await getPlayer(req.tgUser.id);
    if (!player) return res.status(404).json({ ok:false, error:'player_not_found' });
    if (caseId === 1){
      const cost = 100; // stars
      const have = Number(player.stars) || 0;
      if (have < cost) return res.status(400).json({ ok:false, error:'not_enough_stars' });
      const roll = Math.random();
      let reward;
      if (roll < 0.10) reward = 25; else if (roll < 0.35) reward = 50; else if (roll < 0.65) reward = 75; else if (roll < 0.95) reward = 150; else reward = 300;
      const updated = await updateResources(player.telegram_id, { stars: reward - cost });
      return res.json({ ok:true, player: updated, case: 1, starsWon: reward });
    } else if (caseId === 2){
      const cost = 700;
      const have = Number(player.stars) || 0;
      if (have < cost) return res.status(400).json({ ok:false, error:'not_enough_stars' });
      const roll = Math.random();
      let type;
      if (roll < 0.66) type = 'Snoop Dogg';
      else if (roll < 0.96) type = 'Swag Bag';
      else if (roll < 0.97) type = 'Snoop Cigar';
      else type = 'Low Rider';
      const nft = await takeRandomNftOfType(type);
      if (!nft){
        return res.status(409).json({ ok:false, error:'nft_unavailable', type });
      }
      const grant = await grantNftToUser(player.telegram_id, type, nft.url);
      const updated = await updateResources(player.telegram_id, { stars: -cost });
      return res.json({ ok:true, player: updated, case: 2, nft: { type, url: grant.url } });
    }
    return res.status(400).json({ ok:false, error:'bad_request' });
  });

  // Lesenka (Ladder) game
  app.get('/api/games/lesenka/state', authMiddleware, async (req, res)=>{
    const sess = await getLesenka(req.tgUser.id);
    res.json({ ok:true, session: sess ? { stake: Number(sess.stake), current_level: Number(sess.current_level), cleared_levels: Number(sess.cleared_levels) } : null, allowed: ALLOWED_STAKES });
  });

  app.post('/api/games/lesenka/start', authMiddleware, async (req, res)=>{
    const { stake } = req.body || {};
    const s = Number(stake)||0;
    if (!ALLOWED_STAKES.includes(s)) return res.status(400).json({ ok:false, error:'bad_stake' });
    const player = await getPlayer(req.tgUser.id);
    if (!player) return res.status(404).json({ ok:false, error:'player_not_found' });
    const have = Number(player.stars)||0;
    if (have < s) return res.status(400).json({ ok:false, error:'not_enough_stars' });
    const map = makeBrokenMap();
    await setLesenka(player.telegram_id, { stake: s, current_level: 1, cleared_levels: 0, broken_map: map });
    const updated = await updateResources(player.telegram_id, { stars: -s });
    res.json({ ok:true, player: updated, session: { stake: s, current_level: 1, cleared_levels: 0 } });
  });

  app.post('/api/games/lesenka/pick', authMiddleware, async (req, res)=>{
    const { column } = req.body || {};
    const col = Number(column);
    if (!(col>=0 && col<=7)) return res.status(400).json({ ok:false, error:'bad_column' });
    const sess = await getLesenka(req.tgUser.id);
    if (!sess) return res.status(400).json({ ok:false, error:'no_session' });
    const lvl = Number(sess.current_level)||1;
    const broken = (sess.broken_map && sess.broken_map[lvl]) || [];
    const isBroken = broken.includes(col);
    if (isBroken){
      await deleteLesenka(req.tgUser.id);
      return res.json({ ok:true, lose:true, level:lvl });
    }
    let cleared = Number(sess.cleared_levels)||0;
    cleared += 1;
    let next = lvl + 1;
    if (next>7){
      const mult = lesenkaMultiplier(cleared);
      const payout = Math.floor(Number(sess.stake) * mult);
      const player = await updateResources(req.tgUser.id, { stars: payout });
      await deleteLesenka(req.tgUser.id);
      return res.json({ ok:true, win:true, finished:true, payout, multiplier: mult, player });
    }
    const updatedSess = await updateLesenka(req.tgUser.id, { current_level: next, cleared_levels: cleared });
    return res.json({ ok:true, win:true, finished:false, current_level: next, cleared_levels: cleared });
  });

  app.post('/api/games/lesenka/cashout', authMiddleware, async (req, res)=>{
    const sess = await getLesenka(req.tgUser.id);
    if (!sess) return res.status(400).json({ ok:false, error:'no_session' });
    const cleared = Number(sess.cleared_levels)||0;
    if (cleared<=0) return res.status(400).json({ ok:false, error:'nothing_to_cashout' });
    const mult = lesenkaMultiplier(cleared);
    const payout = Math.floor(Number(sess.stake) * mult);
    const player = await updateResources(req.tgUser.id, { stars: payout });
    await deleteLesenka(req.tgUser.id);
    res.json({ ok:true, payout, multiplier: mult, player });
  });

  return app;
}

module.exports = { createServer };
