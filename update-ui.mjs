// Serialized into the settings page; native Sparkle owns all install decisions.
export function installUpdateControl(parent, initial) {
  const group = document.createElement("span");
  group.className = "doubao-theme-update";
  const version = document.createElement("span");
  const button = document.createElement("button");
  button.type = "button";
  button.id = "doubao-theme-check-updates";
  button.className = "doubao-theme-settings-reset";
  let timeout;
  let state = initial;
  const render = (value) => {
    state = value;
    version.textContent = value.version ? `v${value.version}` : "开发版";
    clearTimeout(timeout);
    button.disabled = !value.enabled || value.busy;
    button.textContent = value.busy ? "正在更新…" : "检查更新";
    button.title = value.message || (value.enabled ? "检查新版并在更新窗口中安装" : "请从支持更新的豆Style应用启动");
  };
  window.__doubaoThemeUpdateState = render;
  button.addEventListener("click", () => {
    if (button.disabled) return;
    if (typeof window.__doustyleUpdateCommand !== "function") {
      render({ ...state, enabled: false, message: "更新服务未连接，请重新打开豆Style" });
      return;
    }
    render({ ...state, busy: true });
    // Recover if the launcher/bridge has exited without responding.
    timeout = setTimeout(() => render({ ...state, busy: false, message: "未收到更新服务响应，可重试或重新打开豆Style" }), 10000);
    window.__doustyleUpdateCommand("check");
  });
  render(initial);
  group.append(version, button);
  parent.append(group);
}
