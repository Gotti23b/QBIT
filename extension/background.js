const CONSOLE_URL = "ws://127.0.0.1:17614/qbit-console";
const PROVIDERS = {
  chatgpt: ["https://chatgpt.com/*", "https://chat.openai.com/*"],
  arena: ["https://arena.ai/*"],
  gemini: ["https://gemini.google.com/*"],
  claude: ["https://claude.ai/*"],
  deepseek: ["https://chat.deepseek.com/*"],
  qwen: ["https://chat.qwen.ai/*"],
  meta: ["https://www.meta.ai/*", "https://meta.ai/*"]
};
let socket = null;
let retryDelay = 1000;
const waiting = new Map();

async function broadcastConsoleStatus() {
  const tabs = await chrome.tabs.query({ url: "https://gotti23b.github.io/QBIT/*" });
  for (const tab of tabs) if (tab.id) chrome.tabs.sendMessage(tab.id, { type: "QBIT_CONSOLE_STATUS_CHANGED", connected: !!socket && socket.readyState === WebSocket.OPEN }).catch(() => {});
}

function connectConsole() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  try { socket = new WebSocket(CONSOLE_URL); }
  catch (error) { console.warn("[QBIT Extension] No se pudo abrir QBIT Console:", error); scheduleReconnect(); return; }
  socket.onopen = () => {
    retryDelay = 1000;
    socket.send(JSON.stringify({ type: "hello", extension: chrome.runtime.id, version: chrome.runtime.getManifest().version }));
    console.info("[QBIT Extension] Conectada a QBIT Console.");
    broadcastConsoleStatus();
  };
  socket.onmessage = event => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (message.type === "result" && waiting.has(message.id)) {
      const pending = waiting.get(message.id);
      waiting.delete(message.id);
      clearTimeout(pending.timer);
      pending.resolve(message);
      return;
    }
    if (message.type === "dispatch_ai") {
      console.log("[QBIT] Pedido recibido de QBIT:", message.id);
      runAI(message.message, message.provider || "auto")
        .then(result => socket?.readyState === WebSocket.OPEN && socket.send(JSON.stringify({ type: "ai_result", id: message.id, ok: true, answer: result.answer, provider: result.provider })))
        .catch(error => socket?.readyState === WebSocket.OPEN && socket.send(JSON.stringify({ type: "ai_result", id: message.id, ok: false, error: error?.message || String(error) })));
    }
  };
  socket.onclose = () => { socket = null; rejectWaiting("QBIT Console se desconectó."); broadcastConsoleStatus(); scheduleReconnect(); };
  socket.onerror = () => { try { socket?.close(); } catch {} };
}

function scheduleReconnect() {
  const delay = retryDelay;
  retryDelay = Math.min(Math.round(retryDelay * 1.7), 10000);
  setTimeout(connectConsole, delay);
}

function rejectWaiting(error) {
  for (const [id, pending] of waiting) {
    clearTimeout(pending.timer);
    pending.reject(new Error(error));
    waiting.delete(id);
  }
}

async function waitForConsole() {
  const until = Date.now() + 7000;
  while (Date.now() < until) {
    if (socket?.readyState === WebSocket.OPEN) return;
    connectConsole();
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("QBIT Console no está conectada. Hacé clic en Conectar IA y volvé a enviar el mensaje.");
}

async function sendConsolePrompt(message) {
  await waitForConsole();
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => { waiting.delete(id); reject(new Error("La consulta tardó más de cuatro minutos.")); }, 250000);
    waiting.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ type: "qbit_prompt", id, provider: "auto", message: String(message).slice(0, 12000) }));
  });
}

async function runAI(message, requestedProvider) {
  const providerKey = String(requestedProvider || "auto").toLowerCase();
  const urlPatterns = providerKey === "auto" ? Object.values(PROVIDERS).flat() : PROVIDERS[providerKey];
  if (!urlPatterns) throw new Error("No reconozco ese proveedor de IA.");
  const tabs = await chrome.tabs.query({ url: urlPatterns });
  if (!tabs.length) throw new Error("Abrí e iniciá sesión en una pestaña de ChatGPT o Arena.ai. También podés usar Gemini, Claude, DeepSeek, Qwen o Meta AI.");
  const tab = tabs.sort((a, b) => Number(b.active) - Number(a.active) || (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
  // Traemos la pestaña de IA al frente mientras responde (en segundo plano Chrome
  // la frena y no habilita el botón Enviar) y después volvemos a la anterior.
  const [previousTab] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
  await new Promise(resolve => setTimeout(resolve, 400));
  for (let i = 0; i < 40; i++) { // hasta 20 s si Chrome tuvo que recargarla
    const current = await chrome.tabs.get(tab.id).catch(() => null);
    if (!current || current.status === "complete") break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  let result;
  try {
    result = await chrome.tabs.sendMessage(tab.id, { type: "QBIT_AI_PROMPT", message: String(message || "").slice(0, 12000) });
  } finally {
    if (previousTab?.id && previousTab.id !== tab.id) chrome.tabs.update(previousTab.id, { active: true }).catch(() => {});
  }
  console.log("[QBIT] Resultado de la pestaña de IA:", result);
  if (!result?.ok) throw new Error(result?.error || "La IA no devolvió una respuesta.");
  return result;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "QBIT_CONSOLE_PROMPT") {
    sendConsolePrompt(String(message.message || "").slice(0, 12000))
      .then(sendResponse, error => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }
  if (message?.type === "QBIT_CONSOLE_STATUS") {
    sendResponse({ connected: !!socket && socket.readyState === WebSocket.OPEN });
    return false;
  }
});

chrome.action.onClicked.addListener(async () => {
  const tabs = await chrome.tabs.query({ url: "https://gotti23b.github.io/QBIT/*" });
  const tab = tabs[0];
  if (tab?.id) await chrome.tabs.update(tab.id, { active: true });
  else await chrome.tabs.create({ url: "https://gotti23b.github.io/QBIT/" });
});

connectConsole();
chrome.runtime.onStartup.addListener(connectConsole);
setInterval(() => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ping" })); else connectConsole(); }, 20000);
