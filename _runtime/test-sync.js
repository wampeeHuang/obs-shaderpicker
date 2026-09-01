// 单测：panel/sync.js 的纯同步决策逻辑。node 直跑，零依赖。
// 场景覆盖：源列表增删、源消失回退、shader 路径解析（/ 与 \）、滤镜定位。
const fs = require('fs');
const path = require('path');
global.window = {};
eval(fs.readFileSync(path.join(__dirname, '..', 'panel', 'sync.js'), 'utf8'));
const S = window.SPSync;

let pass = 0, fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n    got  ' + g + '\n    want ' + w); }
}

console.log('-- reconcileOptions --');
eq('空→首次填充', S.reconcileOptions([], ['摄像头', '窗口采集']),
  { added: ['摄像头', '窗口采集'], removed: [] });
eq('无变化', S.reconcileOptions(['摄像头'], ['摄像头']),
  { added: [], removed: [] });
eq('新增一个', S.reconcileOptions(['摄像头'], ['摄像头', '屏幕捕获']),
  { added: ['屏幕捕获'], removed: [] });
eq('消失一个', S.reconcileOptions(['摄像头', '窗口采集'], ['摄像头']),
  { added: [], removed: ['窗口采集'] });
eq('增删同现', S.reconcileOptions(['A', 'B'], ['B', 'C']),
  { added: ['C'], removed: ['A'] });

console.log('-- nextSelection --');
eq('当前值仍在→保留', S.nextSelection(['A', 'B'], 'B', 'A'), 'B');
eq('当前值消失→回退 preferred', S.nextSelection(['A', 'C'], 'B', 'A'), 'A');
eq('preferred 也消失→取第一个', S.nextSelection(['C', 'D'], 'B', 'A'), 'C');
eq('空列表→空串', S.nextSelection([], 'B', 'A'), '');
eq('无当前值→取 preferred', S.nextSelection(['A', 'B'], '', 'A'), 'A');
eq('全无→取第一个', S.nextSelection(['A', 'B'], '', ''), 'A');

console.log('-- shaderFileFromSettings --');
eq('Windows 路径', S.shaderFileFromSettings({ shader_file_name: 'C:\\Program Files\\obs-studio\\data\\obs-plugins\\obs-shaderfilter\\examples\\VHS.shader' }),
  'VHS.shader');
eq('posix 路径', S.shaderFileFromSettings({ shader_file_name: '/data/obs-plugins/obs-shaderfilter/examples/3d-panel.shader' }),
  '3d-panel.shader');
eq('无 shader_file_name→null', S.shaderFileFromSettings({}), null);
eq('null settings→null', S.shaderFileFromSettings(null), null);
eq('空字符串→null', S.shaderFileFromSettings({ shader_file_name: '' }), null);

console.log('-- findOurFilter --');
const filters = [
  { filterName: '其它滤镜', filterSettings: {} },
  { filterName: '用户自定义着色器', filterSettings: { shader_file_name: 'VHS.shader' } }
];
eq('命中本包滤镜', S.findOurFilter(filters, '用户自定义着色器').filterSettings.shader_file_name, 'VHS.shader');
eq('未命中→null', S.findOurFilter(filters, '不存在'), null);
eq('空列表→null', S.findOurFilter([], '用户自定义着色器'), null);
eq('null 列表→null', S.findOurFilter(null, '用户自定义着色器'), null);

console.log('\n%s %d/%d', fail ? 'FAILURES PRESENT' : 'ALL PASS', pass, pass + fail);
process.exit(fail ? 1 : 0);
