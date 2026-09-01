// 集成测试：jsdom 加载真实面板(index.html+app.js+sync.js)，mock OBS WebSocket 走完整链路。
// 验证：连接→源列表填充→应用 shader→源增删同步→回退→滤镜状态回读(改源/删滤镜后面板如实反映)。
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const PANEL = path.join(__dirname, '..', 'panel');
const html = fs.readFileSync(path.join(PANEL, 'index.html'), 'utf8');
const read = f => fs.readFileSync(path.join(PANEL, f), 'utf8');

// ---- mock OBS 状态 + 路由 ----
function routeRequest(state, req) {
  const base = { requestType: req.requestType, requestId: req.requestId, requestStatus: { result: true, code: 100 } };
  switch (req.requestType) {
    case 'GetInputList':
      return { ...base, responseData: { inputs: state.inputs.map(n => ({ inputName: n })) } };
    case 'GetSourceFilterList': {
      const src = req.requestData.sourceName;
      const list = (state.filters[src] || []).map(f => ({
        filterName: f.filterName, filterKind: f.filterKind, filterSettings: f.filterSettings, filterEnabled: f.filterEnabled
      }));
      return { ...base, responseData: { filters: list } };
    }
    case 'CreateSourceFilter': {
      const src = req.requestData.sourceName;
      (state.filters[src] = state.filters[src] || []).push({
        filterName: req.requestData.filterName, filterKind: req.requestData.filterKind,
        filterSettings: req.requestData.filterSettings, filterEnabled: true
      });
      return base;
    }
    case 'RemoveSourceFilter': {
      const src = req.requestData.sourceName;
      state.filters[src] = (state.filters[src] || []).filter(f => f.filterName !== req.requestData.filterName);
      return base;
    }
    case 'SetSourceFilterSettings': {
      const src = req.requestData.sourceName;
      const f = (state.filters[src] || []).find(x => x.filterName === req.requestData.filterName);
      if (f) f.filterSettings = Object.assign({}, f.filterSettings, req.requestData.filterSettings);
      return base;
    }
    default:
      return { ...base, requestStatus: { result: false, code: 500, comment: 'unknown ' + req.requestType } };
  }
}

function makeMockWS(state) {
  return class MockWS {
    constructor(url) {
      this.url = url; this.readyState = 0;
      setTimeout(() => { this.readyState = 1; if (this.onopen) this.onopen({}); this._emit({ op: 0, d: {} }); }, 0);
    }
    _emit(msg) { if (this.onmessage) this.onmessage({ data: JSON.stringify(msg) }); }
    send(data) {
      const m = JSON.parse(data);
      if (m.op === 1) this._emit({ op: 2, d: { negotiatedRpcVersion: 1 } });
      else if (m.op === 6) this._emit({ op: 7, d: routeRequest(state, m.d) });
    }
    close() { this.readyState = 3; if (this.onclose) this.onclose({}); }
  };
}

// ---- 断言 ----
let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const state = { inputs: ['摄像头'], filters: {} };
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'dangerously', pretendToBeVisual: true });
  const win = dom.window;
  win.crypto = require('crypto').webcrypto;
  win.btoa = globalThis.btoa;
  win.TextEncoder = globalThis.TextEncoder;
  win.WebSocket = makeMockWS(state);

  const load = (f) => { const s = win.document.createElement('script'); s.textContent = read(f); win.document.body.appendChild(s); };
  load('config.js');
  win.__SP_CONFIG__ = { obsUrl: 'ws://127.0.0.1:4455', password: '', sourceName: '摄像头', filterName: '用户自定义着色器', shaderDir: 'C:/shaders/' };
  load('data.js');
  load('sync.js');
  load('app.js');

  await sleep(100); // 等 connect→Hello→Identify→Identified→首次 syncSources 完成
  const doc = win.document;
  const src = doc.getElementById('src');

  console.log('-- 1. 连接 + 源列表填充 --');
  ok('下拉框有 [摄像头]', src.options.length === 1 && src.options[0].value === '摄像头');
  ok('默认选中 [摄像头]', src.value === '摄像头');

  console.log('-- 2. 应用 shader → mock 收到滤镜 → 同步读回标当前 --');
  await win.applyShader('VHS.shader');
  ok('mock 上 摄像头 有 1 个滤镜', (state.filters['摄像头'] || []).length === 1);
  ok('滤镜 shader_file_name 正确', state.filters['摄像头'][0].filterSettings.shader_file_name === 'C:/shaders/VHS.shader');
  await win.syncSources(); await sleep(20);
  const cardVHS = () => doc.querySelector('.card[data-file="VHS.shader"]');
  ok('VHS 卡片标记 当前', !!(cardVHS() && cardVHS().classList.contains('applied')));

  console.log('-- 3. OBS 增删源 → 下拉框增量同步 + 回退 --');
  state.inputs = ['窗口采集'];
  await win.syncSources(); await sleep(20);
  const vals = Array.from(src.options).map(o => o.value);
  ok('下拉框只剩 [窗口采集]', vals.join(',') === '窗口采集');
  ok('回退选中 [窗口采集]', src.value === '窗口采集');
  ok('新源无滤镜 → 取消当前标记', !(cardVHS() && cardVHS().classList.contains('applied')));

  console.log('-- 4. OBS 侧直接改滤镜(在 OBS 里加/删) → 面板如实反映 --');
  (state.filters['窗口采集'] = state.filters['窗口采集'] || []).push({
    filterName: '用户自定义着色器', filterKind: 'shader_filter',
    filterSettings: { from_file: true, shader_file_name: 'C:/shaders/VHS.shader' }, filterEnabled: true
  });
  await win.syncSources(); await sleep(20);
  ok('OBS 里加了滤镜 → 面板标记当前', !!(cardVHS() && cardVHS().classList.contains('applied')));
  state.filters['窗口采集'] = [];
  await win.syncSources(); await sleep(20);
  ok('OBS 里删了滤镜 → 面板取消当前', !(cardVHS() && cardVHS().classList.contains('applied')));

  dom.window.close();
  console.log('\n%s %d/%d', fail ? 'FAILURES PRESENT' : 'ALL PASS', pass, pass + fail);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('[harness err]', e); process.exit(1); });
