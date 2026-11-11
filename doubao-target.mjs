// Keep app discovery, injection and the native update bridge on the same allowlist.
export function isDoubaoChatURL(value) {
  return typeof value === "string" &&
    /^(?:chrome|doubao|doubaowork):\/\/(?:doubao-chat|doubaowork-chat)(?:[/?#]|$)/.test(value);
}

export function isDoubaoChatOrigin(value) {
  return isDoubaoChatURL(value) &&
    /^(?:chrome|doubao|doubaowork):\/\/(?:doubao-chat|doubaowork-chat)\/?$/.test(value);
}

export const doubaoPageGuard = `if (!(${isDoubaoChatURL.toString()})(location.href)) return false;`;
