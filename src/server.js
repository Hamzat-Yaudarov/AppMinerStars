const express = require('express');
const path = require('path');
const { initDb, upsertPlayer, getPlayer, updateResources } = require('./db');
const { checkTelegramAuth } = require('./telegram-auth');

const BASE_URL = process.env.BASE_URL || '';
const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN || '';

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
  const coal = 0.90; // always 90%
  const base = { copper: 0.65, iron: 0.29, gold: 0.15, diamond: 0.09 };
  // Awaiting exact scaling per level from product spec; until then, use level 1 as baseline.
  return { coal, copper: base.copper, iron: base.iron, gold: base.gold, diamond: base.diamond };
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
    res.json({ ok: true, player });
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

    const updated = await updateResources(req.tgUser.id, drops);
    res.json({ ok: true, drops, player: updated });
  });

  return app;
}

module.exports = { createServer };
