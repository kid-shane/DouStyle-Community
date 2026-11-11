// Self-contained for injection. Keep React-owned nodes in place:
// native layouts handle tool overflow, and one added entry opens the computer menu.
export function installCleanInput(getEnabled, page = window) {
  const doc = page.document;
  let state = null;
  let frame = 0;
  let disposed = false;
  let transition = 0;
  const warmedTriggers = new WeakSet();
  const setAttribute = (node, name, value) => {
    if (node.getAttribute(name) !== value) node.setAttribute(name, value);
  };
  const setProperty = (node, name, value) => {
    if (node.style.getPropertyValue(name) !== value) node.style.setProperty(name, value);
  };
  const mark = (node, role) => { if (node) setAttribute(node, "data-doubao-clean-input", role); };
  const toggleNative = (trigger) => trigger.dispatchEvent(new page.KeyboardEvent("keydown", {
    key: "Enter", code: "Enter", bubbles: true, cancelable: true
  }));
  const menuFor = (trigger) => {
    const id = trigger?.getAttribute("aria-controls");
    const menu = id && doc.getElementById(id);
    return menu?.matches('[role="menu"][data-state="open"]') ? menu : null;
  };
  const detachMenu = () => {
    if (!state?.menu) return;
    state.menu.removeEventListener("keydown", onMenuKeyDown, true);
    for (const item of state.temporaryTabStops || []) {
      if (item.getAttribute("tabindex") === "-1") item.removeAttribute("tabindex");
    }
    state.temporaryTabStops = new Set();
    state.proxy?.remove();
    state.menu = null;
    state.proxy = null;
  };
  const teardown = () => {
    transition += 1;
    if (!state) return;
    detachMenu();
    resizeObserver.disconnect();
    for (const node of [state.composer, state.list, state.listParent, state.mode, state.more, ...state.spacers]) {
      node?.removeAttribute("data-doubao-clean-input");
    }
    if (state.mode) {
      state.mode.style.removeProperty("--doubao-clean-anchor-left");
      state.mode.style.removeProperty("--doubao-clean-anchor-top");
    }
    if (state.more) {
      if (state.moreLabel === null) state.more.removeAttribute("aria-label");
      else state.more.setAttribute("aria-label", state.moreLabel);
    }
    state = null;
  };
  const schedule = () => {
    if (disposed || frame) return;
    frame = page.requestAnimationFrame(() => { frame = 0; sync(); });
  };
  const resizeObserver = new page.ResizeObserver(schedule);
  const findParts = () => {
    const composer = doc.querySelector('#input-engine-container[data-testid="chat_input"]');
    const list = composer?.querySelector('.guidance-input-actions :is(.bp5-overflow-list, [class*="deterministic-overflow-list-"])');
    const deterministic = list?.className.includes("deterministic-overflow-list-");
    const menuTriggers = list ? [...list.querySelectorAll('button[data-slot="dropdown-menu-trigger"]')].filter((node) =>
      deterministic ? !node.closest('[class*="overflow-visible-item-"], [class*="overflow-measurement-layer-"]') : node.parentElement === list
    ) : [];
    const more = menuTriggers.find(node => node.getAttribute("aria-haspopup") === "menu");
    const modeCandidate = composer?.querySelector('[data-valid-btn="mode-select-action-btn"][data-slot="dropdown-menu-trigger"]');
    // In the new single-mode layout Computer is itself a native overflow item.
    const mode = modeCandidate && !list?.contains(modeCandidate) ? modeCandidate : null;
    const upload = composer?.querySelector('[data-testid="upload_file_button"]');
    // Unknown future markup stays native rather than hiding unreachable controls.
    if (!list || (!deterministic && !mode) || !upload || (menuTriggers.length && !more)) return null;
    let modeBranch = mode || upload;
    while (modeBranch.parentElement && modeBranch.parentElement !== composer && !modeBranch.parentElement.contains(list)) {
      modeBranch = modeBranch.parentElement;
    }
    const toolbar = modeBranch.parentElement;
    if (!toolbar || toolbar === composer || !toolbar.contains(list) || !toolbar.contains(upload)) return null;
    const spacers = (mode ? [modeBranch.previousElementSibling, modeBranch.nextElementSibling] : [modeBranch.nextElementSibling]).filter((node) =>
      node?.tagName === "DIV" && !node.children.length && !(node.textContent || "").trim()
    );
    return { composer, list, listParent: list.parentElement, mode, more, spacers };
  };
  const onMenuKeyDown = (event) => {
    if (!state?.menu) return;
    // The injected row is not in Radix's private collection. Include it in the
    // same arrow-key loop without taking over nested menus or native actions.
    if (event.target.closest('[role="menu"]') !== state.menu) return;
    const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
    if (!keys.includes(event.key)) return;
    const items = [...state.menu.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]')]
      .filter((node) => node.closest('[role="menu"]') === state.menu && !node.hasAttribute("data-disabled")
        && node.getAttribute("aria-disabled") !== "true" && node.getBoundingClientRect().height > 0);
    if (!items.length) return;
    const current = items.indexOf(doc.activeElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
      : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    event.preventDefault();
    event.stopImmediatePropagation();
    // Some native custom items (e.g. Project) omit tabindex despite having
    // keyboard handlers. Make the destination focusable only while this menu lives.
    if (!items[next].hasAttribute("tabindex")) {
      state.temporaryTabStops.add(items[next]);
      items[next].tabIndex = -1;
    }
    items[next].focus();
  };
  const openComputerMenu = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const current = state;
    if (!current || !getEnabled() || current.proxy.disabled) return;
    const ticket = ++transition;
    if (current.more.getAttribute("aria-expanded") === "true") toggleNative(current.more);
    // Let the native overflow focus scope unmount before opening another one.
    page.requestAnimationFrame(() => page.requestAnimationFrame(() => {
      if (disposed || ticket !== transition || state !== current || !getEnabled() || !current.mode.isConnected) return;
      toggleNative(current.mode);
      current.openedComputer = true;
      schedule();
    }));
  };
  const syncMenu = () => {
    if (!state.mode) { detachMenu(); return; }
    const menu = menuFor(state.more);
    if (state.menu !== menu) {
      detachMenu();
      if (!menu) return;
      state.menu = menu;
      state.temporaryTabStops = new Set();
      const proxy = doc.createElement("button");
      proxy.type = "button";
      proxy.className = "doubao-theme-clean-computer-item";
      proxy.setAttribute("role", "menuitem");
      proxy.setAttribute("aria-haspopup", "menu");
      proxy.tabIndex = -1;
      proxy.addEventListener("click", openComputerMenu);
      proxy.addEventListener("pointermove", () => { if (!proxy.disabled) proxy.focus({ preventScroll: true }); });
      menu.prepend(proxy);
      menu.addEventListener("keydown", onMenuKeyDown, true);
      state.proxy = proxy;
    }
    if (!state.proxy) return;
    const source = state.mode.querySelector(":scope > button");
    const label = (source?.textContent || "电脑").trim();
    if (state.proxy.dataset.label !== label) {
      state.proxy.dataset.label = label;
      state.proxy.setAttribute("aria-label", "电脑：" + label);
      const text = doc.createElement("span");
      text.textContent = label;
      const chevron = doc.createElement("span");
      chevron.className = "doubao-theme-clean-computer-chevron";
      chevron.setAttribute("aria-hidden", "true");
      chevron.textContent = "›";
      const icon = source?.querySelector("svg")?.cloneNode(true);
      if (icon) { icon.setAttribute("aria-hidden", "true"); icon.removeAttribute("id"); }
      state.proxy.replaceChildren(...(icon ? [icon] : []), text, chevron);
    }
    const disabled = !!source?.disabled || source?.getAttribute("data-disabled") === "true"
      || state.mode.getAttribute("aria-disabled") === "true";
    if (state.proxy.disabled !== disabled) state.proxy.disabled = disabled;
  };
  const sync = () => {
    if (disposed) return;
    const parts = getEnabled() ? findParts() : null;
    if (!parts) { teardown(); return; }
    if (!state || state.composer !== parts.composer || state.list !== parts.list || state.mode !== parts.mode || state.more !== parts.more
      || state.listParent !== parts.listParent || state.spacers.length !== parts.spacers.length
      || state.spacers.some((node, index) => node !== parts.spacers[index])) {
      teardown();
      state = { ...parts, moreLabel: parts.more?.getAttribute("aria-label") ?? null, menu: null, proxy: null, openedComputer: false };
      for (const node of [state.composer, state.listParent, state.list, state.more]) if (node) resizeObserver.observe(node);
    }
    // React may reuse nodes but reset their attributes. Repair idempotently on
    // every sync, not just when the composer or menu trigger is replaced.
    mark(state.composer, "enabled");
    mark(state.list, "overflow");
    mark(state.listParent, "overflow-container");
    // Native layouts mount More only after the container becomes narrow.
    // Keep Computer available until that real trigger is ready; ignore hidden
    // measurement copies of skill buttons when looking for it.
    if (!state.more) {
      // Blueprint first renders a lazy-loading placeholder. Its mouseover
      // handler loads the real menu; warm it once without opening any menu.
      const placeholder = [...state.list.children].find(node => node.matches('button:not([data-slot="dropdown-menu-trigger"])')
        && node.getAttribute("aria-hidden") !== "true");
      if (placeholder && !warmedTriggers.has(placeholder)) {
        warmedTriggers.add(placeholder);
        placeholder.dispatchEvent(new page.MouseEvent("mouseover", { bubbles: true }));
      }
      return;
    }
    mark(state.mode, "computer-anchor");
    mark(state.more, "more");
    state.spacers.forEach((node) => mark(node, "spacer"));
    setAttribute(state.more, "aria-label", "更多输入选项");
    if (state.mode) {
      const rect = state.more.getBoundingClientRect();
      setProperty(state.mode, "--doubao-clean-anchor-left", rect.left + "px");
      setProperty(state.mode, "--doubao-clean-anchor-top", rect.top + "px");
    }
    syncMenu();
    const computerOpen = state.mode?.getAttribute("aria-expanded") === "true";
    if (state.openedComputer && !computerOpen && !menuFor(state.mode)) {
      // Native close autofocus targets the visually hidden original anchor.
      if (doc.activeElement === doc.body || state.mode.contains(doc.activeElement)) state.more.focus({ preventScroll: true });
      state.openedComputer = false;
    }
  };
  const observer = new page.MutationObserver((records) => {
    if (records.some(({ type, target, attributeName }) => {
      if (type !== "attributes") return true;
      // Layout and selector changes elsewhere in a chat do not need a scan.
      if (attributeName !== "class" && attributeName !== "style") return true;
      return !!target.closest?.('#input-engine-container') || !!(state && (
        target.contains(state.composer) || state.menu?.contains(target)
      ));
    })) schedule();
  });
  observer.observe(doc.documentElement, {
    subtree: true, childList: true, characterData: true, attributes: true,
    attributeFilter: ["aria-expanded", "aria-controls", "aria-haspopup", "aria-label", "data-state", "data-disabled", "disabled",
      "id", "class", "style", "hidden", "data-testid", "data-valid-btn", "data-slot", "data-doubao-clean-input"]
  });
  page.addEventListener("resize", schedule);
  page.addEventListener("scroll", schedule, true);
  page.addEventListener("focus", schedule);
  page.addEventListener("pageshow", schedule);
  doc.addEventListener("visibilitychange", schedule);
  schedule();
  return {
    sync: schedule,
    cleanup: () => {
      disposed = true;
      observer.disconnect();
      if (frame) page.cancelAnimationFrame(frame);
      page.removeEventListener("resize", schedule);
      page.removeEventListener("scroll", schedule, true);
      page.removeEventListener("focus", schedule);
      page.removeEventListener("pageshow", schedule);
      doc.removeEventListener("visibilitychange", schedule);
      teardown();
    }
  };
}
