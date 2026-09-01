// OBS 着色器选型器 —— Dock 版。无后端：数据来自 data.js，直连 obs-websocket。
const $ = s => document.querySelector(s);
let groups = [];
let items = [];
let activeCat = 'all';
let applied = null;
let searchText = '';
let currentFile = null;
let ZH = {}; // 参数名中文翻译表（来自 data.js）
let lang = 'zh'; // 汉化包默认中文，可切英文

const DATA = window.__SP_DATA__;
if (!DATA) {
  document.getElementById('status').textContent = 'data.js 加载失败，请确认与面板同目录';
  throw new Error('__SP_DATA__ missing');
}
groups = DATA.groups;
items = DATA.items;
ZH = DATA.zhParams || {};

const DEFAULTS = window.__SP_CONFIG__ || {};
const SKEY = 'obs-shaderpicker-settings';
function loadSettings() {
  try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(SKEY) || '{}')); }
  catch (e) { return Object.assign({}, DEFAULTS); }
}
let cfg = loadSettings();
function saveSettings() { localStorage.setItem(SKEY, JSON.stringify(cfg)); }

const I18N = {
  en: {
    appTitle: 'OBS Shader Picker',
    searchPh: 'Search effects / params…',
    applyToTitle: 'Apply to source',
    connecting: 'Connecting OBS…',
    loadFail: 'Load failed: ',
    switchTo: '中文',
    effectParams: 'Effect Parameters',
    emptyCard: 'Click a card to load params',
    paramLoadFail: 'Params load failed: ',
    noParams: 'No adjustable parameters',
    switching: 'Switching…',
    applied: 'Applied ',
    switchFail: 'Switch failed: ',
    reqFail: 'Request failed: ',
    paramSyncing: 'Syncing…',
    paramSynced: 'Synced',
    paramFail: 'Param update failed: ',
    noMatch: 'No matching effects',
    paramsBadge: n => n + ' params',
    transition: 'Transition',
    current: '● Current',
    alpha: 'Alpha',
    connected: 'OBS connected',
    disconnected: 'OBS disconnected',
    connectFail: 'Cannot reach OBS. Check address/password, click ⚙.',
  },
  zh: {
    appTitle: 'OBS 着色器选型器',
    searchPh: '搜索效果 / 参数名…',
    applyToTitle: '应用到哪个源',
    connecting: '连接 OBS…',
    loadFail: '加载失败: ',
    switchTo: 'EN',
    effectParams: '效果参数',
    emptyCard: '点卡片加载参数',
    paramLoadFail: '参数加载失败: ',
    noParams: '该效果无可调参数',
    switching: '切换中…',
    applied: '已应用 ',
    switchFail: '切换失败: ',
    reqFail: '请求失败: ',
    paramSyncing: '调参中…',
    paramSynced: '参数已同步',
    paramFail: '调参失败: ',
    noMatch: '没有匹配的效果',
    paramsBadge: n => n + ' 参数',
    transition: '转场',
    current: '● 当前',
    alpha: '透明度',
    connected: 'OBS 已连接',
    disconnected: 'OBS 连接断开',
    connectFail: '连不上 OBS。检查地址/密码，点 ⚙ 设置',
  }
};
const T = () => I18N[lang];

function i18nName(item) { return lang === 'zh' ? (item.zh || item.name) : item.name; }
function i18nDesc(item) { return lang === 'zh' ? (item.zhDesc || item.desc || '') : (item.desc || ''); }
function i18nLabel(p) {
  if (lang !== 'zh') return p.name;
  const lab = p.label || p.name;
  return ZH[lab.trim().toLowerCase()] || lab;
}

// ===== obs-websocket v5 直连（复刻原 server.js callOBS 逻辑）=====
let ws = null;
let wsReady = false;
let reqId = 0;
const pending = {};

async function b64sha(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  const a = new Uint8Array(buf);
  let b = '';
  for (let i = 0; i < a.length; i++) b += String.fromCharCode(a[i]);
  return btoa(b);
}

function connect() {
  $('#status').textContent = T().connecting + ' ' + cfg.obsUrl;
  if (ws) { try { ws.close(); } catch (e) {} }
  wsReady = false;
  ws = new WebSocket(cfg.obsUrl);
  ws.onmessage = async (ev) => {
    const m = JSON.parse(ev.data);
    if (m.op === 0) { // Hello
      const a = m.d.authentication;
      let auth;
      if (a) {
        const h1 = await b64sha(cfg.password + a.salt);
        auth = await b64sha(h1 + a.challenge);
      }
      ws.send(JSON.stringify({ op: 1, d: { rpcVersion: 1, authentication: auth } }));
    } else if (m.op === 2) { // Identified
      wsReady = true;
      $('#status').textContent = T().connected;
      syncSources();
      startSync();
    } else if (m.op === 7) { // RequestResponse
      const d = m.d;
      if (pending[d.requestId]) { pending[d.requestId].resolve(d); delete pending[d.requestId]; }
    }
  };
  ws.onerror = () => { $('#status').textContent = T().connectFail; };
  ws.onclose = () => { wsReady = false; $('#status').textContent = T().disconnected; };
}

function request(type, data) {
  return new Promise((res, rej) => {
    if (!wsReady) { rej(new Error('未连接 OBS')); return; }
    const id = String(++reqId);
    pending[id] = { resolve: res, reject: rej };
    ws.send(JSON.stringify({ op: 6, d: { requestType: type, requestId: id, requestData: data || {} } }));
    setTimeout(() => { if (pending[id]) { delete pending[id]; rej(new Error('timeout: ' + type)); } }, 8000);
  });
}

function colorToInt(v) {
  let a;
  if (Array.isArray(v)) a = v.map(Number);
  else if (typeof v === 'string') a = v.split(',').map(s => parseFloat(s.trim()));
  else return v;
  while (a.length < 4) a.push(1);
  a = a.map(x => Math.max(0, Math.min(255, Math.round((x <= 1 ? x * 255 : x)))));
  return (((a[0] & 255) | ((a[1] & 255) << 8) | ((a[2] & 255) << 16) | ((a[3] & 255) << 24))) >>> 0;
}

// ===== OBS 状态同步（决策逻辑在 sync.js，可单测）=====
// 源列表增量更新 + 源消失回退；每 2 秒轮询一次，换源也触发。目的：面板如实反映 OBS 真实状态。
let syncTimer = null;
let syncing = false;

function applySourceList(list) {
  const el = $('#src');
  const names = list.map(i => i.inputName);
  const { added, removed } = SPSync.reconcileOptions(Array.from(el.options).map(o => o.value), names);
  if (added.length || removed.length) {
    const byName = {};
    Array.from(el.options).forEach(o => { byName[o.value] = o; });
    removed.forEach(n => { if (byName[n]) byName[n].remove(); });
    added.forEach(n => {
      const o = document.createElement('option');
      o.value = n; o.textContent = n;
      el.appendChild(o);
    });
  }
  el.value = SPSync.nextSelection(names, el.value, cfg.sourceName);
}

async function syncFilterState(src) {
  if (!src) return;
  try {
    const fl = await request('GetSourceFilterList', { sourceName: src });
    const our = SPSync.findOurFilter((fl.responseData && fl.responseData.filters) || [], cfg.filterName);
    const file = SPSync.shaderFileFromSettings(our ? our.filterSettings : null);
    const nextApplied = (file && items.some(i => i.file === file)) ? file : null;
    if (nextApplied !== applied) { applied = nextApplied; renderGrid(); }
    if ($('#detail-src').textContent !== src) $('#detail-src').textContent = src;
    $('#status').textContent = 'OBS · ' + src + ' / ' + cfg.filterName;
  } catch (e) { /* 瞬时错误忽略，下轮再试 */ }
}

async function syncSources() {
  if (!wsReady || syncing) return;
  syncing = true;
  try {
    const sc = await request('GetCurrentProgramScene');
    const sceneName = sc.responseData && sc.responseData.currentProgramSceneName;
    if (!sceneName) { applySourceList([]); return; }
    const si = await request('GetSceneItemList', { sceneName });
    const items = (si.responseData && si.responseData.sceneItems) || [];
    // 只列当前场景的源，与 OBS 底部源列表一致（OBS 面板=前层在上，故按 sceneItemIndex 倒序）；同源去重
    const sorted = items.slice().sort((a, b) => b.sceneItemIndex - a.sceneItemIndex);
    const names = [...new Set(sorted.map(i => i.sourceName))];
    applySourceList(names.map(n => ({ inputName: n })));
    await syncFilterState($('#src').value);
  } catch (e) { /* 瞬时错误忽略，下轮再试 */ }
  finally { syncing = false; }
}

function startSync() {
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = setInterval(syncSources, 2000);
}

// 应用 shader：删旧滤镜、建新（from_file:true）。已验证 SetSourceFilterSettings 切 shader 不生效，必须删旧建新
async function applyShader(file) {
  const full = cfg.shaderDir.replace(/[\\/]+$/, '') + '/' + file;
  const src = $('#src').value || cfg.sourceName;
  const fl = await request('GetSourceFilterList', { sourceName: src });
  const existing = ((fl.responseData && fl.responseData.filters) || []).find(f => f.filterName === cfg.filterName);
  if (existing) await request('RemoveSourceFilter', { sourceName: src, filterName: cfg.filterName });
  const cr = await request('CreateSourceFilter', {
    sourceName: src, filterName: cfg.filterName, filterKind: 'shader_filter',
    filterSettings: { from_file: true, shader_file_name: full }
  });
  if (!(cr.requestStatus && cr.requestStatus.result)) throw new Error(JSON.stringify(cr.requestStatus).slice(0, 200));
  return { file, sourceName: src };
}

// 改滤镜参数：读回现有 settings 再 merge，clamp 到 shader 声明 min/max（drawings 超值曾把 GPU 打满）
async function setParams(file, params) {
  const src = $('#src').value || cfg.sourceName;
  const fl = await request('GetSourceFilterList', { sourceName: src });
  const cur = ((fl.responseData && fl.responseData.filters) || []).find(f => f.filterName === cfg.filterName);
  if (!cur) throw new Error('目标源上没有「' + cfg.filterName + '」滤镜，先在面板里选一个效果');
  const defs = (items.find(i => i.file === file) || {}).params || [];
  const clamped = {};
  for (const [k, v] of Object.entries(params)) {
    const d = defs.find(x => x.name === k);
    if (d && (d.type === 'float3' || d.type === 'float4') && d.widget === 'color') { clamped[k] = colorToInt(v); continue; }
    if (d && d.min !== undefined && d.max !== undefined && (d.type === 'float' || d.type === 'int')) {
      const n = d.type === 'int' ? Math.round(Number(v)) : Number(v);
      if (!isNaN(n)) { clamped[k] = Math.min(d.max, Math.max(d.min, n)); continue; }
    }
    clamped[k] = v;
  }
  const sr = await request('SetSourceFilterSettings', {
    sourceName: src, filterName: cfg.filterName,
    filterSettings: Object.assign({}, cur.filterSettings, clamped)
  });
  if (!(sr.requestStatus && sr.requestStatus.result)) throw new Error(JSON.stringify(sr.requestStatus).slice(0, 200));
  return Object.keys(params);
}

// ===== 面板 UI（沿用原版，仅网络层替换 + 相对缩略图路径）=====
function init() {
  $('#lang-toggle').onclick = () => setLang(lang === 'zh' ? 'en' : 'zh');
  $('#reload-btn').onclick = () => location.reload();
  setLang(lang);
  $('#detail-collapse').onclick = () => $('#detail').classList.add('hidden');

  $('#settings-btn').onclick = openSettings;
  $('#src').onchange = () => { syncFilterState($('#src').value); };
  $('#s-save').onclick = () => {
    cfg.obsUrl = $('#s-url').value.trim();
    cfg.password = $('#s-pass').value;
    cfg.sourceName = $('#s-source').value.trim();
    cfg.filterName = $('#s-filter').value.trim();
    cfg.shaderDir = $('#s-shader').value.trim();
    saveSettings();
    $('#settings-modal').classList.add('hidden');
    connect();
  };
  $('#s-cancel').onclick = () => $('#settings-modal').classList.add('hidden');

  renderCats();
  renderGrid();
  connect();
}

function openSettings() {
  $('#s-url').value = cfg.obsUrl;
  $('#s-pass').value = cfg.password;
  $('#s-source').value = cfg.sourceName;
  $('#s-filter').value = cfg.filterName;
  $('#s-shader').value = cfg.shaderDir;
  $('#settings-modal').classList.remove('hidden');
}

function setLang(l) {
  lang = l;
  $('#lang-toggle').textContent = T().switchTo;
  document.title = T().appTitle;
  $('#app-title').textContent = T().appTitle;
  $('#search').placeholder = T().searchPh;
  $('#src').title = T().applyToTitle;
  $('#detail-title').textContent = T().effectParams;
  renderCats();
  renderGrid();
  if (currentFile) selectEffect(currentFile);
}

function renderCats() {
  const total = items.length;
  const el = $('#cats');
  const rows = [{ id: 'all', name: lang === 'zh' ? '全部' : 'All', count: total }].concat(groups);
  el.innerHTML = rows.map(g =>
    `<div class="cat${g.id === activeCat ? ' active' : ''}" data-cat="${g.id}">
      <span>${esc(lang === 'zh' ? g.name : g.id)}</span><b>${g.count}</b>
    </div>`).join('');
  el.querySelectorAll('.cat').forEach(c => c.onclick = () => {
    activeCat = c.dataset.cat;
    renderCats();
    renderGrid();
  });
}

function matchSearch(item) {
  if (!searchText) return true;
  const q = searchText.toLowerCase();
  if (i18nName(item).toLowerCase().includes(q)) return true;
  if (item.name.toLowerCase().includes(q)) return true;
  if (i18nDesc(item).toLowerCase().includes(q)) return true;
  if (item.params && item.params.some(p => (p.label || '').toLowerCase().includes(q) || p.name.toLowerCase().includes(q))) return true;
  return false;
}

function renderGrid() {
  const list = items.filter(i => (activeCat === 'all' || i.category === activeCat) && matchSearch(i));
  const el = $('#grid');
  $('#empty').classList.toggle('hidden', list.length > 0);
  $('#empty').textContent = T().noMatch;
  el.innerHTML = list.map(i => {
    const sliderCount = (i.params || []).filter(p => p.widget === 'slider').length;
    const isApplied = applied === i.file;
    const title = i18nName(i);
    const desc = i18nDesc(i);
    const thumb = 'thumbs/' + i.name.replace(/\.shader$/, '') + '.png';
    const isTransition = i.category === 'transition';
    return `<div class="card${isApplied ? ' applied' : ''}" data-file="${i.file}">
      <img class="card-thumb" src="${thumb}" alt="" loading="lazy" onerror="this.remove()">
      <div class="card-head">
        <span class="card-name" title="${esc(i.name)}">${esc(title)}</span>
        ${lang === 'zh' && i.zh ? `<span class="card-en">${esc(i.name)}</span>` : ''}
        ${sliderCount ? `<span class="badge">${T().paramsBadge(sliderCount)}</span>` : ''}
        ${isTransition ? `<span class="badge trans" title="${lang === 'zh' ? '双画面转场 shader，单源滤镜下会失真' : 'Dual-scene transition shader; will look wrong on a single-source filter'}">${T().transition}</span>` : ''}
        ${isApplied ? `<span class="now">${T().current}</span>` : ''}
      </div>
      ${desc ? `<div class="card-desc">${esc(desc)}</div>` : ''}
    </div>`;
  }).join('');
  el.querySelectorAll('.card').forEach(c => c.onclick = () => { apply(c.dataset.file); selectEffect(c.dataset.file); });
}

function apply(file) {
  toast(T().switching);
  applyShader(file).then(res => {
    applied = file;
    renderGrid();
    toast(T().applied + file, true);
  }).catch(e => toast(T().switchFail + e.message));
}

// ===== 顶部预览条 + 侧边栏参数面板 =====
function selectEffect(file) {
  currentFile = file;
  const item = items.find(i => i.file === file);
  const name = i18nName(item);
  $('#detail-title').textContent = name;
  $('#detail-src').textContent = $('#src').value;
  $('#preview-name').textContent = name;
  $('#preview-file').textContent = file;
  const pi = $('#preview-img');
  pi.style.display = '';
  pi.onerror = () => { pi.style.display = 'none'; };
  pi.src = 'thumbs/' + file.replace(/\.shader$/, '') + '.png';
  $('#preview').classList.remove('hidden');
  $('#detail').classList.remove('hidden');
  renderParams(item.params || []);
}

function renderParams(params) {
  const el = $('#params');
  if (!params.length) { el.innerHTML = `<div class="p-empty">${T().noParams}</div>`; return; }
  el.innerHTML = params.map(p => {
    const label = esc(i18nLabel(p));
    const nm = p.name;
    switch (p.widget) {
      case 'slider': {
        const min = p.min ?? 0, max = p.max ?? 100;
        const step = p.step ?? (p.type === 'int' ? 1 : 0.01);
        const val = p.default ?? min;
        return `<div class="p-row p-slider">
          <div class="p-label"><span>${label}</span><b class="p-val">${val}</b></div>
          <input type="range" name="${nm}" data-type="${p.type}" min="${min}" max="${max}" step="${step}" value="${val}">
        </div>`;
      }
      case 'checkbox':
        return `<label class="p-row p-check"><input type="checkbox" name="${nm}" ${p.default ? 'checked' : ''}><span>${label}</span></label>`;
      case 'select':
        return `<div class="p-row p-select"><label class="p-label">${label}</label><select name="${nm}">${p.options.map(o => `<option value="${esc(o.value)}" ${String(p.default) === String(o.value) ? 'selected' : ''}>${esc(o.label || o.value)}</option>`).join('')}</select></div>`;
      case 'color': {
        const d = p.default || [0, 0, 0, 1];
        const rgb = d.slice(0, 3).map(v => Math.max(0, Math.min(255, Math.round((v || 0) * 255))));
        const hex = '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('');
        const alphaPct = Math.round(((d[3] === undefined || d[3] === null) ? 1 : d[3]) * 100);
        return `<div class="p-row p-color"><label class="p-label">${label}</label>
          <div class="color-wrap">
            <input type="color" name="${nm}" data-color-rgb value="${hex}">
            <span class="color-a-label">${T().alpha}</span>
            <input type="range" name="${nm}" data-color-a min="0" max="100" step="1" value="${alphaPct}" title="${T().alpha}">
            <input type="number" name="${nm}" data-color-a class="color-a-num" min="0" max="100" step="1" value="${alphaPct}">
          </div></div>`;
      }
      default:
        return `<div class="p-row p-number"><label class="p-label">${label}</label><input type="${p.widget === 'text' ? 'text' : 'number'}" name="${nm}" data-type="${p.type}" value="${esc(p.default)}"></div>`;
    }
  }).join('');
  el.querySelectorAll('[name]').forEach(c => {
    c.addEventListener('input', () => {
      if (c.dataset.colorA !== undefined) {
        const row = c.closest('.p-row');
        const peer = c.type === 'range' ? row.querySelector('.color-a-num') : row.querySelector('[data-color-a]');
        if (peer && peer !== c) peer.value = c.value;
      }
      const valEl = c.closest('.p-row').querySelector('.p-val');
      if (valEl) valEl.textContent = c.value;
      schedule();
    });
    c.addEventListener('change', schedule);
  });
}

function collectParams() {
  const out = {};
  document.querySelectorAll('#params [name]').forEach(c => {
    const t = c.dataset.type;
    if (c.dataset.colorRgb !== undefined) {
      const wrap = c.closest('.color-wrap');
      const aEl = wrap && wrap.querySelector('[data-color-a]');
      const a = aEl ? parseFloat(aEl.value) / 100 : 1;
      const hex = c.value.slice(1);
      const vals = [0, 1, 2].map(i => parseInt(hex.substr(i * 2, 2), 16)).concat(isNaN(a) ? 1 : a);
      out[c.name] = vals.join(', '); // 面板发 "r,g,b,a" 字符串，sendParams 里 colorToInt 打包成 OBS uint32
    } else if (c.dataset.colorA !== undefined) {
      return; // alpha 已随 rgb 处理
    } else if (c.type === 'checkbox') out[c.name] = c.checked;
    else if (t === 'color') out[c.name] = c.value.trim();
    else if (c.type === 'range' || c.type === 'number') out[c.name] = t === 'int' ? Math.round(parseFloat(c.value)) : parseFloat(c.value);
    else out[c.name] = c.value;
  });
  return out;
}

let debounceTimer;
function schedule() {
  clearTimeout(debounceTimer);
  $('#status').textContent = T().paramSyncing;
  debounceTimer = setTimeout(sendParams, 150);
}
function sendParams() {
  if (!currentFile) return;
  setParams(currentFile, collectParams()).then(() => {
    $('#status').textContent = T().paramSynced;
  }).catch(e => {
    $('#status').textContent = T().paramFail + e.message;
    toast(T().paramFail + e.message, false);
  });
}

let toastTimer;
function toast(msg, ok) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('ok', !!ok);
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2000);
}

function esc(s) { return String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])); }

$('#search').addEventListener('input', e => {
  searchText = e.target.value.trim();
  renderGrid();
});

init();
