(function(){
  const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  if (tg) { try { tg.expand(); } catch(_){} }

  const tabs = document.querySelectorAll('.tab-btn');
  const panels = { profile: document.getElementById('tab-profile'), mine: document.getElementById('tab-mine'), shop: document.getElementById('tab-shop'), games: document.getElementById('tab-games') };
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
    let data; try { data = await res.json(); } catch { data = { ok:false, error:'network' }; }
    return data;
  }

  let currentProfile = null;
  function fillProfile(p){
    currentProfile = p || currentProfile;
    document.getElementById('username').textContent = (tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.username) || (p && p.username) || '—';
    document.getElementById('userId').textContent = String(p && p.telegram_id || '—');
    document.getElementById('pickaxeLevel').textContent = String(p && p.pickaxe_level || '—');
    document.getElementById('stars').textContent = String(p && p.stars || '—');
    document.getElementById('mcoin').textContent = String(p && p.mcoin || '—');
    // resources hidden from profile; kept for inventory modal
    if (p){
      document.getElementById('coal').textContent = String(p.coal);
      document.getElementById('copper').textContent = String(p.copper);
      document.getElementById('iron').textContent = String(p.iron);
      document.getElementById('gold').textContent = String(p.gold);
      document.getElementById('diamond').textContent = String(p.diamond);
    }
    const cur = Number(p && p.pickaxe_level)||0; const next = cur+1; const cost = COSTS[next-1];
    document.getElementById('shopPickaxe').textContent = String(cur);
    document.getElementById('nextCost').textContent = (cur>=10? '—' : String(cost));
  }

  let cooldownTimer = null;
  function setupCooldown(cd){
    const btn = document.getElementById('mineBtn');
    const text = document.getElementById('cooldownText');
    if (cooldownTimer){ clearInterval(cooldownTimer); cooldownTimer = null; }
    function format(ms){
      const s = Math.ceil(ms/1000); const h = Math.floor(s/3600); const m = Math.floor((s%3600)/60); const ss = s%60;
      return `${h}ч ${m}м ${ss}с`;
    }
    if (cd && cd.remainingMs>0){
      btn.disabled = true; text.textContent = `Осталось: ${format(cd.remainingMs)}`;
      cooldownTimer = setInterval(()=>{
        cd.remainingMs -= 1000;
        if (cd.remainingMs <= 0){ btn.disabled = false; text.textContent='Можно копать'; clearInterval(cooldownTimer); cooldownTimer=null; }
        else { text.textContent = `Осталось: ${format(cd.remainingMs)}`; }
      }, 1000);
    } else { btn.disabled = false; text.textContent = 'Можно копать'; }
  }

  async function loadProfile(){
    const r = await api('/api/profile');
    if (r.ok && r.player){ fillProfile(r.player); setupCooldown(r.cooldown||{}); }
  }

  async function initial(){
    const r = await api('/api/auth');
    if (r.ok && r.player) {
      if (r.prices) PRICES = r.prices;
      fillProfile(r.player);
      setupCooldown(r.cooldown||{});
    }
    // default to selection step; lesenkaState will move to play if session exists
    try{ await lesenkaState(); } catch(e){ console.warn('lesenkaState failed', e); }
    showGamesStep('select');
  }

  const modal = document.getElementById('modal');
  const modalBody = document.getElementById('modalBody');
  document.getElementById('modalClose').onclick = ()=>{ modal.style.display='none'; modalBody.innerHTML=''; };

  function openModal(html){ modalBody.innerHTML = html; modal.style.display='block'; }

  function openSellFlow(profile){
    const res = ['coal','copper','iron','gold','diamond'];
    const names = { coal:'Уголь', copper:'Медь', iron:'Железо', gold:'З��лото', diamond:'Алмаз' };
    const list = res.map(k=>`<button class="secondary-btn" data-k="${k}">${names[k]} (есть: ${profile[k]})</button>`).join('');
    openModal(`<div class="section-title">Выберите руду</div><div class="sell-grid">${list}</div>`);
    modalBody.querySelectorAll('button[data-k]').forEach(btn=>{
      btn.onclick = ()=>{
        const k = btn.getAttribute('data-k');
        const allBtn = `<button id="sellAll" class="primary-btn">Продать всё</button>`;
        const part = `<div class="exchange-row"><input id="sellPartQty" type="number" min="1" step="1" class="input" placeholder="Количество"/><button id="sellPart" class="secondary-btn">Продать часть</button></div><div id="sellMsg" class="hint-text"></div>`;
        openModal(`<div class="section-title">${names[k]}</div>${allBtn}${part}`);
        modalBody.querySelector('#sellAll').onclick = async ()=>{
          const r = await api('/api/sellOne', { method:'POST', body: JSON.stringify({ resource:k, mode:'all' }) });
          const msg = modalBody.querySelector('#sellMsg');
          if (!r.ok){ msg.textContent='Ошибка продажи.'; return; }
          fillProfile(r.player); msg.textContent = `+${r.gain} MC`; await loadProfile();
        };
        modalBody.querySelector('#sellPart').onclick = async ()=>{
          const n = Math.floor(Number(modalBody.querySelector('#sellPartQty').value)||0);
          const msg = modalBody.querySelector('#sellMsg'); msg.textContent='';
          if (n<=0){ msg.textContent='Введите количество.'; return; }
          const r = await api('/api/sellOne', { method:'POST', body: JSON.stringify({ resource:k, mode:'part', amount:n }) });
          if (!r.ok){ msg.textContent = 'Недостаточно ресурса.'; return; }
          fillProfile(r.player); msg.textContent = `Продано ${n}. +${r.gain} MC`; await loadProfile();
        };
      };
    });
  }

  function openExchangeFlow(){
    openModal(`<div class="section-title">Обменни��</div>
      <div class="sell-grid">
        <button id="toStars" class="primary-btn">MC → Звёзды</button>
        <button id="toMC" class="secondary-btn">Звёзды → MC</button>
        <div id="exMsg" class="hint-text"></div>
      </div>`);
    modalBody.querySelector('#toStars').onclick = ()=>{
      openModal(`<div class="section-title">MC → Звёзды</div>
        <div class="exchange-row"><input id="starsBuy" type="number" min="1" step="1" placeholder="Сколько звёзд?" class="input" />
        <button id="buyStarsBtn" class="primary-btn">Обменять</button></div>
        <div class="hint-text">Курс: 200 MC → 1★</div><div id="exchangeMsg" class="hint-text"></div>`);
      modalBody.querySelector('#buyStarsBtn').onclick = async ()=>{
        const n = Math.floor(Number(modalBody.querySelector('#starsBuy').value)||0);
        const msg = modalBody.querySelector('#exchangeMsg'); msg.textContent='';
        if (n<=0){ msg.textContent='Введите количество.'; return; }
        const r = await api('/api/exchange', { method:'POST', body: JSON.stringify({ direction:'m2s', amount:n }) });
        if (!r.ok){ msg.textContent = r.error==='not_enough_mcoin'? 'Недостаточно MC.' : 'Ошибка.'; return; }
        fillProfile(r.player); msg.textContent = `Куплено: ${n}★ (−${n*RATE} MC)`; await loadProfile();
      };
    };
    modalBody.querySelector('#toMC').onclick = ()=>{
      openModal(`<div class="section-title">Звёзды → MC</div>
        <div class="exchange-row"><input id="starsSell" type="number" min="1" step="1" placeholder="Сколько звёзд?" class="input" />
        <button id="sellStarsBtn" class="primary-btn">Обменять</button></div>
        <div class="hint-text">Курс: 1★ → 200 MC</div><div id="exchangeMsg" class="hint-text"></div>`);
      modalBody.querySelector('#sellStarsBtn').onclick = async ()=>{
        const n = Math.floor(Number(modalBody.querySelector('#starsSell').value)||0);
        const msg = modalBody.querySelector('#exchangeMsg'); msg.textContent='';
        if (n<=0){ msg.textContent='Введите количество.'; return; }
        const r = await api('/api/exchange', { method:'POST', body: JSON.stringify({ direction:'s2m', amount:n }) });
        if (!r.ok){ msg.textContent = r.error==='not_enough_stars'? 'Недостаточно звёзд.' : 'Ошибка.'; return; }
        fillProfile(r.player); msg.textContent = `Продано: ${n}★ (+${n*RATE} MC)`; await loadProfile();
      };
    };
  }

  async function loadNfts(){
    const r = await api('/api/nft');
    const list = document.getElementById('nftList');
    list.innerHTML = '';
    if (r.ok){
      if (!r.items.length){ list.innerHTML = '<div class="hint-text">NFT нет</div>'; return; }
      list.innerHTML = r.items.map(i=>`<div class="nft-item">${i.nft_type}: <a href="${i.url}" target="_blank">ссылка</a></div>`).join('');
    }
  }

  document.getElementById('nftToggle').addEventListener('click', async ()=>{
    const r = await api('/api/nft');
    if (!r.ok){ openModal('<div class="section-title">NFT</div><div class="hint-text">Ошибка загрузки NFT.</div>'); return; }
    const items = r.items || [];
    if (!items.length){ openModal('<div class="section-title">NFT</div><div class="hint-text">NFT нет</div>'); return; }
    const html = `<div class="section-title">NFT</div><div class="nft-list">${items.map(i=>`<div class="nft-item"><div class="nft-type">${i.nft_type}</div><div class="nft-link"><a href="${i.url}" target="_blank">Открыть</a></div><div><button data-id="${i.id}" class="secondary-btn nft-withdraw">Вывести</button></div></div>`).join('')}</div>`;
    openModal(html);
    modalBody.querySelectorAll('.nft-withdraw').forEach(btn=>btn.onclick = async ()=>{
      const id = Number(btn.getAttribute('data-id'));
      const r2 = await api('/api/withdraw/nft', { method:'POST', body: JSON.stringify({ nft_id: id }) });
      const msg = modalBody.querySelector('#withdrawNftMsg');
      if (!r2.ok){ openModal('<div class="section-title">Ошибка</div><div class="hint-text">Не удалось отправить заявку на вывод NFT.</div>'); return; }
      openModal(`<div class="section-title">Заявка отправлена</div><div class="hint-text">ID: ${r2.request.id}</div>`);
      await loadNfts();
    });
  });

  document.getElementById('exchangeOpen').addEventListener('click', ()=> openExchangeFlow());
  document.getElementById('sellOpen').addEventListener('click', async ()=>{
    const r = await api('/api/profile'); if (r.ok && r.player) openSellFlow(r.player); else if (currentProfile) openSellFlow(currentProfile);
  });

  document.getElementById('inventoryOpen').addEventListener('click', async ()=>{
    // show inventory modal using currentProfile
    let p = currentProfile;
    if (!p){ const r = await api('/api/profile'); if (r.ok && r.player) p = r.player; }
    if (!p){ openModal('<div class="section-title">Инвентарь</div><div class="hint-text">Профиль не загружен</div>'); return; }
    openModal(`<div class="section-title">Инвентарь</div>
      <div class="sell-grid">
        <div>🪨 Уголь: ${p.coal}</div>
        <div>⛏️ Медь: ${p.copper}</div>
        <div>🔩 Железо: ${p.iron}</div>
        <div>🥇 Золото: ${p.gold}</div>
        <div>💎 Алмаз: ${p.diamond}</div>
      </div>
    `);
  });

  // Top-up flow
  document.getElementById('topupOpen').addEventListener('click', ()=>{
    openModal(`<div class="section-title">Пополнение</div>
      <div class="sell-grid">
        <button id="topup100" class="primary-btn">100★</button>
        <button id="topup250" class="primary-btn">250★</button>
        <button id="topup500" class="primary-btn">500★</button>
        <div id="topupMsg" class="hint-text"></div>
      </div>`);
    modalBody.querySelector('#topup100').onclick = ()=> doTopup(1);
    modalBody.querySelector('#topup250').onclick = ()=> doTopup(250);
    modalBody.querySelector('#topup500').onclick = ()=> doTopup(500);
  });

  async function doTopup(amount){
    const msg = document.getElementById('topupMsg'); if (msg) msg.textContent='';
    try{
      // First try webapp invoice if available
      if (tg && tg.openInvoice){
        const payload = `topup_${amount}_${Date.now()}`;
        try{ tg.openInvoice({ title:`Пополнение ${amount}★`, description:`Пополнение игрового баланса на ${amount} звёзд`, payload, provider_token:'', currency:'XTR', prices:[{ label:`${amount}★`, amount }] });
          setTimeout(async ()=>{ await loadProfile(); msg.textContent = 'Если оплата прошла — баланс обновлён.'; }, 2000);
          return;
        }catch(e){ console.warn('openInvoice failed', e); /* fall through to bot link */ }
      }
      // Fallback: request topup and let bot send a payment link
      const r = await api('/api/topup/request', { method:'POST', body: JSON.stringify({ amount }) });
      if (!r.ok){ if (msg) msg.textContent = 'Ошибка запроса пополнения.'; return; }
      const link = r.link || (`https://t.me/${(window && window.__BOT_NAME__) || ''}?start=${r.request && r.request.payload}`);
      openModal(`<div class="section-title">Оплатите в боте</div><div class="hint-text">Нажмите кнопку ниже, чтобы открыть бот и оплатить пополнение.</div><div style="margin-top:12px"><a class="primary-btn" href="${link}" target="_blank">Оплатить в боте</a></div>`);
    }catch(e){ if (msg) msg.textContent='Ошибка оплаты.'; console.error(e); }
  }

  // Withdraw flow
  document.getElementById('withdrawOpen').addEventListener('click', async ()=>{
    openModal(`<div class="section-title">Вывод</div>
      <div class="sell-grid">
        <button id="withdrawStarsBtn" class="primary-btn">Вывести звёзды</button>
        <button id="withdrawNftBtn" class="secondary-btn">Вывести NFT</button>
        <div id="withdrawMsg" class="hint-text"></div>
      </div>`);
    modalBody.querySelector('#withdrawStarsBtn').onclick = ()=> openStarsWithdraw();
    modalBody.querySelector('#withdrawNftBtn').onclick = async ()=>{
      const r = await api('/api/nft'); if (!r.ok){ modalBody.querySelector('#withdrawMsg').textContent='Ошибка'; return; }
      const list = r.items || [];
      if (!list.length){ modalBody.innerHTML = `<div class="section-title">NFT</div><div class="hint-text">NFT нет</div>`; return; }
      modalBody.innerHTML = `<div class="section-title">Выберите NFT для вывода</div><div class="nft-list">${list.map(i=>`<div class="nft-row"><span>${i.nft_type}</span> <button data-id="${i.id}" class="secondary-btn nft-withdraw">Вывести</button></div>`).join('')}</div><div id="withdrawNftMsg" class="hint-text"></div>`;
      modalBody.querySelectorAll('.nft-withdraw').forEach(btn=>btn.onclick = async ()=>{
        const id = Number(btn.getAttribute('data-id'));
        const r2 = await api('/api/withdraw/nft', { method:'POST', body: JSON.stringify({ nft_id: id }) });
        const msg = modalBody.querySelector('#withdrawNftMsg'); if (!r2.ok){ msg.textContent='Ошибка заявки.'; return; }
        msg.textContent = `Заявка отправлена (ID: ${r2.request.id}). Обработают в чате.`; await loadNfts();
      });
    };
  });

  function openStarsWithdraw(){
    openModal(`<div class="section-title">Вывод звёзд</div>
      <div class="stake-grid">
        <button class="secondary-btn withdraw-amt" data-v="100">100★</button>
        <button class="secondary-btn withdraw-amt" data-v="250">250★</button>
        <button class="secondary-btn withdraw-amt" data-v="500">500★</button>
        <button class="secondary-btn withdraw-amt" data-v="1000">1000★</button>
        <button class="secondary-btn withdraw-amt" data-v="2500">2500★</button>
        <button class="secondary-btn withdraw-amt" data-v="10000">10000★</button>
      </div>
      <div id="withdrawStarsMsg" class="hint-text"></div>`);
    modalBody.querySelectorAll('.withdraw-amt').forEach(b=>b.onclick = async ()=>{
      const n = Number(b.getAttribute('data-v'));
      const msg = modalBody.querySelector('#withdrawStarsMsg'); msg.textContent='';
      const r = await api('/api/withdraw/stars', { method:'POST', body: JSON.stringify({ amount: n }) });
      if (!r.ok){ msg.textContent = r.error==='not_enough_stars'? 'Недостаточно звёзд.' : 'Ошибка заявки.'; return; }
      msg.textContent = `Заявка отправлена ID:${r.request.id}`;
      await loadProfile();
    });
  }

  document.getElementById('mineBtn').addEventListener('click', async ()=>{
    const out = document.getElementById('mineResult');
    out.textContent = '...';
    try{
      const r = await api('/api/mine', { method: 'POST', body: JSON.stringify({}) });
      console.log('mine response', r);
      if (!r.ok) {
        if (r.error === 'no_pickaxe') out.textContent = 'У вас нет кирки!';
        else if (r.error === 'cooldown') { out.textContent = 'Кулдаун. Подождите.'; setupCooldown({ remainingMs: r.remainingMs }); }
        else if (r.error === 'server_error') { out.textContent = 'Серверная ошибка. Попробуйте позже.'; console.error('mine server error', r.message); }
        else out.textContent = 'Не удалось копать.';
        return;
      }
      const drops = r.drops || {};
      const lines = Object.entries(drops).map(([k,v])=>`${k}: +${v}`).concat(r.mc_value? [`Всего MC: +${r.mc_value}`, `Лимит: ${r.limit} MC`]:[]);
      out.textContent = lines.length? lines.join('\n') : 'Ничего не найдено.';
      if (r.player) fillProfile(r.player);
      setupCooldown(r.cooldown||{});
    }catch(e){ out.textContent = 'Ошибка соединения.'; console.error(e); }
  });

  document.querySelectorAll('.case-card .primary-btn').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const caseId = Number(btn.getAttribute('data-case'));
      const msg = document.getElementById('shopMsg'); msg.textContent='';
      const r = await api('/api/shop/openCase', { method:'POST', body: JSON.stringify({ caseId }) });
      if (!r.ok){
        msg.textContent = r.error==='not_enough_stars'? 'Недостаточно звёзд.' : (r.error==='nft_unavailable'? 'Нет доступных NFT этого типа.' : 'Ошибка кейса.');
        return;
      }
      fillProfile(r.player);
      if (caseId===1){
        openModal(`<div class="section-title">Вы вы��грали</div><div class="profile-row"><span class="label">Звёзды:</span><span class="value">+${r.starsWon}</span></div>`);
      } else {
        openModal(`<div class="section-title">Вы получили NFT</div><div class="profile-row"><span class="label">Тип:</span><span class="value">${r.nft.type}</span></div><div class="profile-row"><span class="label">Ссылка:</span><span class="value"><a href="${r.nft.url}" target="_blank">перейти</a></span></div>`);
      }
      await loadNfts();
    });
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

  // Games: Lesenka
  let stakeValue = 10;
  document.querySelectorAll('.stake').forEach(b=>{
    b.addEventListener('click', ()=>{
      document.querySelectorAll('.stake').forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
      stakeValue = Number(b.getAttribute('data-v'));
      chosenStakeEl.textContent = `${stakeValue}★`;
    });
  });
  // Games flow panels
  const gamesStepSelect = document.getElementById('gamesStepSelect');
  const gamesStepStake = document.getElementById('gamesStepStake');
  const gamesStepPlay = document.getElementById('gamesStepPlay');
  const chosenGameEl = document.getElementById('chosenGame');
  const chosenStakeEl = document.getElementById('chosenStake');
  function showGamesStep(which){
    [gamesStepSelect, gamesStepStake, gamesStepPlay].forEach(el=>el.classList.add('hidden'));
    if (which==='select') gamesStepSelect.classList.remove('hidden');
    else if (which==='stake') gamesStepStake.classList.remove('hidden');
    else if (which==='play') gamesStepPlay.classList.remove('hidden');
  }

  let currentGame = null;
  document.getElementById('chooseLesenka').addEventListener('click', ()=>{
    currentGame = 'lesenka';
    chosenGameEl.textContent = 'Лесенка';
    chosenStakeEl.textContent = `${stakeValue}★`;
    showGamesStep('stake');
  });

  const grid = document.getElementById('ladderGrid');
  function renderGrid(level){
    grid.innerHTML = '';
    for(let i=0;i<8;i++){
      const btn = document.createElement('button');
      btn.className = 'secondary-btn';
      btn.textContent = `${i+1}`;
      btn.onclick = ()=> pickColumn(i);
      grid.appendChild(btn);
    }
    document.getElementById('lesenkaLevel').textContent = String(level || '—');
  }

  async function lesenkaState(){
    const r = await api('/api/games/lesenka/state');
    if (r.ok){
      const s = r.session;
      if (s){
        showGamesStep('play');
        renderGrid(s.current_level);
      } else {
        showGamesStep('select');
        renderGrid(null);
      }
    }
  }

  document.getElementById('gameStartBtn').addEventListener('click', async ()=>{
    const msg = document.getElementById('gamesStakeMsg'); msg.textContent='';
    if (currentGame !== 'lesenka') { msg.textContent = 'Выберите игру.'; return; }
    const r = await api('/api/games/lesenka/start', { method:'POST', body: JSON.stringify({ stake: stakeValue }) });
    if (!r.ok){ msg.textContent = r.error==='not_enough_stars'? 'Недостаточно звёзд.' : 'Не удалось начать игру.'; return; }
    fillProfile(r.player);
    showGamesStep('play');
    renderGrid(r.session.current_level);
  });

  // Back to game select from stake
  const gameBackBtn = document.getElementById('gameBackBtn');
  if (gameBackBtn) gameBackBtn.addEventListener('click', ()=>{ currentGame = null; showGamesStep('select'); });
  const gamesReturnToSelect = document.getElementById('gamesReturnToSelect');
  if (gamesReturnToSelect) gamesReturnToSelect.addEventListener('click', ()=>{ currentGame = null; showGamesStep('select'); });

  async function pickColumn(i){
    const r = await api('/api/games/lesenka/pick', { method:'POST', body: JSON.stringify({ column: i }) });
    const msg = document.getElementById('lesenkaMsg'); msg.textContent='';
    if (!r.ok){ msg.textContent = r.error==='no_session'? 'Сначала начните игру.' : 'Ошибка хода.'; return; }
    if (r.lose){ openModal('<div class="section-title">Поражение</div><div class="hint-text">Ставка сгорела.</div>'); await lesenkaState(); return; }
    if (r.finished){
      fillProfile(r.player);
      openModal(`<div class=\"section-title\">Победа</div><div class=\"profile-row\"><span class=\"label\">Выплата:</span><span class=\"value\">+${r.payout}★</span></div><div class=\"hint-text\">Множитель: x${r.multiplier}</div>`);
      await lesenkaState();
      return;
    }
    renderGrid(r.current_level);
  }

  document.getElementById('lesenkaCashout').addEventListener('click', async ()=>{
    const r = await api('/api/games/lesenka/cashout', { method:'POST', body: JSON.stringify({}) });
    const msg = document.getElementById('lesenkaMsg'); msg.textContent='';
    if (!r.ok){ msg.textContent = r.error==='no_session'? 'Нет акт��вной игры.' : r.error==='nothing_to_cashout'? 'Ещё нет выигрыша.' : 'Ошибка.'; return; }
    fillProfile(r.player);
    openModal(`<div class=\"section-title\">Вы забрали</div><div class=\"profile-row\"><span class=\"label\">Выплата:</span><span class=\"value\">+${r.payout}★</span></div><div class=\"hint-text\">Множитель: x${r.multiplier}</div>`);
    await lesenkaState();
  });

  initial();

  // Ensure when user opens the Games tab we default to selection step
  try{
    const gamesTabBtn = document.querySelector('.tab-btn[data-tab="games"]');
    if (gamesTabBtn) gamesTabBtn.addEventListener('click', ()=> showGamesStep('select'));
  }catch(e){/* ignore */}

  // Extra safety: force select step after short delay (fixes race with session restore)
  setTimeout(()=>{ try{ showGamesStep('select'); }catch(e){} }, 150);

})();
