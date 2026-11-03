(() => {
  const fallbackStart = "Todavía no tengo una respuesta para eso.";
  const seen = new WeakSet();

  function hideLocalAI() {
    document.querySelectorAll('a[href*="local-ai.html"], .local-ai-link, .agent-tools, #agentStatus').forEach(node => node.remove());
  }

  function installConsoleButton() {
    const header = document.querySelector("header.top");
    if (!header || document.getElementById("qbitConsoleConnect")) return;
    const button = document.createElement("button");
    button.id = "qbitConsoleConnect";
    button.type = "button";
    button.className = "small primary";
    button.textContent = "Conectar IA";
    button.title = "Abrir QBIT Console para conectar este chat con la IA del navegador";
    button.addEventListener("click", () => { location.href = "qbit-console://start"; });
    header.append(button);
    chrome.runtime.sendMessage({ type: "QBIT_CONSOLE_STATUS" }).then(status => updateConsoleButton(status?.connected)).catch(() => updateConsoleButton(false));
  }

  function updateConsoleButton(connected) {
    const button = document.getElementById("qbitConsoleConnect");
    if (!button) return;
    button.textContent = connected ? "Consola conectada" : "Conectar IA";
    button.disabled = !!connected;
    button.classList.toggle("primary", !connected);
    button.title = connected ? "QBIT Console está conectada; usá una pestaña de IA y escribí en QBIT." : "Abrir QBIT Console para conectar este chat con la IA del navegador";
  }

  function saveAnswerInHistory(answer) {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key?.startsWith("qbit-chat-history-")) continue;
        const chats = JSON.parse(localStorage.getItem(key) || "[]");
        const chat = [...chats].sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))[0];
        const last = [...(chat?.messages || [])].reverse().find(item => item.kind === "bot");
        if (last?.text?.startsWith(fallbackStart)) { last.text = answer; localStorage.setItem(key, JSON.stringify(chats)); }
      }
    } catch (error) { console.warn("[QBIT Extension] No se pudo actualizar el historial de QBIT:", error); }
  }

  function handleUnanswered(chatbox, bubble) {
    if (seen.has(bubble)) return;
    const userBubble = bubble.previousElementSibling;
    const message = userBubble?.classList.contains("user") ? userBubble.innerText.replace(/^\s*Vos\s*/i, "").trim() : "";
    if (!message) return;
    seen.add(bubble);
    bubble.dataset.qbitExtensionPending = "true";
    bubble.replaceChildren(Object.assign(document.createElement("small"), { textContent: "QBIT · " }), document.createTextNode("Consultando la IA abierta en el navegador…"));

    chrome.runtime.sendMessage({ type: "QBIT_CONSOLE_PROMPT", message })
      .then(result => {
        const answer = result?.ok ? String(result.answer || "").trim() : "No pude consultar la IA: " + (result?.error || "error desconocido");
        bubble.replaceChildren(Object.assign(document.createElement("small"), { textContent: "QBIT" }), document.createTextNode(answer || "La IA devolvió una respuesta vacía."));
        delete bubble.dataset.qbitExtensionPending;
        saveAnswerInHistory(answer);
        window.postMessage({ source: "QBIT_EXTENSION", type: "AI_RESULT", answer }, location.origin);
      })
      .catch(error => {
        const answer = "No pude consultar la IA: " + (error?.message || "QBIT Extension no está conectada.");
        bubble.replaceChildren(Object.assign(document.createElement("small"), { textContent: "QBIT" }), document.createTextNode(answer));
        delete bubble.dataset.qbitExtensionPending;
        saveAnswerInHistory(answer);
        window.postMessage({ source: "QBIT_EXTENSION", type: "AI_RESULT", answer }, location.origin);
      });
  }

  function observe() {
    hideLocalAI();
    installConsoleButton();
    const chatbox = document.querySelector("#chatbox");
    if (!chatbox || chatbox.dataset.qbitExtensionObserved) return;
    chatbox.dataset.qbitExtensionObserved = "true";
    const scan = () => {
      for (const bubble of chatbox.querySelectorAll(".bubble.bot")) {
        const body = bubble.innerText.replace(/^\s*QBIT\s*/i, "").trim();
        if (body.startsWith(fallbackStart)) handleUnanswered(chatbox, bubble);
      }
    };
    new MutationObserver(scan).observe(chatbox, { childList: true, subtree: true, characterData: true });
    scan();
  }

  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === "QBIT_CONSOLE_STATUS_CHANGED") updateConsoleButton(message.connected);
  });

  if (location.pathname.includes("local-ai.html")) location.replace("https://gotti23b.github.io/QBIT/");
  new MutationObserver(observe).observe(document.documentElement, { childList: true, subtree: true });
  observe();
})();
