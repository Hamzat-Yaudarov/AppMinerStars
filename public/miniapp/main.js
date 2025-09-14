const tg = window.Telegram?.WebApp;
if (tg) {
  tg.expand();
  tg.enableClosingConfirmation();
}

const state = {
  initData: new URLSearchParams(location.hash.slice(1)).get("tgWebAppData") || tg?.initData || "",
  profile: null,
  cooldownRemain: 0
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

function switchTab(name){
  $$(".tab-button").forEach(b=>{
    const active = b.dataset.tab === name; b.classList.toggle("is-active", active); b.setAttribute("aria-selected", String(active));
  });
  $$(".tab-panel").forEach(p=>p.classList.toggle("is-active", p.dataset.panel === name));
}

$$(".tab-button").forEach((btn)=>btn.addEventListener("click",()=>switchTab(btn.dataset.tab)));

async function api(path, opts={}){
  const res = await fetch(path, {
    method: opts.method || "GET",
    headers: { "content-type":"application/json", "authorization": `twa ${state.initData}` },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error || "error"), { data });
  return data;
}

function fmtNum(n){ return new Intl.NumberFormat("ru").format(n); }

async function loadProfile(){
  const { data } = await api("/api/profile");
  state.profile = data;
  $("#pickaxe-level").textContent = data.pickaxe_level;
  $("#stars-balance").textContent = fmtNum(data.stars_balance);
  $("#mc-balance").textContent = fmtNum(data.mines_coins);
  $("#coal-count").textContent = fmtNum(data.coal);
  $("#copper-count").textContent = fmtNum(data.copper);
  $("#iron-count").textContent = fmtNum(data.iron);
  $("#gold-count").textContent = fmtNum(data.gold);
  $("#diamond-count").textContent = fmtNum(data.diamond);

  if (data.last_dig_at) {
    const last = new Date(data.last_dig_at).getTime();
    const remain = 3*60*60*1000 - (Date.now() - last);
    setCooldown(Math.max(remain, 0));
  } else setCooldown(0);
}

function setCooldown(ms){
  state.cooldownRemain = ms;
  const box = $("#cooldown-box");
  const btn = $("#dig-button");
  if (ms > 0) {
    box.hidden = false;
    btn.disabled = true;
  } else {
    box.hidden = true;
    btn.disabled = false;
  }
}

function startCooldownTimer(){
  const box = $("#cooldown-box");
  const timeEl = $("#cooldown-time");
  function tick(){
    if (state.cooldownRemain <= 0) { setCooldown(0); return; }
    const s = Math.floor(state.cooldownRemain/1000);
    const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sc = s%60;
    timeEl.textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sc).padStart(2,'0')}`;
    state.cooldownRemain -= 1000;
    setTimeout(tick, 1000);
  }
  tick();
}

async function onDig(){
  const btn = $("#dig-button");
  const feed = $("#drop-feed");
  feed.innerHTML = "";
  btn.disabled = true;
  try {
    const res = await api("/api/mine/dig", { method: "POST" });
    const entries = Object.entries(res.drop).filter(([_,v])=>v>0);
    for (const [name, amt] of entries){
      const row = document.createElement("div");
      row.className = "drop-row";
      const n = document.createElement("div"); n.className = "drop-name"; n.textContent = name;
      const a = document.createElement("div"); a.className = "drop-amt pos"; a.textContent = `+${fmtNum(amt)}`;
      row.append(n, a); feed.append(row);
      await new Promise(r=>setTimeout(r, 220));
    }
    await loadProfile();
    setCooldown(3*60*60*1000);
    startCooldownTimer();
  } catch(e){
    const err = e.data?.error || e.message;
    if (err === "cooldown"){
      const remain = e.data?.remain_ms || 0; setCooldown(remain); startCooldownTimer();
    } else if (err === "no_pickaxe"){
      const row = document.createElement("div");
      row.className = "drop-row";
      const n = document.createElement("div"); n.className = "drop-name"; n.textContent = "Нет кирки";
      const a = document.createElement("div"); a.className = "drop-amt"; a.textContent = "Купите в магазине";
      row.append(n,a); feed.append(row);
    }
  } finally {
    if (state.cooldownRemain <= 0) btn.disabled = false;
  }
}

$("#dig-button").addEventListener("click", onDig);

// Sell modal handlers
$("#sell-open").addEventListener("click", ()=>{ $("#sell-modal").hidden = false; });
$("#sell-cancel").addEventListener("click", ()=>{ $("#sell-modal").hidden = true; });

async function submitSell(){
  const resource = $("#sell-resource").value;
  let amount = $("#sell-amount").value.trim();
  if (!amount) return alert('Введите количество или all');
  if (amount !== 'all'){
    const n = Number(amount);
    if (!Number.isFinite(n) || n<=0) return alert('Неверное количество');
    amount = Math.floor(n);
  }
  try{
    const res = await api('/api/mine/sell', { method: 'POST', body: { resource, amount } });
    $("#sell-modal").hidden = true;
    await loadProfile();
    const row = document.createElement("div"); row.className = 'drop-row';
    const n = document.createElement('div'); n.className='drop-name'; n.textContent = `Продано ${res.sold.amount} ${res.sold.resource}`;
    const a = document.createElement('div'); a.className='drop-amt pos'; a.textContent = `+${fmtNum(res.mc_gain)} MC`;
    row.append(n,a); $("#drop-feed").prepend(row);
  }catch(e){ alert(e.data?.error || e.message); }
}

$("#sell-submit").addEventListener('click', submitSell);

// Shop
async function loadShop(){
  try{
    const { data } = await api('/api/shop');
    $("#shop-pickaxe-level").textContent = data.pickaxe_level;
    $("#shop-next-level").textContent = data.next_level;
    $("#shop-cost-mc").textContent = new Intl.NumberFormat('ru').format(data.cost_mc || 0);
    $("#shop-cost-stars").textContent = new Intl.NumberFormat('ru').format(data.cost_stars || 0);
  }catch(e){ console.error(e); }
}

$("#buy-mc").addEventListener('click', async ()=>{
  try{
    const res = await api('/api/shop/buy-pickaxe', { method: 'POST', body: { method: 'mc' } });
    await loadProfile(); await loadShop();
    alert('Куплено за MC');
  }catch(e){ alert(e.data?.error || e.message); }
});

$("#buy-stars").addEventListener('click', async ()=>{
  try{
    const res = await api('/api/shop/buy-pickaxe', { method: 'POST', body: { method: 'stars' } });
    await loadProfile(); await loadShop();
    alert('Куплено за ⭐');
  }catch(e){ alert(e.data?.error || e.message); }
});

async function runCase(type){
  const anim = $("#case-anim");
  anim.innerHTML = '';
  const slot = document.createElement('div'); slot.className='drop-row'; slot.textContent = 'Открытие...'; anim.append(slot);
  // simple text animation
  for (let i=0;i<8;i++){
    slot.textContent = ['25⭐','50⭐','75⭐','150⭐','300⭐','Snoop','Swag','Cigar'][Math.floor(Math.random()*8)];
    await new Promise(r=>setTimeout(r, 120 + i*40));
  }
  try{
    const res = await api('/api/cases/open', { method: 'POST', body: { caseType: type } });
    anim.innerHTML = '';
    const out = document.createElement('div'); out.className='drop-row';
    if (res.type === 'stars'){
      out.innerHTML = `<div class="drop-name">Вы выиграли</div><div class="drop-amt pos">+${fmtNum(res.prize)} ⭐</div>`;
    } else {
      out.innerHTML = `<div class="drop-name">NFT</div><div class="drop-amt pos">${res.prize.name}</div>`;
    }
    anim.append(out);
    await loadProfile();
  }catch(e){
    anim.innerHTML = '';
    const err = document.createElement('div'); err.className='drop-row'; err.textContent = e.data?.error || e.message || 'error'; anim.append(err);
  }
}

$("#open-cheap").addEventListener('click', ()=>runCase('cheap'));
$("#open-premium").addEventListener('click', ()=>runCase('premium'));

let selectedBet = 10;
let selectedPick = 1;

$$(".primary-action.small").forEach(b=>b.addEventListener('click', (e)=>{ selectedBet = Number(b.dataset.bet); $$(".primary-action.small").forEach(x=>x.classList.remove('active')); b.classList.add('active'); }));
$$(".secondary-action[data-pick]").forEach(b=>b.addEventListener('click', (e)=>{ selectedPick = Number(b.dataset.pick); $$(".secondary-action[data-pick]").forEach(x=>x.classList.remove('active')); b.classList.add('active'); }));

async function playLadder(){
  const resEl = $("#ladder-result"); resEl.innerHTML = '';
  const info = document.createElement('div'); info.className='drop-row'; info.textContent = 'Играем...'; resEl.append(info);
  try{
    const data = await api('/api/games/ladder', { method: 'POST', body: { bet: selectedBet, pick: selectedPick } });
    resEl.innerHTML = '';
    if (data.result === 'lost'){
      const el = document.createElement('div'); el.className='drop-row'; el.innerHTML = `<div class="drop-name">Вы проиграли</div><div class="drop-amt">- ${selectedBet} ⭐</div>`; resEl.append(el);
    } else if (data.result === 'win'){
      const el = document.createElement('div'); el.className='drop-row'; el.innerHTML = `<div class="drop-name">Вы выиграли</div><div class="drop-amt pos">+ ${fmtNum(data.win)} ⭐</div>`; resEl.append(el);
    }
    await loadProfile();
  }catch(e){ resEl.innerHTML = ''; const err=document.createElement('div'); err.className='drop-row'; err.textContent = e.data?.error || e.message; resEl.append(err); }
}

// bind play button (use first small primary as play trigger)
const playBtn = $$(".primary-action.small")[0]; if (playBtn) playBtn.addEventListener('dblclick', playLadder);

loadProfile().then(()=>{ startCooldownTimer(); loadShop(); });
