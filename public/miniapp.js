(function(){
  const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  if (tg) { try { tg.expand(); } catch(_){} }

  const tabs = document.querySelectorAll('.tab-btn');
  const panels = { profile: document.getElementById('tab-profile'), mine: document.getElementById('tab-mine'), shop: document.getElementById('tab-shop') };
  tabs.forEach(btn=>btn.addEventListener('click',()=>{
    tabs.forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    Object.values(panels).forEach(p=>p.classList.remove('active'));
    panels[btn.dataset.tab].classList.add('active');
  }));
  tabs[0].classList.add('active');

  const initData = (tg && tg.initData) ? tg.initData : '';
  let PRICES = { coal:1,copper:2,iron:4,gold:5,diamond:7 };
  const RATE = 200;
  const COSTS = [10000,50000,100000,150000,200000,250000,300000,350000,400000,500000];

  async function api(path, opts={}){
    const url = `${path}${path.includes('?')?'&':'?'}initData=${encodeURIComponent(initData)}`;
    const res = await fetch(url, { ...opts, headers: { 'Content-Type':'application/json', 'X-Telegram-InitData': initData } });
    return res.json();
  }

  function fillProfile(p){
    document.getElementById('username').textContent = (tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.username) || p.username || '—';
    document.getElementById('userId').textContent = String(p.telegram_id);
    document.getElementById('pickaxeLevel').textContent = String(p.pickaxe_level);
    document.getElementById('stars').textContent = String(p.stars);
    document.getElementById('mcoin').textContent = String(p.mcoin);
    document.getElementById('coal').textContent = String(p.coal);
    document.getElementById('copper').textContent = String(p.copper);
    document.getElementById('iron').textContent = String(p.iron);
    document.getElementById('gold').textContent = String(p.gold);
    document.getElementById('diamond').textContent = String(p.diamond);
    const cur = Number(p.pickaxe_level)||0; const next = cur+1; const cost = COSTS[next-1];
    document.getElementById('shopPickaxe').textContent = String(cur);
    document.getElementById('nextCost').textContent = (cur>=10? '—' : String(cost));
  }

  async function load(){
    const r = await api('/api/auth');
    if (r.ok && r.player) {
      if (r.prices) PRICES = r.prices;
      fillProfile(r.player);
    }
  }

  document.getElementById('mineBtn').addEventListener('click', async ()=>{
    const out = document.getElementById('mineResult');
    out.textContent = '...';
    try{
      const r = await api('/api/mine', { method: 'POST', body: JSON.stringify({}) });
      if (!r.ok) {
        if (r.error === 'no_pickaxe') out.textContent = 'У вас нет кирки!';
        else out.textContent = 'Не удалось копать.';
        return;
      }
      const drops = r.drops || {};
      const lines = Object.entries(drops).map(([k,v])=>`${k}: +${v}`).concat(r.mc_value? [`Всего MC: +${r.mc_value}`, `Лимит: ${r.limit} MC`]:[]);
      out.textContent = lines.length? lines.join('\n') : 'Ничего не найдено.';
      if (r.player) fillProfile(r.player);
    }catch(e){ out.textContent = 'Ошибка соединения.'; }
  });

  document.getElementById('buyStarsBtn').addEventListener('click', async ()=>{
    const n = Math.floor(Number(document.getElementById('starsBuy').value)||0);
    const msg = document.getElementById('exchangeMsg');
    msg.textContent = '';
    if (n<=0){ msg.textContent = 'Введите количество звёзд.'; return; }
    const r = await api('/api/exchange', { method:'POST', body: JSON.stringify({ direction:'m2s', amount:n }) });
    if (!r.ok){ msg.textContent = r.error==='not_enough_mcoin'? 'Недостаточно MC.' : 'Ошибка обмена.'; return; }
    fillProfile(r.player); msg.textContent = `Куплено звёзд: ${n} (−${n*RATE} MC)`;
  });

  document.getElementById('sellStarsBtn').addEventListener('click', async ()=>{
    const n = Math.floor(Number(document.getElementById('starsSell').value)||0);
    const msg = document.getElementById('exchangeMsg');
    msg.textContent = '';
    if (n<=0){ msg.textContent = 'Введите количество звёзд.'; return; }
    const r = await api('/api/exchange', { method:'POST', body: JSON.stringify({ direction:'s2m', amount:n }) });
    if (!r.ok){ msg.textContent = r.error==='not_enough_stars'? 'Недостаточно звёзд.' : 'Ошибка обмена.'; return; }
    fillProfile(r.player); msg.textContent = `Продано звёзд: ${n} (+${n*RATE} MC)`;
  });

  document.getElementById('sellBtn').addEventListener('click', async ()=>{
    const payload = {
      coal: Math.floor(Number(document.getElementById('sellCoal').value)||0),
      copper: Math.floor(Number(document.getElementById('sellCopper').value)||0),
      iron: Math.floor(Number(document.getElementById('sellIron').value)||0),
      gold: Math.floor(Number(document.getElementById('sellGold').value)||0),
      diamond: Math.floor(Number(document.getElementById('sellDiamond').value)||0)
    };
    const msg = document.getElementById('sellMsg');
    msg.textContent = '';
    if (Object.values(payload).every(v=>!v)){ msg.textContent = 'Нечего продавать.'; return; }
    const r = await api('/api/sell', { method:'POST', body: JSON.stringify(payload) });
    if (!r.ok){ msg.textContent = 'Ошибка продажи.'; return; }
    fillProfile(r.player);
    msg.textContent = `Продажа успешна: +${r.gain} MC`;
  });

  document.getElementById('upgradeBtn').addEventListener('click', async ()=>{
    const msg = document.getElementById('shopMsg');
    msg.textContent = '';
    const r = await api('/api/shop/upgradePickaxe', { method:'POST', body: JSON.stringify({}) });
    if (!r.ok){
      msg.textContent = r.error==='max_level'? 'Максимальный уровень.' : (r.error==='not_enough_mcoin'? 'Недостаточно MC.' : 'Ошибка покупки.');
      return;
    }
    fillProfile(r.player);
    msg.textContent = `Уровень кирки: ${r.level} (−${r.cost} MC)`;
  });

  load();
})();
