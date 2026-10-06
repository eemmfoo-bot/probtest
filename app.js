const LS_DATA = 'pm_data_v2';
const LS_DRAFT = 'pm_draft_v1';
const LS_LAST = 'pm_last_opened_v1';
const STATUS_LABEL = {idea:'Идея', test:'Тестирую', done:'Готово', archive:'Архив'};
const STATUS_COLOR = {idea:'var(--warn)', test:'var(--info)', done:'var(--ok)', archive:'var(--text-muted)'};

let items = [];
let currentFilter = 'all';
let currentCatFilter = 'all';
let currentTagFilter = 'all';
let editingId = null;
let currentVersionIdx = 0;
let sharingId = null;
let selectedIds = new Set();
let expandedIds = new Set();
let draftTimer = null;
let popoverTarget = null;
let copyFromTargetId = null;

function genId(){ return 'id_' + Date.now() + '_' + Math.random().toString(36).slice(2,8); }

function emptyVersion(n){
  return {
    n: n, status: 'idea', ingredients: [{name:'',qty:'',unit:''}],
    dishware: '', tags: '',
    ice: '', temp: '', garnish: '',
    time: '', difficulty: '',
    before:'', after:'', unit:'мл', cost:'', price:'',
    need:'', mech:'', how:'', notes:'',
    updated: Date.now(), created: Date.now()
  };
}

function migrateItem(it){
  if(it && it.versions && Array.isArray(it.versions)){
    it.versions.forEach(v=>{
      if(typeof v.dishware === 'undefined') v.dishware = '';
      if(typeof v.tags === 'undefined') v.tags = '';
      if(typeof v.ice === 'undefined') v.ice = '';
      if(typeof v.temp === 'undefined') v.temp = '';
      if(typeof v.garnish === 'undefined') v.garnish = '';
      if(typeof v.time === 'undefined') v.time = '';
      if(typeof v.difficulty === 'undefined') v.difficulty = '';
    });
    return it;
  }
  const v1 = {
    n: 1,
    status: it.status || 'idea',
    ingredients: it.ingredients || [],
    dishware: it.dishware || '',
    tags: it.tags || '',
    ice: it.ice || '', temp: it.temp || '', garnish: it.garnish || '',
    time: it.time || '', difficulty: it.difficulty || '',
    before: it.before || '', after: it.after || '',
    unit: it.unit || '', cost: it.cost || '', price: it.price || '',
    need: it.need || '', mech: it.mech || '', how: it.how || '', notes: it.notes || '',
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
function parseTags(str){
  return String(str||'').split(',').map(t=>t.trim()).filter(Boolean);
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
  if(used.size === 0){ document.getElementById('cat-filters').innerHTML = ''; return; }
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

function renderTagFilters(){
  const used = new Map();
  items.forEach(it=>{
    const v = it.versions[it.currentVersion - 1];
    if(!v) return;
    parseTags(v.tags).forEach(t=>{ used.set(t, (used.get(t) || 0) + 1); });
  });
  if(used.size === 0){ document.getElementById('tag-filters').innerHTML = ''; return; }
  const sorted = Array.from(used.keys()).sort();
  document.getElementById('tag-filters').innerHTML =
    `<div class="label-pill">Теги</div>` +
    `<div class="chip ${currentTagFilter==='all'?'active':''}" onclick="setTagFilter('all')">Все</div>` +
    sorted.map(t=>{
      const safe = esc(t).replace(/'/g,"\\'");
      return `<div class="chip ${currentTagFilter===t?'active':''}" onclick="setTagFilter('${safe}')">
        ${esc(t)}<span class="num">${used.get(t)}</span>
      </div>`;
    }).join('');
}

function setFilter(f){ currentFilter = f; render(); }
function setCatFilter(c){ currentCatFilter = c; render(); }
function setTagFilter(t){ currentTagFilter = t; render(); }

function render(){
  renderStatusFilters();
  renderCatFilters();
  renderTagFilters();
  setStatus(false);
  const q = (document.getElementById('q').value || '').toLowerCase().trim();
  const sort = document.getElementById('sort').value;
  const list = document.getElementById('list');

  let filtered = items.filter(it=>{
    const v = it.versions[it.currentVersion - 1];
    if(!v) return false;
    if(currentFilter !== 'all' && v.status !== currentFilter) return false;
    if(currentCatFilter !== 'all' && it.cat !== currentCatFilter) return false;
    if(currentTagFilter !== 'all' && !parseTags(v.tags).includes(currentTagFilter)) return false;
    if(!q) return true;
    const hay = [
      it.title, it.cat, v.dishware, v.tags, v.ice, v.temp, v.garnish, v.difficulty,
      v.need, v.mech, v.how, v.notes,
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
  const isExpanded = expandedIds.has(it.id);
  const showV = it.versions.length > 1;
  const tags = parseTags(v.tags);

  const iconTag = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="7" cy="7" r="1.2" fill="currentColor"/></svg>`;
  const iconGlass = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 2h8l-1 8v9a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-9L8 2z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M7 2h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  const iconFlask = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9 3h6M10 3v5.5L5.5 17a2.5 2.5 0 0 0 2.2 3.5h8.6a2.5 2.5 0 0 0 2.2-3.5L14 8.5V3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const iconScale = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 3v18M5 7h14M7 7l-3 6a3 3 0 0 0 6 0L7 7zM17 7l-3 6a3 3 0 0 0 6 0l-3-6z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const iconCheck = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="m5 12 5 5 9-11" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const iconChev = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><polyline points="6 9 12 15 18 9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  let details = '';
  if(isExpanded){
    const parts = [];
    if((v.ingredients||[]).length){
      const ingHtml = v.ingredients.map(i=>{
        const qty = i.qty ? ` — <b>${esc(i.qty)}${i.unit?' '+esc(i.unit):''}</b>` : '';
        return `• ${esc(i.name)}${qty}`;
      }).join('<br>');
      parts.push(`<div class="detail-block">
        <div class="detail-label">Состав</div>
        <div class="detail-ing">${ingHtml}</div>
      </div>`);
    }
    const serveParts = [];
    if(v.ice) serveParts.push(esc(v.ice));
    if(v.temp) serveParts.push(esc(v.temp));
    if(v.garnish) serveParts.push('Гарнир: ' + esc(v.garnish));
    if(v.time) serveParts.push('Время: ' + esc(v.time) + ' мин');
    if(v.difficulty) serveParts.push('Сложность: ' + esc(v.difficulty));
    if(serveParts.length){
      parts.push(`<div class="detail-block">
        <div class="detail-label">Подача</div>
        <div class="detail-text">${serveParts.join(' · ')}</div>
      </div>`);
    }
    if(v.before || v.after){
      let yieldText = `${v.before||'—'} → ${v.after||'—'}${v.unit?' '+esc(v.unit):''}`;
      const ch = calcChange(v.before, v.after);
      if(ch){
        const label = ch.diff > 0 ? 'прирост' : (ch.diff < 0 ? 'потери' : 'без изменений');
        yieldText += ` · ${label} ${ch.sign}${ch.diff.toFixed(0)} (${ch.sign}${ch.pct.toFixed(1)}%)`;
      }
      parts.push(`<div class="detail-block">
        <div class="detail-label">Выход</div>
        <div class="detail-text">${esc(yieldText)}</div>
      </div>`);
    }
    if(v.cost || v.price){
      const fc2 = calcFC(v);
      const items2 = [];
      if(v.cost) items2.push(`Себестоимость: <b>${esc(v.cost)} ₽</b>`);
      if(v.price) items2.push(`Цена: <b>${esc(v.price)} ₽</b>`);
      if(fc2 !== null) items2.push(`FC: <b>${fc2.toFixed(1)}%</b>`);
      parts.push(`<div class="detail-block">
        <div class="detail-label">Экономика</div>
        <div class="detail-econ">${items2.join(' · ')}</div>
      </div>`);
    }
    if(v.need) parts.push(`<div class="detail-block"><div class="detail-label">Что нужно</div><div class="detail-text">${esc(v.need)}</div></div>`);
    if(v.mech) parts.push(`<div class="detail-block"><div class="detail-label">Механика</div><div class="detail-text">${esc(v.mech)}</div></div>`);
    if(v.how) parts.push(`<div class="detail-block"><div class="detail-label">Как готовится</div><div class="detail-text">${esc(v.how)}</div></div>`);
    if(v.notes) parts.push(`<div class="detail-block"><div class="detail-label">Заметки</div><div class="detail-text">${esc(v.notes)}</div></div>`);

    details = `<div class="card-details"><div class="card-details-inner">${
      parts.length ? parts.join('') :
      '<div class="detail-text" style="text-align:center;color:var(--text-muted)">Детали не заполнены</div>'
    }</div></div>`;
  }

  return `
    <div class="card ${isSelected?'selected':''} ${isExpanded?'expanded':''}"
         style="--status-color:${STATUS_COLOR[v.status]||'var(--accent)'}"
         data-id="${it.id}">
      <div class="card-check" onclick="toggleCardSelect(event, '${it.id}')" aria-label="Выбрать">
        ${iconCheck}
      </div>
      <div onclick="cardClick(event, '${it.id}')">
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
        ${tags.length?`<div class="card-tags">
          ${tags.map(t=>`<span class="card-tag" onclick="event.stopPropagation(); setTagFilter('${esc(t).replace(/'/g,"\\'")}')">#${esc(t)}</span>`).join('')}
        </div>`:''}
      </div>
      ${details}
      <div class="card-footer">
        <div class="card-date">${fmtDate(it.updated)}</div>
        <button class="card-expand-btn" onclick="toggleExpand(event, '${it.id}')">
          <span>${isExpanded?'Свернуть':'Развернуть'}</span>
          ${iconChev}
        </button>
      </div>
    </div>`;
}

function cardClick(ev, id){
  if(ev.target.closest('.card-check') || ev.target.closest('.status')
     || ev.target.closest('.card-expand-btn') || ev.target.closest('.card-tag')) return;
  if(selectedIds.size > 0){ toggleCardSelect(ev, id); return; }
  openEditor(id);
}

function toggleExpand(ev, id){
  ev.stopPropagation();
  if(expandedIds.has(id)) expandedIds.delete(id);
  else expandedIds.add(id);
  const it = items.find(i=>i.id===id);
  if(!it) return;
  const card = document.querySelector(`.card[data-id="${id}"]`);
  if(!card) return;
  const wrapper = document.createElement('div');
  wrapper.innerHTML = cardHTML(it).trim();
  const newCard = wrapper.firstElementChild;
  if(newCard) card.replaceWith(newCard);
  else render();
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
  closeStatusPicker();
}
function updateSelectionBar(){
  const bar = document.getElementById('selectionBar');
  const cnt = document.getElementById('selCount');
  cnt.textContent = selectedIds.size;
  if(selectedIds.size > 0) bar.classList.add('show');
  else { bar.classList.remove('show'); closeStatusPicker(); }
}

function toggleStatusPicker(ev){
  ev.stopPropagation();
  const p = document.getElementById('bulkStatusPicker');
  p.classList.toggle('open');
}
function closeStatusPicker(){
  const p = document.getElementById('bulkStatusPicker');
  if(p) p.classList.remove('open');
}
document.addEventListener('click', e=>{
  if(!e.target.closest('.status-picker-wrap')) closeStatusPicker();
});

function bulkSetStatus(status){
  if(!selectedIds.size) return;
  const n = selectedIds.size;
  if(!confirm(`Перевести ${n} ${plural(n,'проработку','проработки','проработок')} в статус «${STATUS_LABEL[status]}»?`)) return;
  items.forEach(it=>{
    if(selectedIds.has(it.id)){
      it.versions[it.currentVersion - 1].status = status;
      it.updated = Date.now();
    }
  });
  saveLocal();
  clearSelection();
  render();
  toast(`Обновлено: ${n}`);
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

/* ====== ПАРСЕР ИНГРЕДИЕНТОВ ====== */
function openParser(){
  const input = document.getElementById('parser-input');
  const prev = document.getElementById('parser-preview');
  if(!input || !prev) return;
  input.value = '';
  prev.textContent = '—';
  document.getElementById('parserOverlay').classList.add('open');
  setTimeout(()=>input.focus(), 100);
}
function closeParser(){
  const el = document.getElementById('parserOverlay');
  if(el) el.classList.remove('open');
}

function parseIngredientLine(line){
  let s = line.trim().replace(/^[•\-*]\s*/, '');
  if(!s) return null;
  const unitPattern = '(мл|ml|г|гр|g|кг|kg|л|l|шт|pcs|dash|дэш|кап|капли|щепотка|bitters|біттер|бітер)';
  let name = '', qty = '', unit = '';

  let m = s.match(new RegExp('^(.+?)\\s*[—–\\-:]?\\s*([\\d.,/]+)\\s*' + unitPattern + '?\\s*$', 'i'));
  if(m){
    name = m[1].trim();
    qty = m[2].trim();
    unit = (m[3] || '').trim().toLowerCase();
    if(/^[\d.,/]+$/.test(name) && !m[3]){
      name = '';
    }
  } else {
    m = s.match(new RegExp('^([\\d.,/]+)\\s*' + unitPattern + '?\\s+(.+)$', 'i'));
    if(m){
      qty = m[1].trim();
      unit = (m[2] || '').trim().toLowerCase();
      name = m[3].trim();
    } else {
      name = s;
    }
  }

  const unitMap = {
    'ml':'мл', 'мл':'мл',
    'g':'г', 'гр':'г', 'г':'г',
    'kg':'кг', 'кг':'кг',
    'l':'л', 'л':'л',
    'pcs':'шт', 'шт':'шт',
    'dash':'дэш', 'дэш':'дэш',
    'кап':'кап', 'капли':'кап',
    'щепотка':'щепотка',
    'bitters':'биттер', 'біттер':'биттер', 'бітер':'биттер'
  };
  if(unit && unitMap[unit]) unit = unitMap[unit];

  if(!name) return null;
  return { name, qty, unit };
}

function parseIngredientsText(text){
  if(!text) return [];
  const parts = String(text)
    .split(/[\n;,]+/)
    .map(s=>s.trim())
    .filter(Boolean);
  const out = [];
  parts.forEach(p=>{
    const ing = parseIngredientLine(p);
    if(ing) out.push(ing);
  });
  return out;
}

function updateParserPreview(){
  const input = document.getElementById('parser-input');
  const el = document.getElementById('parser-preview');
  if(!input || !el) return;
  const ings = parseIngredientsText(input.value);
  if(!ings.length){
    el.textContent = '—';
    return;
  }
  el.textContent = ings.map(i=>{
    const qty = i.qty ? ' — ' + i.qty + (i.unit?' '+i.unit:'') : '';
    return '• ' + i.name + qty;
  }).join('\n');
}

function applyParser(){
  const input = document.getElementById('parser-input');
  if(!input) return;
  const ings = parseIngredientsText(input.value);
  if(!ings.length){
    toast('Не удалось ничего разобрать');
    return;
  }
  const list = document.getElementById('ing-list');
  const emptyRows = Array.from(list.querySelectorAll('.ing-row')).filter(r=>{
    const inputs = r.querySelectorAll('input');
    return !inputs[0].value.trim() && !inputs[1].value.trim();
  });
  emptyRows.forEach(r=>r.remove());
  ings.forEach(ing=>addIng(ing));
  scheduleDraft();
  closeParser();
  toast('Добавлено: ' + ings.length);
}

document.addEventListener('input', e=>{
  if(e.target.id === 'parser-input') updateParserPreview();
});

/* ====== РЕДАКТОР ====== */
function openEditor(id){
  editingId = id || null;
  currentVersionIdx = 0;
  const it = id ? items.find(i=>i.id===id) : null;
  window._tempNewItem = null;

  if(id){
    try{ localStorage.setItem(LS_LAST, id); }catch(e){}
  }

  document.getElementById('modalTitle').textContent = it ? 'Редактировать' : 'Новая проработка';
  document.getElementById('deleteBtn').style.display = it ? 'grid' : 'none';
  document.getElementById('dupBtn').style.display = it ? 'grid' : 'none';
  document.getElementById('copyFromBtn').style.display = it ? 'grid' : 'none';
  document.getElementById('historyBtn').style.display = (it && it.versions.length > 1) ? 'grid' : 'none';
  document.getElementById('printBtn').style.display = it ? 'grid' : 'none';
  document.getElementById('shareBtn').style.display = it ? 'grid' : 'none';

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
  const histBtn = document.getElementById('historyBtn');
  if(histBtn) histBtn.style.display = (editingId && it.versions.length > 1) ? 'grid' : 'none';
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
  const el = id => document.getElementById(id);
  el('f-status').value = v.status || 'idea';
  el('f-ice').value = v.ice || '';
  el('f-temp').value = v.temp || '';
  el('f-garnish').value = v.garnish || '';
  el('f-time').value = v.time || '';
  el('f-difficulty').value = v.difficulty || '';
  el('f-dishware').value = v.dishware || '';
  el('f-tags').value = v.tags || '';
  el('f-before').value = v.before || '';
  el('f-after').value = v.after || '';
  el('f-unit').value = v.unit || 'мл';
  el('f-cost').value = v.cost || '';
  el('f-price').value = v.price || '';
  el('f-need').value = v.need || '';
  el('f-mech').value = v.mech || '';
  el('f-how').value = v.how || '';
  el('f-notes').value = v.notes || '';
  el('ing-list').innerHTML = '';
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
  v.ice = el('f-ice').value;
  v.temp = el('f-temp').value;
  v.garnish = el('f-garnish').value.trim();
  v.time = el('f-time').value.trim();
  v.difficulty = el('f-difficulty').value;
  v.dishware = el('f-dishware').value.trim();
  v.tags = el('f-tags').value.trim();
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
  wrap.draggable = false;
  wrap.innerHTML = `
    <button class="ing-drag" aria-label="Перетащить" type="button">
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="9" cy="6" r="1.5" fill="currentColor"/>
        <circle cx="15" cy="6" r="1.5" fill="currentColor"/>
        <circle cx="9" cy="12" r="1.5" fill="currentColor"/>
        <circle cx="15" cy="12" r="1.5" fill="currentColor"/>
        <circle cx="9" cy="18" r="1.5" fill="currentColor"/>
        <circle cx="15" cy="18" r="1.5" fill="currentColor"/>
      </svg>
    </button>
    <input placeholder="Ингредиент" value="${esc(data.name)}" data-k="name">
    <input placeholder="Кол-во" value="${esc(data.qty)}" data-k="qty" inputmode="decimal">
    <input placeholder="ед." value="${esc(data.unit)}" data-k="unit">
    <button class="del" type="button" aria-label="Удалить" onclick="this.parentNode.remove()">✕</button>
  `;
  document.getElementById('ing-list').appendChild(wrap);
  attachIngDragEvents(wrap);
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

let dragSrcEl = null;

function attachIngDragEvents(el){
  const handle = el.querySelector('.ing-drag');
  if(!handle) return;

  handle.addEventListener('mousedown', ()=>{ el.draggable = true; });
  el.addEventListener('dragstart', e=>{
    dragSrcEl = el;
    el.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try{ e.dataTransfer.setData('text/html', ''); }catch(err){}
  });
  el.addEventListener('dragend', ()=>{
    el.classList.remove('dragging');
    el.draggable = false;
    document.querySelectorAll('.ing-row.drag-over').forEach(r=>r.classList.remove('drag-over'));
    dragSrcEl = null;
  });
  el.addEventListener('dragover', e=>{
    e.preventDefault();
    if(!dragSrcEl || dragSrcEl === el) return;
    el.classList.add('drag-over');
  });
  el.addEventListener('dragleave', ()=>{ el.classList.remove('drag-over'); });
  el.addEventListener('drop', e=>{
    e.preventDefault();
    el.classList.remove('drag-over');
    if(!dragSrcEl || dragSrcEl === el) return;
    const parent = el.parentNode;
    const children = Array.from(parent.children);
    const srcIdx = children.indexOf(dragSrcEl);
    const dstIdx = children.indexOf(el);
    if(srcIdx < dstIdx) parent.insertBefore(dragSrcEl, el.nextSibling);
    else parent.insertBefore(dragSrcEl, el);
    scheduleDraft();
  });

  let touchTimer = null;
  let touchActive = false;
  handle.addEventListener('touchstart', ()=>{
    touchTimer = setTimeout(()=>{
      touchActive = true;
      el.classList.add('dragging');
      if(navigator.vibrate) navigator.vibrate(20);
    }, 400);
  }, {passive:true});
  handle.addEventListener('touchmove', e=>{
    if(!touchActive) return;
    e.preventDefault();
    const touch = e.touches[0];
    const elBelow = document.elementFromPoint(touch.clientX, touch.clientY);
    const targetRow = elBelow?.closest?.('.ing-row');
    document.querySelectorAll('.ing-row.drag-over').forEach(r=>r.classList.remove('drag-over'));
    if(targetRow && targetRow !== el) targetRow.classList.add('drag-over');
  }, {passive:false});
  handle.addEventListener('touchend', e=>{
    clearTimeout(touchTimer);
    if(!touchActive) return;
    touchActive = false;
    el.classList.remove('dragging');
    const touch = e.changedTouches[0];
    const elBelow = document.elementFromPoint(touch.clientX, touch.clientY);
    const targetRow = elBelow?.closest?.('.ing-row');
    document.querySelectorAll('.ing-row.drag-over').forEach(r=>r.classList.remove('drag-over'));
    if(targetRow && targetRow !== el){
      const parent = el.parentNode;
      const children = Array.from(parent.children);
      const srcIdx = children.indexOf(el);
      const dstIdx = children.indexOf(targetRow);
      if(srcIdx < dstIdx) parent.insertBefore(el, targetRow.nextSibling);
      else parent.insertBefore(el, targetRow);
      scheduleDraft();
    }
  });
  handle.addEventListener('touchcancel', ()=>{
    clearTimeout(touchTimer);
    touchActive = false;
    el.classList.remove('dragging');
    document.querySelectorAll('.ing-row.drag-over').forEach(r=>r.classList.remove('drag-over'));
  });
}

document.addEventListener('keydown', e=>{
  if(e.key !== 'Enter') return;
  const overlay = document.getElementById('overlay');
  if(!overlay.classList.contains('open')) return;
  const target = e.target;
  if(!target || target.tagName === 'TEXTAREA') return;

  e.preventDefault();
  const modal = overlay.querySelector('.modal');
  if(!modal) return;

  const fields = Array.from(modal.querySelectorAll('input:not([readonly]):not([type=file]), select, textarea'))
    .filter(el => el.offsetParent !== null && !el.disabled);

  const idx = fields.indexOf(target);
  if(idx === -1) return;

  if(target.dataset.k === 'unit'){
    const row = target.closest('.ing-row');
    const nextRow = row.nextElementSibling;
    if(!nextRow || !nextRow.classList.contains('ing-row')){
      addIng();
      const rows = document.querySelectorAll('#ing-list .ing-row');
      const newRow = rows[rows.length - 1];
      const newInput = newRow.querySelector('input');
      if(newInput){
        newInput.focus();
        scrollToField(newInput);
      }
      scheduleDraft();
      return;
    }
  }

  const next = fields[idx + 1];
  if(next){
    next.focus();
    scrollToField(next);
  }
});

function scrollToField(el){
  try{ el.scrollIntoView({behavior:'smooth', block:'center'}); }
  catch(e){ el.scrollIntoView(false); }
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
  document.getElementById('deleteBtn').style.display = d.editingId ? 'grid' : 'none';
  document.getElementById('dupBtn').style.display = d.editingId ? 'grid' : 'none';
  document.getElementById('copyFromBtn').style.display = d.editingId ? 'grid' : 'none';
  document.getElementById('historyBtn').style.display = (d.editingId && it.versions.length > 1) ? 'grid' : 'none';
  document.getElementById('printBtn').style.display = d.editingId ? 'grid' : 'none';
  document.getElementById('shareBtn').style.display = d.editingId ? 'grid' : 'none';
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

/* ====== ПЕЧАТЬ ====== */
function printCurrent(){
  if(!editingId) return;
  saveCurrentVersionToMemory();
  const it = items.find(i=>i.id === editingId);
  if(!it) return;
  const n = it.versions[currentVersionIdx].n;
  const url = 'print.html?id=' + encodeURIComponent(it.id) + '&v=' + n + '&print=1';
  window.open(url, '_blank');
}

/* ====== ИСТОРИЯ ====== */
function openHistory(){
  if(!editingId) return;
  const it = items.find(i=>i.id === editingId);
  if(!it || it.versions.length < 2) return;
  saveCurrentVersionToMemory();
  const fromSel = document.getElementById('hist-from');
  const toSel = document.getElementById('hist-to');
  const opts = it.versions.map(v=>`<option value="${v.n}">v${v.n}</option>`).join('');
  fromSel.innerHTML = opts;
  toSel.innerHTML = opts;
  fromSel.value = String(it.versions[it.versions.length - 2].n);
  toSel.value = String(it.versions[it.versions.length - 1].n);
  renderHistoryDiff();
  document.getElementById('historyOverlay').classList.add('open');
  document.body.classList.add('modal-open');
}
function closeHistory(){
  document.getElementById('historyOverlay').classList.remove('open');
  document.body.classList.remove('modal-open');
}

function renderHistoryDiff(){
  if(!editingId) return;
  const it = items.find(i=>i.id === editingId);
  if(!it) return;
  const fromN = parseInt(document.getElementById('hist-from').value);
  const toN = parseInt(document.getElementById('hist-to').value);
  const vA = it.versions.find(x=>x.n===fromN);
  const vB = it.versions.find(x=>x.n===toN);
  const body = document.getElementById('hist-body');
  if(!vA || !vB){ body.innerHTML = '<div class="diff-empty">Выбери две версии</div>'; return; }
  if(vA.n === vB.n){ body.innerHTML = '<div class="diff-empty">Это одна и та же версия</div>'; return; }

  const parts = [];

  if(vA.status !== vB.status){
    parts.push(`<div class="diff-item chg"><div class="diff-label">Статус</div>${esc(STATUS_LABEL[vA.status])} → ${esc(STATUS_LABEL[vB.status])}</div>`);
  }
  if((vA.dishware||'') !== (vB.dishware||'')){
    if(!vA.dishware && vB.dishware) parts.push(`<div class="diff-item add"><div class="diff-label">Посуда</div>+ ${esc(vB.dishware)}</div>`);
    else if(vA.dishware && !vB.dishware) parts.push(`<div class="diff-item del"><div class="diff-label">Посуда</div>− ${esc(vA.dishware)}</div>`);
    else parts.push(`<div class="diff-item chg"><div class="diff-label">Посуда</div>${esc(vA.dishware)} → ${esc(vB.dishware)}</div>`);
  }
  const tagsA = parseTags(vA.tags);
  const tagsB = parseTags(vB.tags);
  const tagsAdded = tagsB.filter(t=>!tagsA.includes(t));
  const tagsRemoved = tagsA.filter(t=>!tagsB.includes(t));
  if(tagsAdded.length || tagsRemoved.length){
    let html = '';
    if(tagsAdded.length) html += `<div style="color:var(--ok)">+ ${tagsAdded.map(esc).join(', ')}</div>`;
    if(tagsRemoved.length) html += `<div style="color:var(--danger)">− ${tagsRemoved.map(esc).join(', ')}</div>`;
    parts.push(`<div class="diff-item chg"><div class="diff-label">Теги</div>${html}</div>`);
  }

  const ingA = vA.ingredients || [];
  const ingB = vB.ingredients || [];
  const keyOf = i => (i.name||'').toLowerCase() + '|' + (i.qty||'') + '|' + (i.unit||'');
  const nameOf = i => (i.name||'').toLowerCase();
  const mapA = new Map(ingA.map(i=>[nameOf(i), i]));
  const mapB = new Map(ingB.map(i=>[nameOf(i), i]));

  ingB.forEach(iB=>{
    const name = nameOf(iB);
    const iA = mapA.get(name);
    const strB = `${iB.name}${iB.qty?' — '+iB.qty+(iB.unit?' '+iB.unit:''):''}`;
    if(!iA){
      parts.push(`<div class="diff-item add"><div class="diff-label">Ингредиент добавлен</div>+ ${esc(strB)}</div>`);
    } else if(keyOf(iA) !== keyOf(iB)){
      const strA = `${iA.name}${iA.qty?' — '+iA.qty+(iA.unit?' '+iA.unit:''):''}`;
      parts.push(`<div class="diff-item chg"><div class="diff-label">Ингредиент изменён</div>${esc(strA)} → ${esc(strB)}</div>`);
    }
  });
  ingA.forEach(iA=>{
    const name = nameOf(iA);
    if(!mapB.has(name)){
      const strA = `${iA.name}${iA.qty?' — '+iA.qty+(iA.unit?' '+iA.unit:''):''}`;
      parts.push(`<div class="diff-item del"><div class="diff-label">Ингредиент удалён</div>− ${esc(strA)}</div>`);
    }
  });

  if((vA.before||'') !== (vB.before||'')) parts.push(`<div class="diff-item chg"><div class="diff-label">Выход 1</div>${esc(vA.before||'—')} → ${esc(vB.before||'—')}</div>`);
  if((vA.after||'') !== (vB.after||'')) parts.push(`<div class="diff-item chg"><div class="diff-label">Выход 2</div>${esc(vA.after||'—')} → ${esc(vB.after||'—')}</div>`);
  if((vA.unit||'') !== (vB.unit||'')) parts.push(`<div class="diff-item chg"><div class="diff-label">Единица</div>${esc(vA.unit||'—')} → ${esc(vB.unit||'—')}</div>`);
  if((vA.cost||'') !== (vB.cost||'')) parts.push(`<div class="diff-item chg"><div class="diff-label">Себестоимость</div>${esc(vA.cost||'—')} → ${esc(vB.cost||'—')}</div>`);
  if((vA.price||'') !== (vB.price||'')) parts.push(`<div class="diff-item chg"><div class="diff-label">Цена порции</div>${esc(vA.price||'—')} → ${esc(vB.price||'—')}</div>`);

  [['ice','Подача'],['temp','Температура'],['garnish','Гарнир'],['time','Время'],['difficulty','Сложность']].forEach(([k, label])=>{
    const a = (vA[k]||'').trim();
    const b = (vB[k]||'').trim();
    if(a === b) return;
    parts.push(`<div class="diff-item chg"><div class="diff-label">${label}</div>${esc(a||'—')} → ${esc(b||'—')}</div>`);
  });

  [['need','Что нужно'],['mech','Механика'],['how','Как готовится'],['notes','Заметки']].forEach(([k, label])=>{
    const a = (vA[k]||'').trim();
    const b = (vB[k]||'').trim();
    if(a === b) return;
    if(!a && b) parts.push(`<div class="diff-item add"><div class="diff-label">${label} — добавлено</div>${esc(b)}</div>`);
    else if(a && !b) parts.push(`<div class="diff-item del"><div class="diff-label">${label} — удалено</div>${esc(a)}</div>`);
    else parts.push(`<div class="diff-item chg"><div class="diff-label">${label}</div>
        <div style="color:var(--danger);text-decoration:line-through;opacity:.7">${esc(a)}</div>
        <div style="color:var(--ok);margin-top:4px">${esc(b)}</div>
      </div>`);
  });

  body.innerHTML = parts.length ? parts.join('') : '<div class="diff-empty">Версии идентичны по содержимому</div>';
}

/* ====== КОПИРОВАНИЕ СОСТАВА ====== */
function openCopyFrom(){
  if(!editingId) return;
  copyFromTargetId = null;
  document.getElementById('copy-search').value = '';
  renderCopyFromList();
  document.getElementById('copyFromOverlay').classList.add('open');
  document.body.classList.add('modal-open');
}
function closeCopyFrom(){
  document.getElementById('copyFromOverlay').classList.remove('open');
  document.body.classList.remove('modal-open');
  copyFromTargetId = null;
}
function renderCopyFromList(){
  const q = (document.getElementById('copy-search').value || '').toLowerCase().trim();
  const list = document.getElementById('copy-from-list');
  const candidates = items.filter(i=>{
    if(i.id === editingId) return false;
    if(!q) return true;
    const v = i.versions[i.currentVersion - 1];
    const hay = [i.title, i.cat, ...(v.ingredients||[]).map(x=>x.name)].join(' ').toLowerCase();
    return hay.includes(q);
  }).slice(0, 50);

  if(!candidates.length){
    list.innerHTML = '<div class="diff-empty">Ничего не найдено</div>';
    return;
  }
  list.innerHTML = candidates.map(it=>{
    const v = it.versions[it.currentVersion - 1];
    const ingCount = (v.ingredients||[]).length;
    return `<div class="copy-item" onclick="pickCopyFrom('${it.id}')">
      <div class="copy-title">${esc(it.title)}</div>
      <div class="copy-sub">${it.cat?esc(it.cat)+' · ':''}${ingCount} ингр.${it.versions.length>1?' · v'+it.currentVersion:''}</div>
    </div>`;
  }).join('');
}
function pickCopyFrom(id){
  const src = items.find(i=>i.id===id);
  if(!src) return;
  const srcV = src.versions[src.currentVersion - 1];
  if(!confirm(`Заменить состав текущей версии составом из «${src.title}»?`)) return;
  document.getElementById('ing-list').innerHTML = '';
  const ings = (srcV.ingredients && srcV.ingredients.length) ? srcV.ingredients : [{name:'',qty:'',unit:''}];
  ings.forEach(addIng.bind(null));
  if(srcV.unit) document.getElementById('f-unit').value = srcV.unit;
  scheduleDraft();
  closeCopyFrom();
  toast('Состав скопирован');
}

/* ====== SHARE ====== */
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
  const tags = parseTags(v.tags);
  if(tags.length) lines.push('Теги: ' + tags.map(t=>'#'+t).join(' '));
  lines.push('Статус: ' + STATUS_LABEL[v.status]);
  lines.push('');

  const yieldLine = (v.before || v.after)
    ? `${v.before||'—'} → ${v.after||'—'} ${v.unit||''}`.trim() : '';

  const serveLine = [];
  if(v.ice) serveLine.push(v.ice);
  if(v.temp) serveLine.push(v.temp);
  if(v.garnish) serveLine.push('Гарнир: ' + v.garnish);
  if(v.time) serveLine.push('Время: ' + v.time + ' мин');
  if(v.difficulty) serveLine.push('Сложность: ' + v.difficulty);

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
    if(serveLine.length){
      lines.push('ПОДАЧА:');
      serveLine.forEach(l=>lines.push('• ' + l));
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
    if(serveLine.length){
      lines.push('ПОДАЧА:');
      serveLine.forEach(l=>lines.push('• ' + l));
      lines.push('');
    }
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
  closeStatusPicker();
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
      const tags = parseTags(v.tags);
      if(tags.length) lines.push('Теги: ' + tags.map(t=>'#'+t).join(' '));
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
      const serveLine = [];
      if(v.ice) serveLine.push(v.ice);
      if(v.temp) serveLine.push(v.temp);
      if(v.garnish) serveLine.push('Гарнир: ' + v.garnish);
      if(v.time) serveLine.push('Время: ' + v.time + ' мин');
      if(v.difficulty) serveLine.push('Сложность: ' + v.difficulty);
      if(serveLine.length){
        lines.push('ПОДАЧА:');
        serveLine.forEach(l=>lines.push('• ' + l));
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
      if(replace){ items = migrated; }
      else {
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
document.getElementById('historyOverlay').addEventListener('click', e=>{
  if(e.target.id === 'historyOverlay') closeHistory();
});
document.getElementById('copyFromOverlay').addEventListener('click', e=>{
  if(e.target.id === 'copyFromOverlay') closeCopyFrom();
});
document.getElementById('parserOverlay').addEventListener('click', e=>{
  if(e.target.id === 'parserOverlay') closeParser();
});
document.addEventListener('keydown', e=>{
  if(e.key === 'Escape'){
    closeEditor(); closeSettings(); closeShare(); closeShareMulti();
    closeHistory(); closeCopyFrom(); closeStatusPopover(); closeStatusPicker(); closeParser();
  }
  if((e.metaKey||e.ctrlKey) && e.key === 'Enter' && document.getElementById('overlay').classList.contains('open')){
    saveCurrent();
  }
});

loadLocal();
render();
checkDraft();

(function(){
  try{
    const lastId = localStorage.getItem(LS_LAST);
    if(!lastId) return;
    const exists = items.find(i=>i.id === lastId);
    if(!exists) return;
    setTimeout(()=>{
      const card = document.querySelector(`.card[data-id="${lastId}"]`);
      if(card){
        card.scrollIntoView({behavior:'smooth', block:'center'});
        card.style.transition = 'box-shadow .5s';
        card.style.boxShadow = '0 0 0 3px var(--accent)';
        setTimeout(()=>{ card.style.boxShadow = ''; }, 2000);
      }
    }, 300);
  }catch(e){}
})();
