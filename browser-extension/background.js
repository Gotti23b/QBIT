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
let manuallyDisconnected = false;
const waiting = new Map();

async function broadcastConsoleStatus() {
  const tabs = await chrome.tabs.query({ url: "https://gotti23b.github.io/QBIT/*" });
  for (const tab of tabs) if (tab.id) chrome.tabs.sendMessage(tab.id, { type: "QBIT_CONSOLE_STATUS_CHANGED", connected: !!socket && socket.readyState === WebSocket.OPEN }).catch(() => {});
}

function connectConsole() {
  if (manuallyDisconnected) return;
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
    if (message.type === "reload_extension") {
      const target = String(message.version || "");
      chrome.storage.local.get({ reloadedFor: "" }, ({ reloadedFor }) => {
        // Solo una vez por versión: si Chrome tiene cargada otra carpeta, no entramos en un bucle.
        if (reloadedFor === target) { console.warn("[QBIT] QBIT trae la extensión " + target + " pero Chrome carga otra carpeta. Cargá la carpeta browser-extension de QBIT."); return; }
        chrome.storage.local.set({ reloadedFor: target }, () => { console.log("[QBIT] Recargando la extensión para usar la versión " + target); chrome.runtime.reload(); });
      });
      return;
    }
    if (message.type === "dispatch_ai") {
      console.log("[QBIT] Pedido recibido de QBIT:", message.id);
      chrome.storage.local.get({ provider: "auto" }, settings => {
        const selected = settings.provider && settings.provider !== "auto" ? String(settings.provider).toLowerCase() : (message.provider || "auto");
        runAI(message.message, selected)
          .then(result => socket?.readyState === WebSocket.OPEN && socket.send(JSON.stringify({ type: "ai_result", id: message.id, ok: true, answer: result.answer, provider: result.provider })))
          .catch(error => socket?.readyState === WebSocket.OPEN && socket.send(JSON.stringify({ type: "ai_result", id: message.id, ok: false, error: error?.message || String(error) })));
      });
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

async function sendPromptToTab(tabId, payload) {
  try {
    return await chrome.tabs.sendMessage(tabId, payload);
  } catch (error) {
    const reason = String(error?.message || error);
    if (!/receiving end does not exist|could not establish connection|no receiver/i.test(reason)) throw error;

    // La pestaña puede estar abierta desde antes de instalar/recargar la extensión.
    // Inyectamos el receptor bajo demanda y volvemos a intentar el envío.
    await chrome.scripting.executeScript({ target: { tabId }, files: ["ai-provider.js"] });
    await new Promise(resolve => setTimeout(resolve, 250));
    return await chrome.tabs.sendMessage(tabId, payload);
  }
}

async function runAI(message, requestedProvider) {
  const providerKey = String(requestedProvider || "auto").toLowerCase();
  const urlPatterns = providerKey === "auto" ? Object.values(PROVIDERS).flat() : PROVIDERS[providerKey];
  if (!urlPatterns) throw new Error("No reconozco ese proveedor de IA.");
  const tabs = await chrome.tabs.query({ url: urlPatterns });
  if (!tabs.length) throw new Error("Abrí una pestaña de ChatGPT, Arena.ai, Gemini, Claude, DeepSeek, Qwen o Meta AI.");
  const tab = tabs.sort((a, b) => Number(b.active) - Number(a.active) || (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
  if (!Number.isInteger(tab.id)) throw new Error("No pude identificar la pestaña de IA.");
  const payload = { type: "QBIT_AI_PROMPT", message: String(message || "").slice(0, 12000) };

  // Enviar a la pestaña existente sin activarla ni cambiar el foco de Chrome.
  // Así QBIT puede consultar la IA en segundo plano sin sacar al usuario de su pestaña.
  for (let i = 0; i < 40; i++) { // hasta 20 s si Chrome tuvo que recargarla
    const current = await chrome.tabs.get(tab.id).catch(() => null);
    if (!current || current.status === "complete") break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  const result = await sendPromptToTab(tab.id, payload);
  console.log("[QBIT] Resultado de la pestaña de IA:", result);
  if (!result?.ok) throw new Error(result?.error || "La IA no devolvió una respuesta.");
  return result;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "QBIT_CONNECTOR_CONTROL") { if(message.action==="connect"){manuallyDisconnected=false;connectConsole();sendResponse({ok:true});}else if(message.action==="disconnect"){manuallyDisconnected=true;if(socket){const old=socket;socket=null;old.close();}rejectWaiting("Desconectado desde QBIT Extension.");broadcastConsoleStatus();sendResponse({ok:true});}else if(message.action==="status")sendResponse({connected:!!socket&&socket.readyState===WebSocket.OPEN});return false; }
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

connectConsole();
chrome.runtime.onStartup.addListener(connectConsole);
setInterval(() => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ping" })); else connectConsole(); }, 20000);
