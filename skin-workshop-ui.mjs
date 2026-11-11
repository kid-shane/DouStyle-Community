// Serialized into the page. Installation runs in the local injector, never in the renderer.
export function installWorkshopControl(parent) {
  const box = document.createElement('section'); box.className = 'doustyle-workshop'; box.setAttribute('aria-label','皮肤工坊');
  const row = document.createElement('div'); row.className = 'doustyle-workshop-row';
  const copy = document.createElement('div');
  const title = document.createElement('strong');
  const description = document.createElement('p'); description.setAttribute('role','status'); description.setAttribute('aria-live','polite');
  const action = document.createElement('button'); action.type = 'button'; action.id = 'doustyle-workshop-action';
  const spinner = document.createElement('span'); spinner.className = 'doustyle-workshop-spinner'; spinner.setAttribute('aria-hidden','true');
  const label = document.createElement('span'); action.append(spinner,label);
  copy.append(title,description); row.append(copy,action);
  const usage = document.createElement('div'); usage.className = 'doustyle-workshop-usage'; usage.hidden = true;
  const instruction = document.createElement('p'); instruction.textContent = '在豆包的本地电脑模式下，新建对话试试：';
  const example = document.createElement('p'); example.className = 'doustyle-workshop-example';
  example.textContent = '请使用「豆Style 皮肤工坊」，帮我制作并应用一套复古 Macintosh 风格的皮肤。';
  const copyButton = document.createElement('button'); copyButton.type = 'button'; copyButton.textContent = '复制这句话';
  const hint = document.createElement('p'); hint.className = 'doustyle-workshop-hint'; hint.textContent = '文件已安装到本机；若豆包未找到技能，可重新打开豆包后再试。';
  usage.append(instruction,example,copyButton,hint); box.append(row,usage); parent.append(box);
  let state = {status:'checking'};
  let timeout;
  let copyTimer;
  const render = next => {
    clearTimeout(timeout);
    if (state.status === 'installing' && next.status === 'installed') { usage.hidden = false; requestAnimationFrame(() => usage.scrollIntoView({block:'nearest'})); }
    state = next; box.dataset.state = state.status;
    const busy = ['checking','installing'].includes(state.status);
    action.disabled = busy; spinner.hidden = !busy; action.setAttribute('aria-busy',String(busy));
    title.textContent = state.status === 'installed' ? '✓ 皮肤工坊已安装' : '用 AI 做一套自己的皮肤';
    description.textContent = state.status === 'installed' ? '本地文件已就绪，可前往豆包验证调用。'
      : state.message || (state.status === 'installing' ? '正在安装到豆包的本地技能目录…' : '安装皮肤工坊，让豆包帮你设计和修改。');
    label.textContent = ({checking:'正在检查…',installing:'正在安装…',available:'安装皮肤工坊',installed:usage.hidden ? '查看用法' : '收起用法',conflict:'重新检查',missing:'重试',error:'重试',unavailable:'重新连接'})[state.status];
    if (state.status !== 'installed') usage.hidden = true;
    action.setAttribute('aria-expanded',String(!usage.hidden));
    if (busy) timeout = setTimeout(() => render({status:'unavailable',message:'暂时未收到安装服务响应，可重新连接检查结果，或重新打开豆Style。'}),10000);
  };
  const request = command => {
    if (typeof window.__doustyleWorkshopCommand !== 'function') {
      render({status:'unavailable',message:'安装服务未连接，请重新打开新版豆Style。'}); return;
    }
    render({status:command === 'install' ? 'installing' : 'checking'});
    try { window.__doustyleWorkshopCommand(command); }
    catch { render({status:'unavailable',message:'安装服务未连接，请重新打开新版豆Style。'}); }
  };
  action.addEventListener('click', () => {
    if (state.status === 'installed') { usage.hidden = !usage.hidden; render(state); if (!usage.hidden) requestAnimationFrame(() => usage.scrollIntoView({block:'nearest'})); }
    else request(['conflict','unavailable'].includes(state.status) ? 'status' : 'install');
  });
  copyButton.addEventListener('click', async () => {
    let copied = false;
    try { await navigator.clipboard.writeText(example.textContent); copied = true; } catch {
      const text = document.createElement('textarea'); text.value = example.textContent; text.style.cssText = 'position:fixed;opacity:0;pointer-events:none'; box.append(text); text.select();
      try { copied = document.execCommand('copy'); } finally { text.remove(); copyButton.focus(); }
    }
    if (copied) {
      copyButton.textContent = '已复制'; clearTimeout(copyTimer); copyTimer = setTimeout(() => { copyButton.textContent = '复制这句话'; },2000);
    } else { hint.textContent = '未能自动复制，请选中上面的示例文字手动复制。'; }
  });
  window.__doubaoWorkshopState = render;
  render(window.__doubaoWorkshopLastState || state);
  request('status');
  return { check: () => { if (!['checking','installing'].includes(state.status)) request('status'); } };
}
