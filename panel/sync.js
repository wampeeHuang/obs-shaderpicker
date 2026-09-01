// 面板与 OBS 状态的同步决策逻辑 —— 纯函数，无 DOM，可 node 单测（见 _runtime/test-sync.js）。
// 职责：源列表增量合并、源消失回退、滤镜→shader 文件解析、定位本包滤镜。
window.SPSync = (function () {
  // 下拉框选项合并：只返回增/删差异，调用方增量更新 DOM（不整块重建，避免打断用户打开的菜单）。
  function reconcileOptions(currentValues, incomingNames) {
    const cur = {};
    currentValues.forEach(n => { cur[n] = true; });
    const inc = {};
    incomingNames.forEach(n => { inc[n] = true; });
    return {
      added: incomingNames.filter(n => !cur[n]),
      removed: currentValues.filter(n => !inc[n])
    };
  }

  // 源消失/列表变化后的回退选择：当前值仍在 → 保留；否则优先 cfg.sourceName；再不行取列表第一个。
  function nextSelection(incomingNames, currentValue, preferred) {
    if (!incomingNames.length) return '';
    if (currentValue && incomingNames.indexOf(currentValue) >= 0) return currentValue;
    if (preferred && incomingNames.indexOf(preferred) >= 0) return preferred;
    return incomingNames[0];
  }

  // 从滤镜 settings 解析对应 shader 文件名（basename，兼容 / 与 \）。
  function shaderFileFromSettings(settings) {
    if (!settings || typeof settings.shader_file_name !== 'string') return null;
    const base = settings.shader_file_name.replace(/\\/g, '/').split('/').pop();
    return base || null;
  }

  // 滤镜列表里是否带本包滤镜（按 filterName），命中返回滤镜对象，否则 null。
  function findOurFilter(filters, filterName) {
    return (filters || []).find(f => f.filterName === filterName) || null;
  }

  return { reconcileOptions, nextSelection, shaderFileFromSettings, findOurFilter };
})();
