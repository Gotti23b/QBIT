(() => {
  const fallbackStart = "Todavía no tengo una respuesta para eso.";
  let latestAnswer = "";
  const originalSetItem = Storage.prototype.setItem;

  window.addEventListener("message", event => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.source !== "QBIT_EXTENSION" || event.data?.type !== "AI_RESULT") return;
    latestAnswer = String(event.data.answer || "");
    if (!latestAnswer) return;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith("qbit-chat-history-")) continue;
      try {
        const chats = JSON.parse(localStorage.getItem(key) || "[]");
        const chat = [...chats].sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))[0];
        const item = [...(chat?.messages || [])].reverse().find(message => message.kind === "bot" && message.text?.startsWith(fallbackStart));
        if (item) { item.text = latestAnswer; originalSetItem.call(localStorage, key, JSON.stringify(chats)); }
      } catch {}
    }
  });

  Storage.prototype.setItem = function (key, value) {
    if (latestAnswer && String(key).startsWith("qbit-chat-history-")) {
      try {
        const chats = JSON.parse(String(value));
        const chat = [...chats].sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))[0];
        const item = [...(chat?.messages || [])].reverse().find(message => message.kind === "bot" && message.text?.startsWith(fallbackStart));
        if (item) { item.text = latestAnswer; value = JSON.stringify(chats); }
      } catch {}
    }
    return originalSetItem.call(this, key, value);
  };
})();
