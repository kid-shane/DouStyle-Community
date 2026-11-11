// All state is separate from adjustable Style preferences. Storage is committed before activation.
export function createSkinRuntime(model, bundled, onChange) {
  const builtin = new Map(bundled.map(s => { const skin = model.normalize(s); return [skin.id, skin]; }));
  let library = new Map();
  let activeId = null;
  let loadError = '';
  try {
    const saved = JSON.parse(localStorage.getItem(model.storageKey) || '{}');
    for (const entry of Array.isArray(saved.skins) ? saved.skins : []) {
      try { const skin = model.normalize(entry); if (!builtin.has(skin.id)) library.set(skin.id, skin); } catch { loadError = '部分皮肤文件无法读取，已跳过。'; }
    }
    if (builtin.has(saved.activeId) || library.has(saved.activeId)) activeId = saved.activeId;
  } catch { loadError = '皮肤库无法读取，已恢复可调 Style。'; }
  const get = id => builtin.get(id) || library.get(id);
  const active = () => get(activeId) || null;
  const save = (nextLibrary, nextId) => {
    const payload = JSON.stringify({ activeId: nextId, skins: [...nextLibrary.values()] });
    if (payload.length > 3 * model.maxBytes) throw new Error('皮肤库已满，请先移除不使用的皮肤。');
    try { localStorage.setItem(model.storageKey, payload); } catch { throw new Error('皮肤未保存，请检查本机存储空间。'); }
    library = nextLibrary; activeId = nextId; loadError = '';
  };
  const select = id => {
    if (id !== null && !get(id)) throw new Error('找不到这套皮肤');
    save(library, id); onChange(); return true;
  };
  const install = input => {
    const skin = model.normalize(input);
    const existing = get(skin.id);
    // Re-importing an identical shared file is idempotent; changed designs need a new ID.
    if (existing && JSON.stringify(existing) === JSON.stringify(skin)) return skin.id;
    if (builtin.has(skin.id)) throw new Error('内置皮肤保留原作，请修改 ID 和名称后另存为新皮肤。');
    if (library.has(skin.id)) throw new Error('已有同名 ID 的皮肤，请使用新的 ID 后导入。');
    if (library.size >= 20) throw new Error('最多保存 20 套自定义皮肤。');
    const next = new Map(library); next.set(skin.id, skin); save(next, activeId); onChange(); return skin.id;
  };
  const remove = id => {
    if (builtin.has(id)) throw new Error('内置皮肤不能移除');
    if (!library.has(id)) throw new Error('找不到这套皮肤');
    const next = new Map(library); next.delete(id); save(next, activeId === id ? null : activeId); onChange(); return true;
  };
  let lastCSS = '';
  let lastSkin;
  const sync = () => {
    const skin = active();
    const root = document.documentElement;
    let style = document.getElementById('doustyle-skin-css');
    if (!skin) {
      root.removeAttribute('data-doubao-skin'); style?.remove(); lastCSS = '';
      document.querySelectorAll('[data-doustyle-decoration]').forEach(e => e.remove());
      return;
    }
    root.setAttribute('data-doubao-skin', skin.id);
    if (!style) { style = document.createElement('style'); style.id = 'doustyle-skin-css'; document.head.appendChild(style); }
    const css = lastSkin === skin && lastCSS ? lastCSS : model.compile(skin);
    lastSkin = skin;
    if (lastCSS !== css || style.textContent !== css) { style.textContent = css; lastCSS = css; }
    // Own decorations only; never reparent nodes managed by Doubao.
    const header = document.querySelector('main [class~="h-header-height"]');
    if (header && !header.querySelector('.doustyle-skin-caption')) {
      const title = document.createElement('span'); title.className = 'doustyle-skin-caption';
      title.dataset.doustyleDecoration = 'title'; title.setAttribute('aria-hidden','true');
      header.insertBefore(title, header.children[1] || null);
    }
    const caption = document.querySelector('.doustyle-skin-caption');
    if (caption && caption.textContent !== skin.decoration.title) caption.textContent = skin.decoration.title;
    const welcome = document.querySelector('#flow-chat-guidance-page [class*="greeting-text-"]');
    if (welcome && skin.decoration.emblem === 'computer' && !document.querySelector('.doustyle-skin-mark')) {
      const mark = document.createElement('div'); mark.className = 'doustyle-skin-mark'; mark.dataset.doustyleDecoration = 'emblem'; mark.setAttribute('aria-hidden','true');
      mark.innerHTML = '<svg viewBox="0 0 96 88" fill="none"><path d="M12 8h68v49H12z" fill="#f1efe3" stroke="#6b6e70" stroke-width="2"/><path d="M17 13h58v37H17z" fill="#0058b9" stroke="#808080" stroke-width="2"/><path d="M19 15h54v17H19z" fill="#459ee7"/><path d="M19 43c14-19 27-8 54-15v20H19z" fill="#71ad45"/><path d="M41 57v10H27v4h39v-4H52V57" fill="#dddcd1" stroke="#777" stroke-width="2"/><path d="m11 74-6 8h83l-7-8H11Z" fill="#efede1" stroke="#777" stroke-width="2"/><path d="M17 77h54M29 80h31" stroke="#999"/><path d="M67 54h5" stroke="#50a521" stroke-width="2"/></svg>';
      welcome.parentElement.insertBefore(mark,welcome);
    }
    if (skin.decoration.emblem !== 'computer') document.querySelector('.doustyle-skin-mark')?.remove();
  };
  return { active, get, select, install, remove, sync, error: () => loadError,
    list: () => [...builtin.values(), ...library.values()].map(s => ({...s, builtin: builtin.has(s.id), active: s.id === activeId})),
    export: id => { const skin = get(id || activeId); if (!skin) throw new Error('请先选择皮肤'); return JSON.parse(JSON.stringify(skin)); }
  };
}
