(function(){
  const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  if (tg) { try { tg.expand(); } catch(_){} }

  const tabs = document.querySelectorAll('.tab-btn');
  const panels = { profile: document.getElementById('tab-profile'), mine: document.getElementById('tab-mine') };
  tabs.forEach(btn=>btn.addEventListener('click',()=>{
    tabs.forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    Object.values(panels).forEach(p=>p.classList.remove('active'));
    panels[btn.dataset.tab].classList.add('active');
  }));
  tabs[0].classList.add('active');

  const initData = tg ? tg.initData : '';

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
  }

  async function load(){
    const r = await api('/api/auth');
    if (r.ok && r.player) fillProfile(r.player);
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
      const lines = Object.entries(drops).map(([k,v])=>`${k}: +${v}`);
      out.textContent = lines.length? lines.join('\n') : 'Ничего не найдено.';
      if (r.player) fillProfile(r.player);
    }catch(e){ out.textContent = 'Ошибка соединения.'; }
  });

  load();
})();
