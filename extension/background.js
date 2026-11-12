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
const QBIT_WEB_URLS=["https://gotti23b.github.io/QBIT/*","https://qbit.uno/*","https://www.qbit.uno/*"];
const QBIT_WEB_ORIGINS=["https://gotti23b.github.io","https://qbit.uno","https://www.qbit.uno"];

async function broadcastConsoleStatus() {
  const tabs = await chrome.tabs.query({ url: QBIT_WEB_URLS });
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
    if ((message.type === "result" || message.type === "web_artifact_result") && waiting.has(message.id)) {
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "QBIT_DESKTOP_CONTROL_STATUS") {
    chrome.storage.local.get({qbitDesktopControlEnabled:false},s=>sendResponse({enabled:!!s.qbitDesktopControlEnabled,connected:!!socket&&socket.readyState===WebSocket.OPEN}));return true;
  }
  if (message?.type === "QBIT_DESKTOP_CONTROL_SET") {
    if(!QBIT_WEB_ORIGINS.includes(sender?.origin)||!sender?.tab?.id){sendResponse({ok:false,error:"Origen de QBIT no autorizado."});return false;}
    chrome.storage.local.set({qbitDesktopControlEnabled:!!message.enabled},()=>sendResponse({ok:true,enabled:!!message.enabled,connected:!!socket&&socket.readyState===WebSocket.OPEN}));return true;
  }
  if (message?.type === "QBIT_WEB_AI_PROMPT") {
    if(!QBIT_WEB_ORIGINS.includes(sender?.origin)||!sender?.tab?.id){sendResponse({ok:false,error:"Origen de QBIT no autorizado."});return false;}
    chrome.storage.local.get({qbitDesktopControlEnabled:false},settings=>{
      const userMessage=String(message.message||"").slice(0,12000);
      const guide=settings.qbitDesktopControlEnabled ? "[Instrucciones de QBIT]\nSos QBIT, un asistente conectado a QBIT Desktop para Windows. Respondé en español.\nSi el usuario pide una acción en su PC, agregá al final un único bloque de código qbit con JSON, por ejemplo:\n\`\`\`qbit\n{\"artifact\":\"volume\",\"args\":{\"action\":\"up\"}}\n\`\`\`\nArtifacts disponibles: open_anything {\"query\":\"nombre\"}; system_info {}; volume {\"action\":\"up|down|mute\"} o {\"action\":\"set\",\"level\":0-100}; web_search {\"query\":\"texto\"}; time_date {}; automation {}; open_settings {\"page\":\"system|display|sound|network|wifi|bluetooth|apps|personalization|updates|storage|notifications|privacy\"}; lock_pc {}; battery_info {}; network_info {}; display_info {}; brightness_info {}; brightness_set {\"level\":0-100}; brightness_up {}; brightness_down {}; media_control {\"action\":\"play_pause|next|previous|stop\"}; create_folder {\"base\":\"documentos|descargas|escritorio\",\"path\":\"Carpeta nueva\"}; create_file {\"base\":\"documentos|descargas|escritorio\",\"path\":\"nota.txt\",\"content\":\"texto\"}; search_files {\"query\":\"nombre\"}; clipboard_write {\"text\":\"texto\"}; empty_recycle_bin {}; get_processes {}; cpu_usage {}; ram_usage {}; disk_usage {}; toggle_night_light {}; toggle_wifi {\"action\":\"on|off\"}; minimize_all {}; restore_all {}; focus_app {\"query\":\"aplicación\"}; close_window {\"query\":\"aplicación\"}; open_file_location {\"query\":\"archivo\"}; get_file_info {\"query\":\"archivo\"}; zip_files {\"query\":\"archivo\"}; unzip_file {\"query\":\"archivo ZIP\"}; read_text_file {\"query\":\"archivo de texto\"}; show_notification {\"title\":\"Título\",\"message\":\"Texto\"}; set_timer {\"seconds\":60,\"label\":\"Temporizador\"}; cancel_timer {\"id\":\"default\"}; open_calculator {}; open_notepad {}; open_task_manager {}; volume_info {}; volume_set {\"level\":0-100}; audio_mute {}.\nUsá el bloque solo cuando el usuario haya pedido una acción concreta. Nunca inventes que una acción se ejecutó.\n\nMensaje del usuario:\n" : "";
      runAI(guide+userMessage,"auto").then(sendResponse,error=>sendResponse({ok:false,error:error?.message||String(error)}));
    });return true;
  }
  if (message?.type === "QBIT_DESKTOP_ARTIFACT") {
    if(!QBIT_WEB_ORIGINS.includes(sender?.origin)||!sender?.tab?.id){sendResponse({ok:false,error:"Origen de QBIT no autorizado."});return false;}
    chrome.storage.local.get({qbitDesktopControlEnabled:false},s=>{
      if(!s.qbitDesktopControlEnabled){sendResponse({ok:false,error:"Activá Control PC en QBIT Web para ejecutar Artifacts."});return;}
      if(!socket||socket.readyState!==WebSocket.OPEN){sendResponse({ok:false,error:"QBIT Desktop no está conectado. Abrí QBIT Desktop y verificá la extensión."});return;}
      const id=crypto.randomUUID();const timer=setTimeout(()=>{waiting.delete(id);sendResponse({ok:false,error:"QBIT Desktop tardó demasiado en responder."});},125000);
      waiting.set(id,{resolve:r=>sendResponse({ok:!!r.ok,result:String(r.result||""),error:r.error||""}),reject:e=>sendResponse({ok:false,error:e?.message||String(e)}),timer});
      try{socket.send(JSON.stringify({type:"web_artifact_request",id,call:message.call}));}catch(error){clearTimeout(timer);waiting.delete(id);sendResponse({ok:false,error:error?.message||String(error)});}
    });return true;
  }
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
  const tabs = await chrome.tabs.query({ url: QBIT_WEB_URLS });
  const tab = tabs[0];
  if (tab?.id) await chrome.tabs.update(tab.id, { active: true });
  else await chrome.tabs.create({ url: "https://gotti23b.github.io/QBIT/" });
});

connectConsole();
chrome.runtime.onStartup.addListener(connectConsole);
setInterval(() => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ping" })); else connectConsole(); }, 20000);
