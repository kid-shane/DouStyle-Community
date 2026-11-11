// Self-contained: shared by the injector, CLI and tests. Skins are data, never scripts.
export function createSkinModel() {
  const format = 'doustyle.skin';
  const storageKey = 'doustyle-skins-v1';
  const maxBytes = 1024 * 1024;
  const selectors = {
    shell: '#chat-route-layout', main: '#chat-route-main main',
    titlebar: 'main [class~="h-header-height"]',
    titlebarButton: 'main [class~="h-header-height"] button',
    titlebarIcon: 'main [class~="h-header-height"] button svg',
    sidebar: '#flow_chat_sidebar',
    sidebarHeading: '#flow_chat_sidebar [data-testid="workspace-switch-chip"]',
    sidebarGroup: '#flow_chat_sidebar [class~="group/section-header"], #flow_chat_sidebar [data-testid="pinned-section"] > div:first-child',
    sidebarGroupText: '#flow_chat_sidebar [class~="group/section-header"] span',
    projectIcon: '#flow_chat_sidebar [class*="group/project-row"] button > span:first-child > svg',
    navigation: '#flow_chat_sidebar [class*="group/sidebar_nav_item"], #flow_chat_sidebar [data-testid="create_office_task_button"] > *',
    navigationIcon: '#flow_chat_sidebar [class*="group/sidebar_nav_item"] > svg',
    conversation: '#flow_chat_sidebar [data-testid="conversation-list-v2-item"], #flow_chat_sidebar [class*="group/project-row"]',
    selectedConversation: '#flow_chat_sidebar [aria-current="page"], #flow_chat_sidebar [class~="bg-dbx-fill-trans-10-hover"]',
    welcome: '#flow-chat-guidance-page', greeting: '#flow-chat-guidance-page [class*="greeting-text-"]',
    composer: '#input-engine-container, .guidance-input-wrapper', composerOutline: '#input-engine-container::after', composerSurface: '.guidance-input-surface', composerBody: '.guidance-input-content',
    editor: '.guidance-input-editor-wrapper', composerButton: '.guidance-input-content button',
    userMessage: '[class*="bg-g-send-msg-bubble-bg"]',
    menu: '[role="menu"], [role="listbox"], [data-slot="popover-content"]',
    menuItem: '[role="menuitem"], [role="option"]',
    dialog: '[role="dialog"]', settings: '.doubao-theme-settings-panel',
    settingsHeader: '.doubao-theme-settings-header', settingsTitle: '.doubao-theme-settings-title',
    settingsSubtitle: '.doubao-theme-settings-theme-name', settingsClose: '.doubao-theme-settings-close',
    settingsTab: '.doubao-theme-settings-tab, .doustyle-kind button',
    settingsSelectedTab: '.doubao-theme-settings-tab[aria-selected="true"], .doustyle-kind button[aria-pressed="true"]',
    settingsButton: '.doubao-theme-settings-panel button:not([data-doustyle-gallery-control]):not(.doustyle-kind button):not(.doubao-theme-settings-tab):not(.doubao-theme-settings-close):not(.doubao-theme-preset-option)',
    settingsInput: '.doubao-theme-settings-panel input:not([type="range"]):not([type="checkbox"]), .doubao-theme-settings-panel select',
    settingsFooter: '.doubao-theme-settings-footer',
    skinCard: '.doustyle-skin-card', skinBadge: '.doustyle-skin-badge',
    skinTitle: '.doustyle-skin-caption', skinMark: '.doustyle-skin-mark',
    scrollbar: '#flow_chat_sidebar ::-webkit-scrollbar',
    scrollbarThumb: '#flow_chat_sidebar ::-webkit-scrollbar-thumb'
  };
  const properties = new Set(('color background background-color background-image background-size background-position background-repeat border border-top border-right border-bottom border-left border-color border-width border-style border-radius box-shadow text-shadow outline outline-offset font-family font-size font-weight font-style line-height letter-spacing text-align text-decoration padding padding-top padding-bottom padding-left padding-right margin margin-top margin-bottom margin-left margin-right gap row-gap column-gap width min-width max-width height min-height max-height opacity fill stroke align-items justify-content flex-direction flex-wrap flex-grow flex-shrink grid-template-columns').split(' '));
  const object = v => v && typeof v === 'object' && !Array.isArray(v);
  const fail = message => { throw new Error(message); };
  const str = (v, label, length = 100) => typeof v === 'string' && v.trim() && v.length <= length ? v.trim() : fail(label + '无效');
  const id = v => typeof v === 'string' && /^[a-z][a-z0-9-]{1,63}$/.test(v) ? v : fail('皮肤 ID 无效');
  const safeValue = value => {
    if (typeof value !== 'string' || value.length > 800 || /[{};<>\\\x00-\x1f@]/.test(value) || /(?:url|image-set|expression|attr|env)\s*\(|!important|\/\*/i.test(value)) fail('样式值包含不支持的内容');
    return value;
  };
  const normalize = input => {
    if (!object(input) || input.format !== format || input.schemaVersion !== 1) fail('不是支持的 .style.json 皮肤文件');
    if (JSON.stringify(input).length > maxBytes) fail('皮肤文件不能超过 1 MB');
    const allowed = new Set(['format','schemaVersion','id','name','author','version','description','basedOn','baseMode','tokens','layout','welcome','rules','assets','decoration']);
    for (const k of Object.keys(input)) if (!allowed.has(k)) fail('不支持的皮肤字段：' + k);
    if (!['light','dark'].includes(input.baseMode)) fail('皮肤需要声明浅色或深色');
    const skin = { format, schemaVersion: 1, id: id(input.id), name: str(input.name,'名称',60), author: str(input.author,'作者',60), version: str(input.version,'版本',30), description: str(input.description,'介绍',240), baseMode: input.baseMode };
    if (input.basedOn) skin.basedOn = { id: id(input.basedOn.id), version: str(input.basedOn.version,'原作版本',30) };
    if (!object(input.tokens) || !Object.keys(input.tokens).length) fail('缺少皮肤颜色与字体');
    skin.tokens = {};
    const colorNames = 'accent accentHover accentPressed accentDeep link linkHover background sidebar surface surfaceSecondary surfaceTertiary surfaceElevated surfaceHover selectionBackground border borderStrong foreground userMessageBackground userMessageText scrollbar scrollbarHover contentCanvas'.split(' ');
    const required = [...colorNames, 'overlayShadow','fontUi','fontChat','colorScheme'];
    for (const name of required) {
      const v = input.tokens[name];
      if (typeof v !== 'string') fail('缺少皮肤令牌：' + name);
      if (colorNames.includes(name) && !/^#[0-9a-f]{6}$/i.test(v)) fail('颜色必须为六位色值：' + name);
      skin.tokens[name] = safeValue(v);
    }
    skin.tokens.colorScheme = skin.baseMode;
    // RGB values are derived, so creators only have to edit the corresponding color.
    for (const name of colorNames) skin.tokens[name + 'Rgb'] = [1,3,5].map(i => parseInt(skin.tokens[name].slice(i,i+2),16)).join(', ');
    skin.layout = {};
    for (const [key, min, max, fallback] of [['uiFontSize',12,18,14],['chatFontSize',13,20,15],['chatLineHeight',1.4,1.9,1.65],['contentGutter',12,360,120]]) {
      const v = input.layout?.[key] ?? fallback;
      if (!Number.isFinite(v) || v < min || v > max) fail('排版参数超出范围：' + key);
      skin.layout[key] = v;
    }
    for (const [key, fallback] of [['uniformChatTypography',false],['showConversationIcons',true]]) {
      const v = input.layout?.[key] ?? fallback;
      if (typeof v !== 'boolean') fail('排版开关无效：' + key);
      skin.layout[key] = v;
    }
    skin.assets = {};
    if (input.assets !== undefined && !object(input.assets)) fail('素材格式无效');
    for (const [key, value] of Object.entries(input.assets || {})) {
      id(key);
      if (typeof value !== 'string' || !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) fail('素材需内嵌 PNG、JPG、WebP 或 GIF');
      skin.assets[key] = value;
    }
    skin.welcome = { text: str(input.welcome?.text || '今天有什么工作要处理？','欢迎语',40), image: input.welcome?.image || 'none' };
    if (skin.welcome.image !== 'none' && !(typeof skin.welcome.image === 'string' && skin.welcome.image.startsWith('asset:') && skin.assets[skin.welcome.image.slice(6)])) fail('欢迎图素材不存在');
    skin.decoration = { title: str(input.decoration?.title || skin.name,'窗口标题',60), emblem: input.decoration?.emblem === 'computer' ? 'computer' : 'none' };
    if (!Array.isArray(input.rules) || input.rules.length > 150) fail('皮肤最多支持 150 组组件样式');
    skin.rules = input.rules.map(rule => {
      if (!object(rule) || !selectors[rule.target] || !object(rule.style)) fail('未知的皮肤组件');
      const state = rule.state || '';
      if (!['', 'hover','active','focus-visible','disabled'].includes(state)) fail('不支持的组件状态');
      const style = {};
      for (const [property, value] of Object.entries(rule.style)) {
        if (!properties.has(property)) fail('不支持的样式属性：' + property);
        if (typeof value === 'string' && value.startsWith('asset:')) {
          if (property !== 'background-image' || !skin.assets[value.slice(6)]) fail('背景素材不存在');
          style[property] = value;
        } else style[property] = safeValue(value);
      }
      return { target: rule.target, ...(state ? { state } : {}), style };
    });
    return skin;
  };
  const compile = input => {
    const skin = normalize(input);
    const prefix = ':root[data-doubao-skin="' + skin.id + '"][data-doubao-skin]';
    const variables = Object.entries(skin.tokens).map(([key,value]) => '--db-theme-' + key.replace(/[A-Z]/g, c => '-' + c.toLowerCase()) + ':' + value + '!important').join(';');
    const rules = skin.rules.map(rule => {
      const selector = selectors[rule.target].split(', ').map(s => {
        const pseudo = s.match(/::[a-z-]+$/)?.[0] || '';
        let base = pseudo ? s.slice(0,-pseudo.length) : s;
        if (/\s$/.test(base)) base += '*';
        return prefix + ' ' + base + (rule.state ? ':' + rule.state : '') + ':not(.html-previewer *):not([data-doustyle-preview] *)' + pseudo;
      }).join(',');
      const css = Object.entries(rule.style).map(([key,value]) => key + ':' + (value.startsWith('asset:') ? 'url("' + skin.assets[value.slice(6)] + '")' : value) + '!important').join(';');
      return selector + '{' + css + '}';
    }).join('\n');
    return prefix + '{' + variables + '}\n' + rules;
  };
  return { format, storageKey, maxBytes, selectors, properties: [...properties], normalize, compile };
}
