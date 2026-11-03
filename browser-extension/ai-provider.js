(() => {
  const log = (...args) => console.log("[QBIT]", ...args);
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  // ── Tabla de proveedores ──────────────────────────────────────────────────
  // Cada dato es una LISTA de selectores. Se prueban en orden y se usa el primero que encuentre algo:
  // si un sitio cambia su diseño y el primero falla, el segundo o el tercero pueden salvar la situación.
  //   hosts   → sitios donde corre (si no coincide, el script no hace nada)
  //   editor  → cuadro donde se escribe el mensaje
  //   reply   → cada mensaje de la IA        content → la parte con el texto dentro del mensaje
  //   send    → botón de enviar              stop    → botón de parar (solo si es seguro y específico)
  //   arrange → ordena la lista de respuestas (para que la última quede al final)
  const PROVIDERS = {
    "ChatGPT": {
      hosts: ["chatgpt.com", "chat.openai.com"],
      editor: ['#prompt-textarea', 'div.ProseMirror[contenteditable="true"]'],
      reply: ['[data-message-author-role="assistant"]', '[data-turn="assistant"]'],
      content: ['.markdown', '[class*="markdown"]'],
      send: ['#composer-submit-button', 'button[data-testid="send-button"]', 'button[aria-label*="Send prompt"]', 'button[aria-label*="Enviar"]'],
      stop: ['button[data-testid="stop-button"]', 'button[aria-label="Stop streaming"]']
    },
    "Arena.ai": {
      hosts: ["arena.ai"],
      editor: ["form textarea"],
      reply: ["ol.flex-col-reverse > div .prose"],
      send: ['button[aria-label*="Send message"]', 'button[aria-label*="Enviar"]'],
      stop: [],
      arrange: nodes => nodes.filter(node => !node.closest(".justify-end")).reverse()
    },
    "Gemini": {
      hosts: ["gemini.google.com"],
      editor: ['rich-textarea [contenteditable="true"]', '[contenteditable="true"].ql-editor'],
      reply: ["model-response message-content", "model-response .model-response-text"],
      send: ['button[aria-label*="Send"]', 'button[aria-label*="Enviar"]'],
      stop: []
    },
    "Claude": {
      hosts: ["claude.ai"],
      editor: ['[contenteditable="true"].ProseMirror', 'div[contenteditable="true"][role="textbox"]'],
      reply: ['.font-claude-response', '.font-claude-message', '[data-is-streaming] .standard-markdown', '[data-is-streaming]'],
      send: ['button[aria-label*="Send"]', 'button[aria-label*="send"]', 'button[aria-label*="Enviar"]', 'button[aria-label*="enviar"]'],
      stop: []
    },
    "DeepSeek": {
      hosts: ["chat.deepseek.com"],
      editor: ["textarea"],
      reply: ['[data-message="assistant"]', ".ds-markdown"],
      send: ['button[aria-label*="Send"]', 'button[aria-label*="Enviar"]', 'button[aria-label*="发送"]', 'div[role="button"].ds-button--primary'],
      stop: []
    },
    "Qwen": {
      hosts: ["chat.qwen.ai"],
      editor: ["textarea.message-input-textarea", "textarea"],
      reply: [".message-content-container .markdown-body", ".qwen-chat-message-assistant .markdown-body"],
      send: [".chat-prompt-send-button", 'button[aria-label*="Send"]'],
      stop: []
    },
    "Meta AI": {
      hosts: ["meta.ai"],
      editor: ["textarea"],
      reply: ['[data-testid*="assistant"]', '[data-message-author-role="assistant"]'],
      send: ['button[aria-label*="Send"]', 'button[aria-label*="Enviar"]'],
      stop: []
    }
  };
  // Botones de parar genéricos (por texto). Se ignoran si están en menús, cabeceras o diálogos.
  const LOOSE_STOP = ['button[aria-label*="Stop"]', 'button[aria-label*="stop"]', 'button[aria-label*="Detener"]', 'button[aria-label*="detener"]', 'button[aria-label*="停止"]'];

  const provider = Object.keys(PROVIDERS).find(name =>
    PROVIDERS[name].hosts.some(h => location.hostname === h || location.hostname.endsWith("." + h)));
  if (!provider) { log("Sitio no reconocido, no hago nada:", location.hostname); return; }
  const cfg = PROVIDERS[provider];

  // ── Buscar elementos ──────────────────────────────────────────────────────
  const isVisible = el => !!(el && el.getClientRects().length);
  const warned = new Set();
  function queryAll(selector, root = document) {
    try { return [...root.querySelectorAll(selector)]; } catch { return []; }
  }
  function noteFallback(kind, index, selector) {
    if (index > 0 && !warned.has(kind)) { warned.add(kind); log(`${provider}: el selector principal de "${kind}" no encontró nada; uso el de respaldo #${index + 1}:`, selector); }
  }
  // Primer selector de la lista que encuentre algo.
  function findAll(kind) {
    const list = cfg[kind] || [];
    for (let i = 0; i < list.length; i++) {
      const found = queryAll(list[i]);
      if (found.length) { noteFallback(kind, i, list[i]); return found; }
    }
    return [];
  }
  // Todo lo que coincida con cualquier selector de la lista, sin repetidos.
  function findEvery(kind) {
    return [...new Set((cfg[kind] || []).flatMap(selector => queryAll(selector)))];
  }
  // Primer elemento VISIBLE de la lista (evita agarrar cajas ocultas).
  function findFirstVisible(kind) {
    const list = cfg[kind] || [];
    for (let i = 0; i < list.length; i++) {
      const found = queryAll(list[i]).find(isVisible);
      if (found) { noteFallback(kind, i, list[i]); return found; }
    }
    return null;
  }

  function getReplies() {
    let nodes = findAll("reply").filter(node => !node.closest('[data-testid="user-message"], [data-message-author-role="user"]'));
    // Si un selector coincide con un elemento y también con su hijo, nos quedamos con el de afuera.
    nodes = nodes.filter(node => !nodes.some(other => other !== node && other.contains(node)));
    return cfg.arrange ? cfg.arrange(nodes) : nodes;
  }
  // La parte del mensaje que tiene el texto (ej.: el bloque .markdown de ChatGPT).
  function contentOf(node) {
    if (!node) return node;
    for (const selector of cfg.content || []) {
      try { const inner = node.querySelector(selector); if (inner) return inner; } catch {}
    }
    return node;
  }
  const textOf = node => (node?.innerText || node?.textContent || "").trim();
  function replyText() { return textOf(contentOf(getReplies().at(-1))); }

  // ── Diagnóstico ───────────────────────────────────────────────────────────
  // Cuenta cuántos elementos encuentra cada selector. Si algo da 0, ahí se rompió el sitio.
  function diagnose() {
    const rows = {};
    for (const kind of ["editor", "reply", "send", "stop"]) {
      const list = cfg[kind] || [];
      const hits = list.map(selector => queryAll(selector).length);
      rows[kind] = { selectores: list.length, funciona: hits.findIndex(n => n > 0) + 1 || "ninguno", coincidencias: hits.join(" / ") || "-" };
    }
    return { provider, host: location.hostname, rows };
  }
  function diagSummary() {
    const { rows } = diagnose();
    return Object.entries(rows).map(([kind, row]) => `${kind}=${row.funciona}`).join(", ");
  }

  // ── Escribir el mensaje ───────────────────────────────────────────────────
  // Sin focus(): en una pestaña inactiva puede traer el chat de IA al frente.
  const emptyParagraph = () => { const p = document.createElement("p"); p.append(document.createElement("br")); return p; };
  function writeParagraphs(editor, text) {
    // Un <p> por línea: así se conservan los saltos de línea (textContent los pierde).
    const paragraphs = String(text).split("\n").map(line => {
      if (!line) return emptyParagraph();
      const p = document.createElement("p");
      p.textContent = line;
      return p;
    });
    editor.replaceChildren(...paragraphs);
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: String(text) }));
  }
  function writePaste(editor, text) {
    // Plan B: simular un pegado. Los editores tipo ProseMirror lo entienden sin necesitar foco.
    editor.replaceChildren(emptyParagraph());
    const data = new DataTransfer();
    data.setData("text/plain", String(text));
    editor.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }
  function setEditor(editor, text) {
    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
      const proto = editor instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (!setter) throw new Error("No pude escribir en el cuadro de mensaje.");
      setter.call(editor, String(text));
      editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: String(text) }));
      editor.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      writeParagraphs(editor, text);
    }
  }

  // ── Respuesta completa ────────────────────────────────────────────────────
  // Convierte el HTML de la respuesta en texto tipo Markdown: párrafos, listas,
  // títulos, tablas y bloques de código con ```lenguaje … ```.
  const SKIP = new Set(["BUTTON", "SVG", "STYLE", "SCRIPT", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT"]);
  const BLOCK = new Set(["P", "DIV", "SECTION", "ARTICLE", "BLOCKQUOTE", "TABLE", "UL", "OL", "HR", "FIGURE"]);

  function codeLanguage(pre) {
    const code = pre.querySelector("code") || pre;
    const fromClass = [...code.classList, ...pre.classList].join(" ").match(/(?:language|lang)-([\w#+.-]+)/i);
    if (fromClass) return fromClass[1].toLowerCase();
    const attr = pre.getAttribute("data-language") || code.getAttribute("data-language");
    return attr ? attr.toLowerCase() : "";
  }

  function codeText(pre) {
    // Algunos sitios (ChatGPT) dibujan el código con un editor: una línea por div.
    const lines = pre.querySelectorAll(".cm-line");
    if (lines.length) return [...lines].map(l => l.textContent).join("\n");
    const code = pre.querySelector("code") || pre;
    return (code.innerText || code.textContent || "").replace(/\n$/, "");
  }

  // Si el sitio tiene botón "Copiar" en el bloque, lo usamos: devuelve el código
  // entero aunque la página no lo muestre completo. Si falla, usamos lo que se ve.
  async function codeViaCopyButton(pre) {
    const scope = pre.closest("pre")?.parentElement || pre.parentElement || pre;
    const button = [...scope.querySelectorAll("button")].find(b => /cop/i.test((b.getAttribute("aria-label") || "") + " " + (b.innerText || "")));
    if (!button || !navigator.clipboard?.readText) return null;
    try {
      button.click();
      await sleep(200);
      const copied = await navigator.clipboard.readText();
      return copied && copied.trim() ? copied.replace(/\n$/, "") : null;
    } catch { return null; }
  }

  async function domToText(root) {
    const out = [];
    const nl = (n = 1) => out.push("\n".repeat(n));
    async function walk(node, listDepth = 0) {
      if (node.nodeType === Node.TEXT_NODE) { out.push(node.textContent); return; }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const tag = node.tagName.toUpperCase();
      if (SKIP.has(tag) || node.getAttribute("aria-hidden") === "true" && !node.querySelector("pre, code")) return;
      if (tag === "PRE") {
        const visible = codeText(node);
        const looksCut = node.querySelector(".cm-line") && visible.length > 1500;
        const full = looksCut ? (await codeViaCopyButton(node)) : null;
        nl(2); out.push("```" + codeLanguage(node) + "\n" + (full || visible) + "\n```"); nl(2);
        return;
      }
      if (tag === "BR") { nl(); return; }
      if (tag === "CODE") { out.push("`" + node.textContent + "`"); return; }
      if (/^H[1-6]$/.test(tag)) { nl(2); out.push("#".repeat(Number(tag[1])) + " "); for (const c of node.childNodes) await walk(c, listDepth); nl(2); return; }
      if (tag === "LI") {
        const parent = node.parentElement;
        const ordered = parent?.tagName === "OL";
        const index = ordered ? [...parent.children].indexOf(node) + Number(parent.getAttribute("start") || 1) : 0;
        nl(); out.push("  ".repeat(Math.max(0, listDepth - 1)) + (ordered ? index + ". " : "- "));
        for (const c of node.childNodes) await walk(c, listDepth);
        return;
      }
      if (tag === "UL" || tag === "OL") { nl(); for (const c of node.childNodes) await walk(c, listDepth + 1); nl(2); return; }
      if (tag === "TR") { nl(); out.push("| " + [...node.children].map(td => td.innerText.trim()).join(" | ") + " |"); return; }
      if (tag === "HR") { nl(2); out.push("---"); nl(2); return; }
      const block = BLOCK.has(tag);
      if (block) nl(tag === "P" ? 2 : 1);
      for (const c of node.childNodes) await walk(c, listDepth);
      if (block) nl(tag === "P" ? 2 : 1);
    }
    await walk(root);
    return out.join("")
      .replace(/[ \t]+\n/g, "\n")
      // Encabezados que algunos sitios ponen arriba de cada bloque (Gemini: "Fragmento de código").
      .replace(/^(?:Fragmento de código|Code snippet|Copiar código|Copy code)\s*$/gim, "")
      .replace(/\n{3,}/g, "\n\n").trim();
  }

  async function fullAnswer(content) {
    if (!content) return "";
    try { return await domToText(content); }
    catch (error) { log("No pude armar la respuesta completa, uso el texto simple:", error); return (content.innerText || "").trim(); }
  }
  function isGenerating() {
    if (document.querySelector('[data-is-streaming="true"]')) return true;
    if ((cfg.stop || []).some(selector => queryAll(selector).some(isVisible))) return true;
    return LOOSE_STOP.some(selector => queryAll(selector).some(button =>
      isVisible(button) && !button.closest('nav, header, aside, [role="dialog"], [role="menu"]')));
  }
  function editorText(editor) {
    return (editor.value ?? editor.innerText ?? "").trim();
  }
  // Consideramos "enviado" si el cuadro se vació, apareció una burbuja nueva o la IA empezó a generar.
  async function waitSent(editor, previousCount, ms = 2500) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      const current = findFirstVisible("editor") || editor;
      if (!editorText(current) || isGenerating() || getReplies().length > previousCount) return true;
      await sleep(150);
    }
    return false;
  }
  const findSendButton = () => findEvery("send")
    .find(button => isVisible(button) && !button.disabled && button.getAttribute("aria-disabled") !== "true");
  async function waitSendButton(ms) {
    const started = Date.now();
    let send = findSendButton();
    while (!send && Date.now() - started < ms) { await sleep(100); send = findSendButton(); }
    return send;
  }
  async function ask(message) {
    // La pestaña puede estar recargándose (Chrome la "duerme" si no la usás): esperamos el cuadro hasta 15 s.
    let editor = findFirstVisible("editor");
    const editorWait = Date.now();
    while (!editor && Date.now() - editorWait < 15000) { await sleep(300); editor = findFirstVisible("editor"); }
    if (!editor) throw new Error(`No encuentro el cuadro de mensaje de ${provider}. Recargá esa pestaña. (diagnóstico: ${diagSummary()})`);
    const idleStarted = Date.now();
    while (isGenerating() && Date.now() - idleStarted < 120000) await sleep(500);
    if (isGenerating()) throw new Error(`${provider} todavía está respondiendo otro mensaje.`);
    const previous = replyText();
    const previousCount = getReplies().length;
    log("Respuestas antes de enviar:", previousCount, "| diagnóstico:", diagSummary());
    setEditor(editor, message);
    await sleep(250);
    let send = await waitSendButton(4000);
    // Si el botón de enviar no se activó, el sitio no tomó el texto: probamos el plan B (pegado simulado).
    if (!send && !(editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement)) {
      log("El botón de enviar sigue apagado; pruebo pegar el texto.");
      writePaste(editor, message);
      await sleep(300);
      send = await waitSendButton(4000);
    }
    // Probamos varias formas de enviar y verificamos que de verdad se haya mandado.
    const attempts = [
      () => { if (send) send.click(); else return false; },
      () => { const b = findSendButton() || editor.closest("form")?.querySelector('button[type="submit"]:not([disabled])'); if (b) b.click(); else return false; },
      () => { const form = editor.closest("form"); if (form?.requestSubmit) form.requestSubmit(); else return false; },
      () => {
        // Último botón habilitado cerca del cuadro de texto; no usamos Enter
        // porque requiere enfocar el editor y puede activar la pestaña.
        let box = editor.parentElement;
        for (let i = 0; i < 5 && box; i++, box = box.parentElement) {
          const buttons = [...box.querySelectorAll('button:not([disabled]):not([aria-disabled="true"])')].filter(b => b.getClientRects().length && !/adjunt|attach|micr|voz|voice|model|herram|tool/i.test((b.getAttribute("aria-label") || "") + (b.innerText || "")));
          if (buttons.length) { buttons.at(-1).click(); return; }
        }
        return false;
      }
    ];
    let sent = false;
    for (const attempt of attempts) {
      if (attempt() === false) continue;
      if (await waitSent(editor, previousCount)) { sent = true; break; }
    }
    if (!sent) throw new Error(`Escribí el mensaje en ${provider} pero no pude enviarlo. Dejá esa pestaña visible e intentá de nuevo. (diagnóstico: ${diagSummary()})`);

    const startedAt = Date.now();
    let answer = "";
    let changedAt = 0;
    let generationObserved = false;
    let lastLog = 0;
    while (Date.now() - startedAt < 120000) {
      await sleep(350);
      const nodes = getReplies();
      const content = contentOf(nodes.at(-1));
      const current = textOf(content);
      if (isGenerating()) generationObserved = true;
      if (Date.now() - lastLog > 3000) { lastLog = Date.now(); log("Esperando… respuestas:", nodes.length, "| generando:", isGenerating(), "| texto:", current.slice(0, 60)); }
      if (current && (current !== previous || nodes.length > previousCount)) {
        if (current !== answer) { answer = current; changedAt = Date.now(); }
        if (!isGenerating() && Date.now() - changedAt >= 1400 && (generationObserved || Date.now() - startedAt >= 2500)) {
          const full = await fullAnswer(content);
          log("Respuesta lista (" + full.length + " caracteres). Devolviendo a QBIT.");
          return { ok: true, answer: full || answer, provider };
        }
      }
    }
    // Si leímos algo aunque no terminó del todo, mejor devolverlo que perderlo.
    if (answer) {
      log("Tiempo agotado, devuelvo lo que había.");
      const content = contentOf(getReplies().at(-1));
      return { ok: true, answer: (await fullAnswer(content)) || answer, provider };
    }
    throw new Error(`No encontré la respuesta de ${provider} en la página. Puede que ${provider} haya cambiado su diseño (diagnóstico: ${diagSummary()}).`);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "QBIT_AI_DIAGNOSE") { sendResponse(diagnose()); return; }
    if (message?.type !== "QBIT_AI_PROMPT") return;
    log("Extensión v" + chrome.runtime.getManifest().version + " · Mensaje recibido de QBIT:", String(message.message || "").slice(0, 80));
    ask(String(message.message || "").slice(0, 12000))
      .then(sendResponse, error => sendResponse({ ok: false, error: error?.message || String(error), provider }));
    return true;
  });

  // Si a los pocos segundos no aparece el cuadro de mensaje, dejamos el diagnóstico en la consola de la pestaña.
  setTimeout(() => { if (!findFirstVisible("editor")) { log("No veo el cuadro de mensaje todavía. Diagnóstico:"); console.table(diagnose().rows); } }, 6000);
})();
