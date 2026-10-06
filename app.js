const LS_DATA = 'pm_data_v2';
const LS_DRAFT = 'pm_draft_v1';
const STATUS_LABEL = {idea:'Идея', test:'Тестирую', done:'Готово', archive:'Архив'};
const STATUS_COLOR = {idea:'var(--warn)', test:'var(--info)', done:'var(--ok)', archive:'var(--text-muted)'};

let items = [];
let currentFilter = 'all';
let currentCatFilter = 'all';
let editingId = null;
let currentVersionIdx = 0;
let sharingId = null;
let selectedIds = new Set();
let draftTimer = null;
let popoverTarget = null;

function genId(){ return 'id_' + Date.now() + '_' + Math.random().toString(36).slice(2,8); }

function emptyVersion(n){
  return {
    n: n, status: 'idea', ingredients: [{name:'',qty:'',unit:''}],
    dishware: '',
    before:'', after:'', unit:'мл', cost:'', price:'',
    need:'', mech:'', how:'', notes:'',
    updated: Date.now(), created: Date.now()
  };
}

function migrateItem(it){
  if(it && it.versions && Array.isArray(it.versions)){
    it.versions.forEach(v=>{
      if(typeof v.dishware === 'undefined') v.dishware = '';
    });
    return it;
  }
  const v1 = {
    n: 1,
    status: it.status || 'idea',
    ingredients: it.ingredients || [],
    dishware: it.dishware || '',
    before: it.before || '',
    after: it.after || '',
    unit: it.unit || '',
    cost: it.cost || '',
    price: it.price || '',
    need: it.need || '',
    mech: it.mech || '',
    how: it.how || '',
    notes: it.notes || '',
    updated: it.updated || Date.now(),
    created: it.created || Date.now()
  };
  return {
    id: it.id || genId(),
    title: it.title || 'Без названия',
    cat: it.cat || '',
    currentVersion: 1,
    versions: [v1],
    created: it.created || Date.now(),
    updated: it.updated || Date.now()
  };
}

function loadLocal(){
  try{
    const raw = JSON.parse(localStorage.getItem(LS_DATA));
    items = Array.isArray(raw) ? raw.map(migrateItem) : [];
  }catch(e){ items = []; }
}
function saveLocal(){
  try{ localStorage.setItem(LS_DATA, JSON.stringify(items)); }
  catch(e){ toast('Не удалось сохранить: ' + e.message); }
}

function setStatus(saving){
  const txt = document.getElementById('syncText');
  const dot = document.getElementById('syncDot');
  if(!txt) return;
  if(saving){
    dot.className = 'dot saving';
    txt.textContent = 'Сохранение...';
  } else {
    dot.className = 'dot ok';
    txt.textContent = items.length
      ? 'Локально · ' + items.length + ' ' + plural(items.length, 'проработка', 'проработки', 'проработок')
      : 'Локально · пусто';
  }
}
function plural(n, one, few, many){
  const m10 = n % 10, m100 = n % 100;
  if(m10 === 1 && m100 !== 11) return one;
  if(m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

function esc(s){
  return String(s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function fmtDate(ts){
  if(!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const diff = (now - d) / 1000;
  if(diff < 60) return 'только что';
  if(diff < 3600) return Math.floor(diff/60) + ' мин назад';
  if(diff < 86400) return Math.floor(diff/3600) + ' ч назад';
  if(diff < 604800) return Math.floor(diff/86400) + ' дн назад';
  return d.toLocaleDateString('ru-RU', {day:'numeric', month:'short'});
}
function calcFC(version){
  if(!version) return null;
  const cost = parseFloat(version.cost);
  const price = parseFloat(version.price);
  if(isNaN(cost) || isNaN(price) || price <= 0) return null;
  return (cost / price) * 100;
}
function fcClass(pct){
  if(pct === null) return '';
  if(pct <= 25) return 'good';
  if(pct <= 35) return 'warn';
  return 'bad';
}
function calcChange(v1, v2){
  const a = parseFloat(v1), b = parseFloat(v2);
  if(isNaN(a) || isNaN(b) || a <= 0) return null;
  const diff = b - a;
  const pct = (diff / a) * 100;
  return { diff, pct, sign: diff > 0 ? '+' : '' };
}

function renderStatusFilters(){
  const counts = {all: items.length};
  ['idea','test','done','archive'].forEach(s=>{
    counts[s] = items.filter(i=>{
      const v = i.versions[i.currentVersion - 1];
      return v && v.status === s;
    }).length;
  });
  const labels = {all:'Все', idea:'Идеи', test:'В работе', done:'Готово', archive:'Архив'};
  document.getElementById('status-filters').innerHTML = Object.keys(labels).map(k=>`
    <div class="chip ${currentFilter===k?'active':''}" onclick="setFilter('${k}')">
      ${labels[k]}<span class="num">${counts[k]||0}</span>
    </div>
  `).join('');
}
function renderCatFilters(){
  const used = new Set();
  items.forEach(i=>{ if(i.cat) used.add(i.cat); });
  if(used.size === 0){
    document.getElementById('cat-filters').innerHTML = '';
    return;
  }
  const sorted = Array.from(used).sort();
  document.getElementById('cat-filters').innerHTML =
    `<div class="label-pill">Категории</div>` +
    `<div class="chip ${currentCatFilter==='all'?'active':''}" onclick="setCatFilter('all')">
      Все<span class="num">${items.length}</span>
    </div>` +
    sorted.map(c=>{
      const count = items.filter(i=>i.cat === c).length;
      const safe = esc(c).replace(/'/g,"\\'");
      return `<div class="chip ${currentCatFilter===c?'active':''}" onclick="setCatFilter('${safe}')">
        ${esc(c)}<span class="num">${count}</span>
      </div>`;
    }).join('');
}
function setFilter(f){ currentFilter = f; render(); }
function setCatFilter(c){ currentCatFilter = c; render(); }

function render(){
  renderStatusFilters();
  renderCatFilters();
  setStatus(false);
  const q = (document.getElementById('q').value || '').toLowerCase().trim();
  const sort = document.getElementById('sort').value;
  const list = document.getElementById('list');

  let filtered = items.filter(it=>{
    const v = it.versions[it.currentVersion - 1];
    if(!v) return false;
    if(currentFilter !== 'all' && v.status !== currentFilter) return false;
    if(currentCatFilter !== 'all' && it.cat !== currentCatFilter) return false;
    if(!q) return true;
    const hay = [
      it.title, it.cat, v.dishware, v.need, v.mech, v.how, v.notes,
      ...(v.ingredients||[]).map(x=>x.name)
    ].join(' ').toLowerCase();
    return hay.includes(q);
  });

  if(sort === 'updated') filtered.sort((a,b)=>(b.updated||0)-(a.updated||0));
  else if(sort === 'created') filtered.sort((a,b)=>(b.created||0)-(a.created||0));
  else if(sort === 'title') filtered.sort((a,b)=>a.title.localeCompare(b.title,'ru'));
  else if(sort === 'fc'){
    filtered.sort((a,b)=>{
      const fa = calcFC(a.versions[a.currentVersion-1]);
      const fb = calcFC(b.versions[b.currentVersion-1]);
      if(fa === null && fb === null) return 0;
      if(fa === null) return 1;
      if(fb === null) return -1;
      return fa - fb;
    });
  }

  if(!filtered.length){
    const hasAny = items.length > 0;
    list.innerHTML = `<div class="empty">
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M9 3h6M10 3v5.5L5.5 17a2.5 2.5 0 0 0 2.2 3.5h8.6a2.5 2.5 0 0 0 2.2-3.5L14 8.5V3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M7 14h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      <div class="title">${hasAny?'Ничего не найдено':'Пока нет проработок'}</div>
      <div class="hint">${hasAny?'Попробуй другой запрос или сбрось фильтры':'Создай первую проработку'}</div>
      ${!hasAny?'<button class="btn primary" onclick="openEditor()">＋ Создать первую</button>':''}
    </div>`;
    return;
  }
  list.innerHTML = `<div class="grid">${filtered.map(cardHTML).join('')}</div>`;
}

function cardHTML(it){
  const v = it.versions[it.currentVersion - 1] || {};
  const ingCount = (v.ingredients||[]).length;
  const hasYield = v.before || v.after;
  const yieldStr = hasYield ? `${v.before||'—'} → ${v.after||'—'}`.trim() : '';
  const fc = calcFC(v);
  const fcStr = fc !== null ? fc.toFixed(1) + '%' : '';
  const isSelected = selectedIds.has(it.id);
  const showV = it.versions.length > 1;

  const iconTag = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="7" cy="7" r="1.2" fill="currentColor"/></svg>`;
  const iconGlass = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 2h8l-1 8v9a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-9L8 2z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M7 2h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  const iconFlask = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9 3h6M10 3v5.5L5.5 17a2.5 2.5 0 0 0 2.2 3.5h8.6a2.5 2.5 0 0 0 2.2-3.5L14 8.5V3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const iconScale = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 3v18M5 7h14M7 7l-3 6a3 3 0 0 0 6 0L7 7zM17 7l-3 6a3 3 0 0 0 6 0l-3-6z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const iconCheck = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="m5 12 5 5 9-11" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  return `
    <div class="card ${isSelected?'selected':''}" data-id="${it.id}" onclick="cardClick(event, '${it.id}')">
      <div class="card-check" onclick="toggleCardSelect(event, '${it.id}')" aria-label="Выбрать">
        ${iconCheck}
      </div>
      <div class="card-head">
        <h3>${esc(it.title)}${showV?`<span class="card-v-badge">v${it.currentVersion}</span>`:''}</h3>
        <span class="status ${v.status}" onclick="openStatusPopover(event, '${it.id}')">${STATUS_LABEL[v.status]||''}</span>
      </div>
      <div class="card-meta">
        ${it.cat?`<span>${iconTag}${esc(it.cat)}</span>`:''}
        ${v.dishware?`<span>${iconGlass}${esc(v.dishware)}</span>`:''}
        ${ingCount?`<span>${iconFlask}${ingCount}</span>`:''}
        ${yieldStr?`<span>${iconScale}${esc(yieldStr)}</span>`:''}
        ${fcStr?`<span class="fc">FC ${fcStr}</span>`:''}
      </div>
      ${v.need?`<div class="card-note">${esc(v.need)}</div>`:
        v.notes?`<div class="card-note">${esc(v.notes)}</div>`:''}
      <div class="card-date">${fmtDate(it.updated)}</div>
    </div>`;
}

function cardClick(ev, id){
  if(ev.target.closest('.card-check') || ev.target.closest('.status')) return;
  if(selectedIds.size > 0){ toggleCardSelect(ev, id); return; }
  openEditor(id);
}
function toggleCardSelect(ev, id){
  ev.stopPropagation();
  if(selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);
  updateSelectionBar();
  const card = document.querySelector(`.card[data-id="${id}"]`);
  if(card) card.classList.toggle('selected', selectedIds.has(id));
}
function clearSelection(){
  selectedIds.clear();
  updateSelectionBar();
  document.querySelectorAll('.card.selected').forEach(c=>c.classList.remove('selected'));
}
function updateSelectionBar(){
  const bar = document.getElementById('selectionBar');
  const cnt = document.getElementById('selCount');
  cnt.textContent = selectedIds.size;
  if(selectedIds.size > 0) bar.classList.add('show');
  else bar.classList.remove('show');
}

function openStatusPopover(ev, id){
  ev.stopPropagation();
  const pop = document.getElementById('statusPopover');
  const it = items.find(i=>i.id===id);
  if(!it) return;
  const v = it.versions[it.currentVersion - 1];
  popoverTarget = id;
  pop.innerHTML = ['idea','test','done','archive'].map(s=>`
    <div class="popover-item ${v.status===s?'active':''}" onclick="setStatusFromPopover('${s}')">
      <span class="dot-s" style="background:${STATUS_COLOR[s]}"></span>
      <span>${STATUS_LABEL[s]}</span>
      <span class="check">✓</span>
    </div>
  `).join('');
  pop.classList.add('open');
  const rect = ev.target.getBoundingClientRect();
  const popW = 180;
  let left = rect.left + rect.width/2 - popW/2;
  if(left < 10) left = 10;
  if(left + popW > window.innerWidth - 10) left = window.innerWidth - popW - 10;
  pop.style.left = left + 'px';
  pop.style.top = (rect.bottom + 6) + 'px';
  pop.style.width = popW + 'px';
}
function setStatusFromPopover(status){
  if(!popoverTarget) return;
  const it = items.find(i=>i.id===popoverTarget);
  if(!it) return;
  it.versions[it.currentVersion - 1].status = status;
  it.updated = Date.now();
  saveLocal();
  closeStatusPopover();
  render();
  toast('Статус изменён');
}
function closeStatusPopover(){
  const pop = document.getElementById('statusPopover');
  if(pop) pop.classList.remove('open');
  popoverTarget = null;
}
document.addEventListener('click', e=>{
  if(!e.target.closest('#statusPopover') && !e.target.closest('.status')){
    closeStatusPopover();
  }
});

function openEditor(id){
  editingId = id || null;
  currentVersionIdx = 0;
  const it = id ? items.find(i=>i.id===id) : null;
  window._tempNewItem = null;

  document.getElementById('modalTitle').textContent = it ? 'Редактировать' : 'Новая проработка';
  document.getElementById('deleteBtn').style.display = it ? 'inline-flex' : 'none';
  document.getElementById('dupBtn').style.display = it ? 'inline-flex' : 'none';
  document.getElementById('shareBtn').style.display = it ? 'inline-flex' : 'none';

  if(it){
    document.getElementById('f-title').value = it.title || '';
    document.getElementById('f-cat').value = it.cat || '';
    currentVersionIdx = it.currentVersion - 1;
    renderVersionTabs(it);
    loadVersionIntoForm(it, currentVersionIdx);
  } else {
    document.getElementById('f-title').value = '';
    document.getElementById('f-cat').value = '';
    const tempIt = { id: null, title:'', cat:'', versions:[emptyVersion(1)] };
    window._tempNewItem = tempIt;
    renderVersionTabs(tempIt);
    loadVersionIntoForm(tempIt, 0);
  }

  document.getElementById('overlay').classList.add('open');
  document.body.classList.add('modal-open');
}

function renderVersionTabs(it){
  const tabs = document.getElementById('vTabs');
  if(!it.versions || it.versions.length < 1){ tabs.innerHTML = ''; return; }
  tabs.innerHTML = it.versions.map((v, idx)=>`
    <div class="v-tab ${idx===currentVersionIdx?'active':''}" onclick="switchVersion(${idx})">v${v.n}</div>
  `).join('') + `
    <div class="v-tab-add" onclick="addNewVersion()">
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
      </svg>
      Версия
    </div>
  `;
}

function switchVersion(idx){
  saveCurrentVersionToMemory();
  currentVersionIdx = idx;
  const it = getEditingItem();
  if(!it) return;
  renderVersionTabs(it);
  loadVersionIntoForm(it, idx);
}

function getEditingItem(){
  if(editingId) return items.find(i=>i.id===editingId);
  if(!window._tempNewItem) window._tempNewItem = { id:null, title:'', cat:'', versions:[emptyVersion(1)] };
  return window._tempNewItem;
}

function loadVersionIntoForm(it, idx){
  const v = it.versions[idx];
  if(!v) return;
  document.getElementById('f-status').value = v.status || 'idea';
  document.getElementById('f-dishware').value = v.dishware || '';
  document.getElementById('f-before').value = v.before || '';
  document.getElementById('f-after').value = v.after || '';
  document.getElementById('f-unit').value = v.unit || 'мл';
  document.getElementById('f-cost').value = v.cost || '';
  document.getElementById('f-price').value = v.price || '';
  document.getElementById('f-need').value = v.need || '';
  document.getElementById('f-mech').value = v.mech || '';
  document.getElementById('f-how').value = v.how || '';
  document.getElementById('f-notes').value = v.notes || '';
  document.getElementById('ing-list').innerHTML = '';
  const ings = v.ingredients?.length ? v.ingredients : [{name:'',qty:'',unit:''}];
  ings.forEach(addIng.bind(null));
  updateLoss();
  updateFC();
}

function saveCurrentVersionToMemory(){
  const it = getEditingItem();
  if(!it) return;
  const v = it.versions[currentVersionIdx];
  if(!v) return;
  const el = id => document.getElementById(id);
  v.status = el('f-status').value;
  v.dishware = el('f-dishware').value.trim();
  v.before = el('f-before').value.trim();
  v.after = el('f-after').value.trim();
  v.unit = el('f-unit').value;
  v.cost = el('f-cost').value.trim();
  v.price = el('f-price').value.trim();
  v.need = el('f-need').value.trim();
  v.mech = el('f-mech').value.trim();
  v.how = el('f-how').value.trim();
  v.notes = el('f-notes').value.trim();
  v.ingredients = collectIngredients();
  v.updated = Date.now();
}

function addNewVersion(){
  saveCurrentVersionToMemory();
  const it = getEditingItem();
  if(!it) return;
  const lastN = it.versions.length ? it.versions[it.versions.length - 1].n : 0;
  const copy = JSON.parse(JSON.stringify(it.versions[currentVersionIdx]));
  copy.n = lastN + 1;
  copy.created = Date.now();
  copy.updated = Date.now();
  it.versions.push(copy);
  currentVersionIdx = it.versions.length - 1;
  renderVersionTabs(it);
  loadVersionIntoForm(it, currentVersionIdx);
  toast('Создана v' + copy.n);
}

function closeEditor(){
  saveCurrentVersionToMemory();
  document.getElementById('overlay').classList.remove('open');
  document.body.classList.remove('modal-open');
  editingId = null;
  currentVersionIdx = 0;
  window._tempNewItem = null;
}

function addIng(data){
  data = data || {name:'',qty:'',unit:''};
  const wrap = document.createElement('div');
  wrap.className = 'ing-row';
  wrap.innerHTML = `
    <input placeholder="Ингредиент" value="${esc(data.name)}" data-k="name">
    <input placeholder="Кол-во" value="${esc(data.qty)}" data-k="qty">
    <input placeholder="ед." value="${esc(data.unit)}" data-k="unit">
    <button class="del" onclick="this.parentNode.remove()" aria-label="Удалить">✕</button>
  `;
  document.getElementById('ing-list').appendChild(wrap);
}

function collectIngredients(){
  const rows = document.querySelectorAll('#ing-list .ing-row');
  const out = [];
  rows.forEach(r=>{
    const obj = {};
    r.querySelectorAll('input').forEach(inp=>obj[inp.dataset.k]=inp.value.trim());
    if(obj.name) out.push(obj);
  });
  return out;
}

function updateLoss(){
  const v1 = parseFloat(document.getElementById('f-before').value);
  const v2 = parseFloat(document.getElementById('f-after').value);
  const lossEl = document.getElementById('f-loss');
  if(!isNaN(v1) && !isNaN(v2) && v1 > 0){
    const diff = v2 - v1;
    const pct = (diff / v1) * 100;
    const sign = diff > 0 ? '+' : '';
    lossEl.value = sign + diff.toFixed(0) + ' (' + sign + pct.toFixed(1) + '%)';
    if(diff > 0) lossEl.style.color = 'var(--ok)';
    else if(diff < 0) lossEl.style.color = 'var(--danger)';
    else lossEl.style.color = '';
  } else {
    lossEl.value = '';
    lossEl.style.color = '';
  }
}

function updateFC(){
  const cost = parseFloat(document.getElementById('f-cost').value);
  const price = parseFloat(document.getElementById('f-price').value);
  const el = document.getElementById('f-fc');
  if(!isNaN(cost) && !isNaN(price) && price > 0){
    const fc = (cost / price) * 100;
    el.textContent = fc.toFixed(1) + '%';
    el.className = 'fc-value ' + fcClass(fc);
  } else {
    el.textContent = '—';
    el.className = 'fc-value';
  }
}

document.addEventListener('input', e=>{
  if(e.target.id === 'f-before' || e.target.id === 'f-after') updateLoss();
  if(e.target.id === 'f-cost' || e.target.id === 'f-price') updateFC();
  if(document.getElementById('overlay').classList.contains('open')) scheduleDraft();
});
document.addEventListener('change', e=>{
  if(document.getElementById('overlay').classList.contains('open')) scheduleDraft();
});

function scheduleDraft(){
  clearTimeout(draftTimer);
  setStatus(true);
  draftTimer = setTimeout(()=>{
    saveDraft();
    setStatus(false);
  }, 2000);
}

function saveDraft(){
  if(!document.getElementById('overlay').classList.contains('open')) return;
  saveCurrentVersionToMemory();
  const it = getEditingItem();
  if(!it) return;
  it.title = document.getElementById('f-title').value.trim();
  it.cat = document.getElementById('f-cat').value;
  const draft = { editingId, item: it, currentVersionIdx, ts: Date.now() };
  try{ localStorage.setItem(LS_DRAFT, JSON.stringify(draft)); }catch(e){}
}

function checkDraft(){
  try{
    const raw = localStorage.getItem(LS_DRAFT);
    if(!raw) return;
    const d = JSON.parse(raw);
    if(!d || !d.item) return;
    const age = (Date.now() - d.ts) / 1000 / 60;
    if(age > 60 * 24){ localStorage.removeItem(LS_DRAFT); return; }
    document.getElementById('draftBanner').classList.add('show');
    const who = d.editingId ? (d.item.title || 'проработка') : 'новая проработка';
    document.getElementById('draftMsg').textContent = `Черновик: ${who} · ${fmtDate(d.ts)}`;
    window._draft = d;
  }catch(e){}
}

function restoreDraft(){
  const d = window._draft;
  if(!d) return;
  document.getElementById('draftBanner').classList.remove('show');
  if(d.editingId){
    const idx = items.findIndex(i=>i.id === d.editingId);
    if(idx >= 0) items[idx] = d.item;
    else items.push(d.item);
  } else {
    window._tempNewItem = d.item;
  }
  editingId = d.editingId || null;
  currentVersionIdx = d.currentVersionIdx || 0;
  localStorage.removeItem(LS_DRAFT);
  openEditorFromDraft(d);
}

function openEditorFromDraft(d){
  const it = d.item;
  document.getElementById('modalTitle').textContent = d.editingId ? 'Редактировать' : 'Новая проработка';
  document.getElementById('deleteBtn').style.display = d.editingId ? 'inline-flex' : 'none';
  document.getElementById('dupBtn').style.display = d.editingId ? 'inline-flex' : 'none';
  document.getElementById('shareBtn').style.display = d.editingId ? 'inline-flex' : 'none';
  document.getElementById('f-title').value = it.title || '';
  document.getElementById('f-cat').value = it.cat || '';
  renderVersionTabs(it);
  loadVersionIntoForm(it, currentVersionIdx);
  document.getElementById('overlay').classList.add('open');
  document.body.classList.add('modal-open');
  toast('Черновик восстановлен');
}

function discardDraft(){
  localStorage.removeItem(LS_DRAFT);
  document.getElementById('draftBanner').classList.remove('show');
  window._draft = null;
}

function saveCurrent(){
  const title = document.getElementById('f-title').value.trim();
  if(!title){
    document.getElementById('f-title').focus();
    toast('Введи название');
    return;
  }
  saveCurrentVersionToMemory();
  const it = getEditingItem();
  if(!it) return;
  it.title = title;
  it.cat = document.getElementById('f-cat').value;
  it.updated = Date.now();

  const isEdit = !!editingId;
  if(isEdit){
    const idx = items.findIndex(i=>i.id === editingId);
    if(idx >= 0){
      it.currentVersion = it.versions[currentVersionIdx].n;
      items[idx] = it;
    }
  } else {
    it.id = genId();
    it.created = Date.now();
    it.currentVersion = it.versions[currentVersionIdx].n;
    items.push(it);
  }
  saveLocal();
  localStorage.removeItem(LS_DRAFT);
  closeEditor();
  render();
  toast(isEdit ? 'Обновлено' : 'Сохранено');
}

function removeCurrent(){
  if(!editingId) return;
  const it = items.find(i=>i.id === editingId);
  if(!it) return;
  const msg = it.versions.length > 1
    ? 'Удалить всю проработку со всеми ' + it.versions.length + ' версиями?'
    : 'Удалить эту проработку?';
  if(!confirm(msg)) return;
  items = items.filter(i=>i.id !== editingId);
  saveLocal();
  closeEditor();
  render();
  toast('Удалено');
}

function duplicateCurrent(){
  if(!editingId) return;
  saveCurrentVersionToMemory();
  const it = items.find(i=>i.id === editingId);
  if(!it) return;
  const copy = JSON.parse(JSON.stringify(it));
  copy.id = genId();
  copy.title = it.title + ' (копия)';
  copy.created = Date.now();
  copy.updated = Date.now();
  items.push(copy);
  saveLocal();
  closeEditor();
  render();
  toast('Дубликат создан');
}

function openShare(){
  if(!editingId) return;
  saveCurrentVersionToMemory();
  sharingId = editingId;
  const it = items.find(i=>i.id === sharingId);
  if(!it) return;
  const sel = document.getElementById('sh-version');
  sel.innerHTML = it.versions.map(v=>`<option value="${v.n}">v${v.n}</option>`).join('');
  sel.value = String(it.versions[currentVersionIdx].n);
  document.getElementById('shareOverlay').classList.add('open');
  document.body.classList.add('modal-open');
  buildShareText();
}
function closeShare(){
  document.getElementById('shareOverlay').classList.remove('open');
  document.body.classList.remove('modal-open');
  sharingId = null;
}

function buildShareText(){
  const it = items.find(i=>i.id === sharingId);
  if(!it) return;
  const vn = parseInt(document.getElementById('sh-version').value) || it.currentVersion;
  const v = it.versions.find(x=>x.n === vn) || it.versions[it.currentVersion - 1];
  const preset = document.getElementById('sh-preset').value;
  const lines = [];

  lines.push('Проработка: ' + it.title + (it.versions.length > 1 ? ' (v' + v.n + ')' : ''));
  if(it.cat) lines.push('Категория: ' + it.cat);
  if(v.dishware) lines.push('Посуда: ' + v.dishware);
  lines.push('Статус: ' + STATUS_LABEL[v.status]);
  lines.push('');

  const yieldLine = (v.before || v.after)
    ? `${v.before||'—'} → ${v.after||'—'} ${v.unit||''}`.trim() : '';

  if(preset === 'short'){
    lines.push('Состав:');
    (v.ingredients||[]).forEach(i=>{
      lines.push('• ' + i.name + (i.qty ? ' — ' + i.qty + (i.unit ? ' ' + i.unit : '') : ''));
    });
    lines.push('');
    if(yieldLine) lines.push('Выход: ' + yieldLine);
  }

  if(preset === 'calc'){
    lines.push('СОСТАВ:');
    (v.ingredients||[]).forEach(i=>{
      lines.push('• ' + i.name + (i.qty ? ' — ' + i.qty + (i.unit ? ' ' + i.unit : '') : ''));
    });
    lines.push('');
    if(v.before || v.after){
      lines.push('ВЫХОДЫ:');
      if(v.before) lines.push('• Выход 1: ' + v.before + (v.unit ? ' ' + v.unit : ''));
      if(v.after) lines.push('• Выход 2: ' + v.after + (v.unit ? ' ' + v.unit : ''));
      const ch = calcChange(v.before, v.after);
      if(ch){
        const label = ch.diff > 0 ? 'Прирост' : (ch.diff < 0 ? 'Потери' : 'Без изменений');
        lines.push('• ' + label + ': ' + ch.sign + ch.diff.toFixed(0) + ' (' + ch.sign + ch.pct.toFixed(1) + '%)');
      }
      lines.push('');
    }
    if(v.cost || v.price){
      lines.push('ЭКОНОМИКА:');
      if(v.cost) lines.push('• Себестоимость: ' + v.cost + ' ₽');
      if(v.price) lines.push('• Цена порции: ' + v.price + ' ₽');
      const fc = calcFC(v);
      if(fc !== null) lines.push('• FC: ' + fc.toFixed(1) + '%');
      lines.push('');
    }
    if(v.need){ lines.push('ЧТО НУЖНО:'); lines.push(v.need); lines.push(''); }
    if(v.mech){ lines.push('МЕХАНИКА:'); lines.push(v.mech); lines.push(''); }
    if(v.notes){ lines.push('ЗАМЕТКИ:'); lines.push(v.notes); }
  }

  if(preset === 'tech'){
    if(yieldLine){ lines.push('ВЫХОД: ' + yieldLine); lines.push(''); }
    if(v.mech){ lines.push('МЕХАНИКА РЕАЛИЗАЦИИ:'); lines.push(v.mech); lines.push(''); }
    if(v.how){ lines.push('КАК ГОТОВИТСЯ:'); lines.push(v.how); lines.push(''); }
    if(v.notes){ lines.push('ЗАМЕТКИ:'); lines.push(v.notes); }
  }

  document.getElementById('sh-preview').textContent = lines.join('\n').trim();
}

async function copyShare(){
  await copyToClipboard(document.getElementById('sh-preview').textContent);
}

async function nativeShare(){
  const text = document.getElementById('sh-preview').textContent;
  const it = items.find(i=>i.id === sharingId);
  if(navigator.share){
    try{ await navigator.share({ title: it?.title || 'Проработка', text }); }
    catch(e){}
  } else {
    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
  }
}

function shareSelected(){
  if(!selectedIds.size) return;
  document.getElementById('shareMultiOverlay').classList.add('open');
  document.body.classList.add('modal-open');
  buildMultiShareText();
}
function closeShareMulti(){
  document.getElementById('shareMultiOverlay').classList.remove('open');
  document.body.classList.remove('modal-open');
}

function buildMultiShareText(){
  const format = document.getElementById('shm-format').value;
  const list = items.filter(i=>selectedIds.has(i.id));
  const lines = [];

  lines.push('Проработки (' + list.length + ')');
  lines.push('');

  if(format === 'names'){
    list.forEach((it, idx)=>{
      lines.push((idx+1) + '. ' + it.title + (it.versions.length > 1 ? ' (v' + it.currentVersion + ')' : ''));
    });
  }

  if(format === 'compact'){
    list.forEach((it, idx)=>{
      const v = it.versions[it.currentVersion - 1];
      lines.push('━━━ ' + (idx+1) + '. ' + it.title + ' ━━━');
      if(it.cat) lines.push('Категория: ' + it.cat);
      if(v.dishware) lines.push('Посуда: ' + v.dishware);
      lines.push('');
      (v.ingredients||[]).forEach(i=>{
        lines.push('• ' + i.name + (i.qty ? ' — ' + i.qty + (i.unit ? ' ' + i.unit : '') : ''));
      });
      if(v.before || v.after){
        lines.push('');
        lines.push('Выход: ' + (v.before||'—') + ' → ' + (v.after||'—') + ' ' + (v.unit||''));
        const ch = calcChange(v.before, v.after);
        if(ch){
          const label = ch.diff > 0 ? 'Прирост' : (ch.diff < 0 ? 'Потери' : '—');
          lines.push(label + ': ' + ch.sign + ch.diff.toFixed(0) + ' (' + ch.sign + ch.pct.toFixed(1) + '%)');
        }
      }
      const fc = calcFC(v);
      if(fc !== null) lines.push('FC: ' + fc.toFixed(1) + '%');
      lines.push('');
    });
  }

  if(format === 'full'){
    list.forEach((it, idx)=>{
      const v = it.versions[it.currentVersion - 1];
      lines.push('═══════════════════════');
      lines.push((idx+1) + '. ' + it.title + (it.versions.length > 1 ? ' (v' + it.currentVersion + ')' : ''));
      lines.push('═══════════════════════');
      if(it.cat) lines.push('Категория: ' + it.cat);
      if(v.dishware) lines.push('Посуда: ' + v.dishware);
      lines.push('Статус: ' + STATUS_LABEL[v.status]);
      lines.push('');
      lines.push('СОСТАВ:');
      (v.ingredients||[]).forEach(i=>{
        lines.push('• ' + i.name + (i.qty ? ' — ' + i.qty + (i.unit ? ' ' + i.unit : '') : ''));
      });
      lines.push('');
      if(v.before || v.after){
        lines.push('ВЫХОДЫ: ' + (v.before||'—') + ' → ' + (v.after||'—') + ' ' + (v.unit||''));
        const ch = calcChange(v.before, v.after);
        if(ch){
          const label = ch.diff > 0 ? 'Прирост' : (ch.diff < 0 ? 'Потери' : 'Без изменений');
          lines.push(label + ': ' + ch.sign + ch.diff.toFixed(0) + ' (' + ch.sign + ch.pct.toFixed(1) + '%)');
        }
        lines.push('');
      }
      if(v.cost || v.price){
        if(v.cost) lines.push('Себестоимость: ' + v.cost + ' ₽');
        if(v.price) lines.push('Цена порции: ' + v.price + ' ₽');
        const fc = calcFC(v);
        if(fc !== null) lines.push('FC: ' + fc.toFixed(1) + '%');
        lines.push('');
      }
      if(v.need){ lines.push('ЧТО НУЖНО:'); lines.push(v.need); lines.push(''); }
      if(v.mech){ lines.push('МЕХАНИКА:'); lines.push(v.mech); lines.push(''); }
      if(v.how){ lines.push('КАК ГОТОВИТСЯ:'); lines.push(v.how); lines.push(''); }
      if(v.notes){ lines.push('ЗАМЕТКИ:'); lines.push(v.notes); lines.push(''); }
    });
  }

  document.getElementById('shm-preview').textContent = lines.join('\n').trim();
}

async function copyMultiShare(){
  await copyToClipboard(document.getElementById('shm-preview').textContent);
}

async function nativeMultiShare(){
  const text = document.getElementById('shm-preview').textContent;
  if(navigator.share){
    try{ await navigator.share({ title: 'Проработки', text }); }
    catch(e){}
  } else {
    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
  }
}

async function copyToClipboard(text){
  try{
    await navigator.clipboard.writeText(text);
    toast('Скопировано');
  }catch(e){
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try{ document.execCommand('copy'); toast('Скопировано'); }
    catch(err){ toast('Не удалось скопировать'); }
    document.body.removeChild(ta);
  }
}

function downloadBackup(){
  const data = JSON.stringify(items, null, 2);
  const blob = new Blob([data], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0,10);
  a.href = url;
  a.download = 'prototypes-' + stamp + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('Файл скачан');
}

function uploadBackup(file){
  if(!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try{
      const data = JSON.parse(e.target.result);
      if(!Array.isArray(data)) throw new Error('ожидался массив');
      const migrated = data.map(migrateItem);
      const replace = confirm(
        'ОК — ЗАМЕНИТЬ текущие данные (' + items.length + ')\n' +
        'Отмена — ДОБАВИТЬ к ним (' + migrated.length + ')'
      );
      if(replace){
        items = migrated;
      } else {
        const ids = new Set(items.map(i=>i.id));
        migrated.forEach(d => { if(!ids.has(d.id)) items.push(d); });
      }
      saveLocal();
      render();
      toast('Загружено: ' + migrated.length);
    }catch(err){
      toast('Ошибка файла: ' + err.message);
    }
  };
  reader.readAsText(file);
}

function openSettings(){
  document.getElementById('s-local-count').textContent = items.length;
  const totalVersions = items.reduce((s, i)=>s + i.versions.length, 0);
  document.getElementById('s-versions-count').textContent = totalVersions;
  document.getElementById('settingsOverlay').classList.add('open');
  document.body.classList.add('modal-open');
}
function closeSettings(){
  document.getElementById('settingsOverlay').classList.remove('open');
  document.body.classList.remove('modal-open');
}

let toastTimer;
function toast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>t.classList.remove('show'), 2000);
}

document.getElementById('overlay').addEventListener('click', e=>{
  if(e.target.id === 'overlay') closeEditor();
});
document.getElementById('settingsOverlay').addEventListener('click', e=>{
  if(e.target.id === 'settingsOverlay') closeSettings();
});
document.getElementById('shareOverlay').addEventListener('click', e=>{
  if(e.target.id === 'shareOverlay') closeShare();
});
document.getElementById('shareMultiOverlay').addEventListener('click', e=>{
  if(e.target.id === 'shareMultiOverlay') closeShareMulti();
});
document.addEventListener('keydown', e=>{
  if(e.key === 'Escape'){
    closeEditor(); closeSettings(); closeShare(); closeShareMulti(); closeStatusPopover();
  }
  if((e.metaKey||e.ctrlKey) && e.key === 'Enter' && document.getElementById('overlay').classList.contains('open')){
    saveCurrent();
  }
});

loadLocal();
render();
checkDraft();
