export function installSkinUI({ panel, header, tabs, content, footer, resetButton, runtime, model, restore, close }) {
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (className, text, action) => {
    const node = element('button', className, text); node.type = 'button';
    node.addEventListener('click', action); return node;
  };
  const kind = element('div', 'doustyle-kind');
  kind.setAttribute('role','group'); kind.setAttribute('aria-label','外观类型');
  const styleButton = button('', '可调 Style', () => attempt(() => { if (runtime.active()) restore(); viewingSkins = false; detailId = null; refresh(); }));
  const skinButton = button('', '完整皮肤', () => { viewingSkins = true; refresh(); workshop.check(); });
  kind.append(styleButton, skinButton); header.after(kind);
  const pane = element('section', 'doustyle-skin-pane'); pane.setAttribute('aria-label','完整皮肤');
  const intro = element('div', 'doustyle-skin-intro');
  const copy = element('div');
  const title = element('strong');
  const hint = element('p', '', '收藏喜欢的界面，点击卡片即可切换。'); copy.append(title, hint);
  const input = element('input'); input.type = 'file'; input.accept = '.json,.style.json,application/json'; input.multiple = true; input.hidden = true;
  const importButton = button('', '导入皮肤', () => input.click()); importButton.id = 'doustyle-skin-import';
  intro.append(copy, importButton, input);
  const grid = element('div', 'doustyle-skin-grid');
  const detail = element('div', 'doustyle-skin-detail'); detail.hidden = true;
  const message = element('p', 'doustyle-skin-status'); message.setAttribute('role','status'); message.setAttribute('aria-live','polite');
  const note = element('div');
  const workshop = installWorkshopControl(note);
  pane.append(intro, grid, detail, message, note); content.after(pane);
  let viewingSkins = !!runtime.active();
  let renderedList = '';
  let detailId = null;
  let importing = false;
  const report = (text, error = false) => { message.textContent = text; message.dataset.error = String(error); };
  const attempt = fn => { try { fn(); } catch (error) { report(error.message,true); } };
  const closeMenus = () => pane.querySelectorAll('.doustyle-skin-more[open]').forEach(menu => { menu.open = false; });
  const focusCard = id => grid.querySelector(`[data-skin-id="${id}"] .doustyle-skin-select`)?.focus({preventScroll:true});
  const apply = id => attempt(() => {
    if (runtime.active()?.id === id) return;
    runtime.select(id); viewingSkins = true; refresh();
    if (!detailId) focusCard(id);
    else detail.querySelector('.doustyle-skin-back')?.focus({preventScroll:true});
    report('已应用「' + runtime.get(id).name + '」');
  });
  const download = id => {
    const skin = runtime.export(id);
    const blob = new Blob([JSON.stringify(skin,null,2) + '\n'],{type:'application/json'});
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = skin.id + '.style.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
    report('已导出「' + skin.name + '」');
  };
  const previewFor = skin => {
    const preview = element('div', 'doustyle-skin-preview'); preview.dataset.doustylePreview = '';
    preview.setAttribute('aria-label',skin.name + ' 配色与窗口预览'); preview.setAttribute('role','img');
    for (const [name, token] of Object.entries({accent:'accent',panel:'sidebar',paper:'background',ink:'foreground'})) preview.style.setProperty('--preview-' + name,skin.tokens[token]);
    const bar = element('div', 'doustyle-preview-bar', skin.decoration.title);
    const body = element('div', 'doustyle-preview-body');
    const nav = element('div', 'doustyle-preview-nav');
    for (const text of ['我的工作','项目文件夹','最近的对话']) nav.append(element('span','',text));
    const paper = element('div', 'doustyle-preview-paper');
    const hello = element('strong', '', skin.welcome.text);
    const lines = element('div', 'doustyle-preview-lines'); lines.innerHTML = '<i></i><i></i><i></i>';
    const editor = element('div', 'doustyle-preview-editor', '开始一段新的对话…');
    paper.append(hello,lines,editor); body.append(nav,paper); preview.append(bar,body); return preview;
  };
  const backToGrid = () => {
    const id = detailId; detailId = null; refresh(); focusCard(id);
  };
  const showDetail = id => {
    detailId = id; closeMenus(); refresh(); pane.scrollTop = 0;
    detail.querySelector('.doustyle-skin-back')?.focus({preventScroll:true});
  };
  const remove = skin => attempt(() => {
    detailId = null; runtime.remove(skin.id); refresh();
    importButton.focus({preventScroll:true}); report('已移除「' + skin.name + '」');
  });
  const renderDetail = skin => {
    detail.replaceChildren();
    const back = button('doustyle-skin-back', '← 返回皮肤库', backToGrid);
    const preview = previewFor(skin);
    const heading = element('h3', '', skin.name);
    const author = element('p', 'doustyle-skin-author', skin.author + ' · v' + skin.version + (skin.basedOn ? ' · 基于 ' + skin.basedOn.id : ''));
    const description = element('p', 'doustyle-skin-description', skin.description);
    const actions = element('div', 'doustyle-skin-actions');
    const select = button('doustyle-skin-apply', skin.active ? '正在使用' : '应用皮肤', () => apply(skin.id)); select.disabled = skin.active;
    actions.append(select,button('', '导出', () => attempt(() => download(skin.id))));
    if (!skin.builtin) actions.append(button('', '移除', () => remove(skin)));
    detail.append(back,preview,heading,author,description,actions);
  };
  const render = () => {
    const list = runtime.list(); title.textContent = '我的皮肤 · ' + list.length;
    const selectedDetail = list.find(s => s.id === detailId);
    if (!selectedDetail) detailId = null;
    grid.hidden = !!detailId; detail.hidden = !detailId;
    if (selectedDetail) renderDetail(selectedDetail);
    const signature = JSON.stringify(list.map(s => [s.id,s.version,s.active]));
    if (signature === renderedList) return;
    renderedList = signature; grid.replaceChildren();
    for (const skin of list) {
      const card = element('article', 'doustyle-skin-card'); card.dataset.skinId = skin.id; card.dataset.active = String(skin.active);
      const select = button('doustyle-skin-select', undefined, () => apply(skin.id));
      select.dataset.doustyleGalleryControl = '';
      select.setAttribute('aria-label','应用皮肤：' + skin.name); select.setAttribute('aria-pressed',String(skin.active));
      const preview = previewFor(skin);
      const meta = element('div', 'doustyle-skin-meta');
      const nameRow = element('div', 'doustyle-skin-name-row');
      const name = element('h3', '', skin.name); name.title = skin.name; nameRow.append(name);
      if (skin.active) nameRow.append(element('span', 'doustyle-skin-badge', '使用中'));
      const author = element('p', 'doustyle-skin-author', skin.author + (skin.builtin ? ' · 内置' : '')); author.title = author.textContent;
      meta.append(nameRow,author); select.append(preview,meta);
      const more = element('details', 'doustyle-skin-more');
      const summary = element('summary', '', '···'); summary.setAttribute('aria-label',skin.name + ' 更多操作'); summary.title = '更多操作';
      summary.addEventListener('click',() => { for (const other of pane.querySelectorAll('.doustyle-skin-more[open]')) if (other !== more) other.open = false; });
      const menu = element('div', 'doustyle-skin-menu');
      menu.append(button('', '查看大图', () => showDetail(skin.id)),button('', '导出', () => attempt(() => { more.open = false; download(skin.id); summary.focus(); })));
      if (!skin.builtin) menu.append(button('', '移除', () => remove(skin)));
      for (const control of menu.querySelectorAll('button')) control.dataset.doustyleGalleryControl = '';
      more.addEventListener('focusout', event => { if (!more.contains(event.relatedTarget)) more.open = false; });
      more.append(summary,menu); card.append(select,more); grid.append(card);
    }
    const add = button('doustyle-skin-add', undefined, () => input.click()); add.setAttribute('aria-label','导入新皮肤'); add.dataset.doustyleGalleryControl = ''; add.disabled = importing;
    const plus = element('span', 'doustyle-skin-add-icon', '+'); plus.setAttribute('aria-hidden','true');
    add.append(plus,element('strong','','导入皮肤'),element('span','doustyle-skin-add-hint','添加 .style.json 文件'));
    grid.append(add);
  };
  const refresh = () => {
    if (runtime.active()) viewingSkins = true;
    styleButton.setAttribute('aria-pressed',String(!viewingSkins)); skinButton.setAttribute('aria-pressed',String(viewingSkins));
    tabs.hidden = viewingSkins; content.hidden = viewingSkins; pane.hidden = !viewingSkins; resetButton.hidden = viewingSkins;
    render();
  };
  // Keep disclosure menus local to this panel; no document listeners survive reinjection.
  panel.addEventListener('click', event => { if (!event.target.closest('.doustyle-skin-more')) closeMenus(); });
  input.addEventListener('change',async () => {
    const files = [...input.files]; input.value = ''; if (!files.length) return;
    importing = true; importButton.disabled = true; grid.querySelector('.doustyle-skin-add')?.setAttribute('disabled','');
    const imported = []; const failures = [];
    try {
      for (const file of files) {
        try {
          if (file.size > model.maxBytes) throw new Error('皮肤文件不能超过 1 MB');
          const id = runtime.install(JSON.parse(await file.text())); imported.push(runtime.get(id).name);
        } catch(error) { failures.push(file.name + '：' + (error instanceof SyntaxError ? '文件不是有效的 JSON 皮肤。' : error.message)); }
      }
      viewingSkins = true; detailId = null; refresh();
      const success = imported.length === 1 ? '已导入「' + imported[0] + '」，点击卡片即可切换。' : imported.length ? '已导入 ' + imported.length + ' 套皮肤，点击卡片即可切换。' : '';
      report([success,...failures].filter(Boolean).join('\n'),failures.length > 0);
    } finally { importing = false; importButton.disabled = false; grid.querySelector('.doustyle-skin-add')?.removeAttribute('disabled'); }
  });
  if (runtime.error()) report(runtime.error(),true);
  refresh();
  return {
    refresh,
    showSkins: () => { viewingSkins = true; detailId = null; refresh(); workshop.check(); },
    handleEscape: () => {
      if (!viewingSkins || pane.hidden || panel.closest('[hidden]')) return false;
      const menu = pane.querySelector('.doustyle-skin-more[open]');
      if (menu) { menu.open = false; menu.querySelector('summary').focus(); return true; }
      if (detailId) { backToGrid(); return true; }
      return false;
    }
  };
}
