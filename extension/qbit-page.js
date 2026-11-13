(() => {
  const fallbackStart = "Todavía no tengo una respuesta para eso.";
  const seen = new WeakSet();
  let desktopControlEnabled=false,desktopConnected=false;
  function publishDesktopStatus(){window.postMessage({source:"QBIT_EXTENSION",type:"DESKTOP_CONTROL_STATUS",enabled:desktopControlEnabled,connected:desktopConnected},location.origin);}
  chrome.runtime.sendMessage({type:"QBIT_DESKTOP_CONTROL_STATUS"}).then(s=>{desktopControlEnabled=!!s?.enabled;desktopConnected=!!s?.connected;publishDesktopStatus();}).catch(()=>publishDesktopStatus());
  window.addEventListener("message",event=>{
    if(event.source!==window||event.origin!==location.origin||event.data?.source!=="QBIT_WEB"||event.data?.type!=="DESKTOP_CONTROL_TOGGLE")return;
    desktopControlEnabled=!!event.data.enabled;
    chrome.runtime.sendMessage({type:"QBIT_DESKTOP_CONTROL_SET",enabled:desktopControlEnabled}).then(s=>{desktopConnected=!!s?.connected;publishDesktopStatus();}).catch(()=>{desktopConnected=false;publishDesktopStatus();});
  });
  async function processAIAnswer(answer){
    const original=String(answer||"");if(!desktopControlEnabled)return original;
    const calls=[];
    const clean=original.replace(/\x60{3}([\w#+.-]*)[ \t]*\n([\s\S]*?)\x60{3}/g,(whole,lang,body)=>{
      const raw=body.trim();let parsed=null;try{parsed=JSON.parse(raw);}catch{}
      if(lang.toLowerCase()==="qbit"||(parsed&&typeof parsed==="object"&&parsed.artifact)){if(parsed&&typeof parsed==="object"&&parsed.artifact)calls.push(parsed);return "";}
      return whole;
    }).replace(/\n{3,}/g,"\n\n").trim();
    if(!calls.length)return original;
    const results=[];
    for(const call of calls.slice(0,3)){
      try{const r=await chrome.runtime.sendMessage({type:"QBIT_DESKTOP_ARTIFACT",call});results.push(r?.ok?"🖥️ "+String(r.result||"Artifact ejecutado."):"⚠️ "+String(r?.error||"No se pudo ejecutar el Artifact."));}
      catch(error){results.push("⚠️ "+(error?.message||"No se pudo conectar con QBIT Desktop."));}
    }
    return [clean,...results].filter(Boolean).join("\n\n");
  }

  function hideLocalAI() {
    document.querySelectorAll('a[href*="local-ai.html"], .local-ai-link, .agent-tools, #agentStatus').forEach(node => node.remove());
  }

  function installConsoleButton() {
    document.getElementById("qbitConsoleConnect")?.remove();
  }

  function updateConsoleButton() {
    document.getElementById("qbitConsoleConnect")?.remove();
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

    chrome.runtime.sendMessage({ type: "QBIT_WEB_AI_PROMPT", message })
      .then(async result => {
        const rawAnswer = result?.ok ? String(result.answer || "").trim() : "No pude consultar la IA: " + (result?.error || "error desconocido");
        const answer = result?.ok ? await processAIAnswer(rawAnswer) : rawAnswer;
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
    if (message?.type === "QBIT_CONSOLE_STATUS_CHANGED") { updateConsoleButton(message.connected); desktopConnected=!!message.connected; publishDesktopStatus(); }
  });

  if (location.pathname.includes("local-ai.html")) location.replace("https://gotti23b.github.io/QBIT/");
  new MutationObserver(observe).observe(document.documentElement, { childList: true, subtree: true });
  observe();
})();
