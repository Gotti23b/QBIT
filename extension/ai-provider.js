(() => {
  const host = location.hostname;
  const provider = host.includes("arena.ai") ? "Arena.ai" : host.includes("gemini") ? "Gemini" : host.includes("claude") ? "Claude" : host.includes("deepseek") ? "DeepSeek" : host.includes("qwen") ? "Qwen" : host.includes("meta.ai") ? "Meta AI" : "ChatGPT";
  const log = (...args) => console.log("[QBIT]", ...args);
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  const editors = {
    "ChatGPT": '#prompt-textarea, [contenteditable="true"].ProseMirror',
    "Arena.ai": "form textarea",
    "Gemini": 'rich-textarea [contenteditable="true"], [contenteditable="true"].ql-editor',
    "Claude": '[contenteditable="true"].ProseMirror, [contenteditable="true"]',
    "DeepSeek": "textarea",
    "Qwen": "textarea.message-input-textarea",
    "Meta AI": "textarea"
  };
  const replies = {
    "ChatGPT": '[data-message-author-role="assistant"] .markdown, [data-message-author-role="assistant"]',
    "Arena.ai": "ol.flex-col-reverse > div .prose",
    "Gemini": "model-response message-content, model-response .model-response-text",
    "Claude": '.font-claude-response, .font-claude-message, [data-is-streaming] .standard-markdown, [data-is-streaming]',
    "DeepSeek": '[data-message="assistant"], .ds-markdown',
    "Qwen": ".message-content-container .markdown-body, .qwen-chat-message-assistant .markdown-body",
    "Meta AI": '[data-testid*="assistant"], [data-message-author-role="assistant"]'
  };
  const sendButtons = {
    "ChatGPT": '#composer-submit-button, button[data-testid="send-button"]',
    "Arena.ai": 'button[aria-label*="Send message"], button[aria-label*="Enviar"]',
    "Gemini": 'button[aria-label*="Send"], button[aria-label*="Enviar"]',
    "Claude": 'button[aria-label*="Send"], button[aria-label*="send"], button[aria-label*="Enviar"], button[aria-label*="enviar"]',
    "DeepSeek": 'button[aria-label*="Send"], button[aria-label*="Enviar"], button[aria-label*="发送"], div[role="button"].ds-button--primary',
    "Qwen": '.chat-prompt-send-button, button[aria-label*="Send"]',
    "Meta AI": 'button[aria-label*="Send"], button[aria-label*="Enviar"]'
  };

  function getReplies() {
    // ChatGPT exposes both the assistant message and its nested markdown block.
    // Read only the outer message so one answer is never counted twice.
    if (provider === "ChatGPT") return [...document.querySelectorAll('[data-message-author-role="assistant"]')];
    let nodes = [...document.querySelectorAll(replies[provider])]
      .filter(node => !node.closest('[data-testid="user-message"], [data-message-author-role="user"]'));
    // Si un selector coincide con un elemento y también con su hijo, nos quedamos con el de afuera.
    nodes = nodes.filter(node => !nodes.some(other => other !== node && other.contains(node)));
    if (provider === "Arena.ai") return nodes.filter(node => !node.closest(".justify-end")).reverse();
    return nodes;
  }
  function replyText() {
    const nodes = getReplies();
    const last = nodes.at(-1);
    const content = provider === "ChatGPT" ? (last?.querySelector(".markdown") || last) : last;
    return (content?.innerText || content?.textContent || "").trim();
  }
  function setEditor(editor, text) {
    editor.focus();
    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
      const proto = editor instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (!setter) throw new Error("No pude escribir en el cuadro de mensaje.");
      setter.call(editor, String(text));
      editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: String(text) }));
      editor.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      editor.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand("delete");
      const lines = String(text).split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (lines[i]) document.execCommand("insertText", false, lines[i]);
        if (i < lines.length - 1) document.execCommand("insertLineBreak");
      }
      editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: String(text) }));
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
    return !!document.querySelector('button[data-testid="stop-button"], button[aria-label*="Stop"], button[aria-label*="stop"], button[aria-label*="Detener"], button[aria-label*="detener"]');
  }
  function editorText(editor) {
    return (editor.value ?? editor.innerText ?? "").trim();
  }
  // Consideramos "enviado" si el cuadro se vació, apareció una burbuja nueva o la IA empezó a generar.
  async function waitSent(editor, previousCount, ms = 2500) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      const current = document.querySelector(editors[provider]) || editor;
      if (!editorText(current) || isGenerating() || getReplies().length > previousCount) return true;
      await sleep(150);
    }
    return false;
  }
  function pressEnter(editor) {
    editor.focus();
    const init = { key: "Enter", code: "Enter", keyCode: 13, which: 13, charCode: 13, bubbles: true, cancelable: true, composed: true };
    editor.dispatchEvent(new KeyboardEvent("keydown", init));
    editor.dispatchEvent(new KeyboardEvent("keypress", init));
    editor.dispatchEvent(new KeyboardEvent("keyup", init));
  }
  async function ask(message) {
    // La pestaña puede estar recargándose (Chrome la "duerme" si no la usás): esperamos el cuadro hasta 15 s.
    let editor = document.querySelector(editors[provider]);
    const editorWait = Date.now();
    while (!editor && Date.now() - editorWait < 15000) { await sleep(300); editor = document.querySelector(editors[provider]); }
    if (!editor) throw new Error(`No encuentro el cuadro de mensaje de ${provider}. Recargá esa pestaña.`);
    const idleStarted = Date.now();
    while (isGenerating() && Date.now() - idleStarted < 120000) await sleep(500);
    if (isGenerating()) throw new Error(`${provider} todavía está respondiendo otro mensaje.`);
    const previous = replyText();
    const previousCount = getReplies().length;
    log("Respuestas antes de enviar:", previousCount, "| selector:", replies[provider]);
    setEditor(editor, message);
    await sleep(250);
    const readyStarted = Date.now();
    const findSendButton = () => [...document.querySelectorAll(sendButtons[provider])]
      .find(button => button && button.getClientRects().length && !button.disabled && button.getAttribute("aria-disabled") !== "true");
    let send = findSendButton();
    while (!send && Date.now() - readyStarted < 5000) {
      await sleep(100);
      send = findSendButton();
    }
    // Probamos varias formas de enviar y verificamos que de verdad se haya mandado.
    const attempts = [
      () => { if (send) send.click(); else return false; },
      () => { const b = findSendButton() || editor.closest("form")?.querySelector('button[type="submit"]:not([disabled])'); if (b) b.click(); else return false; },
      () => { const form = editor.closest("form"); if (form?.requestSubmit) form.requestSubmit(); else return false; },
      () => {
        // Último botón habilitado cerca del cuadro de texto (suele ser la flecha de enviar).
        let box = editor.parentElement;
        for (let i = 0; i < 5 && box; i++, box = box.parentElement) {
          const buttons = [...box.querySelectorAll('button:not([disabled]):not([aria-disabled="true"])')].filter(b => b.getClientRects().length && !/adjunt|attach|micr|voz|voice|model|herram|tool/i.test((b.getAttribute("aria-label") || "") + (b.innerText || "")));
          if (buttons.length) { buttons.at(-1).click(); return; }
        }
        return false;
      },
      () => pressEnter(editor)
    ];
    let sent = false;
    for (const attempt of attempts) {
      if (attempt() === false) continue;
      if (await waitSent(editor, previousCount)) { sent = true; break; }
    }
    if (!sent) throw new Error(`Escribí el mensaje en ${provider} pero no pude enviarlo. Dejá esa pestaña visible e intentá de nuevo.`);

    const startedAt = Date.now();
    let answer = "";
    let changedAt = 0;
    let generationObserved = false;
    let lastLog = 0;
    while (Date.now() - startedAt < 120000) {
      await sleep(350);
      const nodes = getReplies();
      const last = nodes.at(-1);
      const content = provider === "ChatGPT" ? (last?.querySelector(".markdown") || last) : last;
      const current = (content?.innerText || content?.textContent || "").trim();
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
      const last = getReplies().at(-1);
      const content = provider === "ChatGPT" ? (last?.querySelector(".markdown") || last) : last;
      return { ok: true, answer: (await fullAnswer(content)) || answer, provider };
    }
    throw new Error(`No encontré la respuesta de ${provider} en la página. Puede que ${provider} haya cambiado su diseño (selector: ${replies[provider]}).`);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "QBIT_AI_PROMPT") return;
    log("Extensión v" + chrome.runtime.getManifest().version + " · Mensaje recibido de QBIT:", String(message.message || "").slice(0, 80));
    ask(String(message.message || "").slice(0, 12000))
      .then(sendResponse, error => sendResponse({ ok: false, error: error?.message || String(error), provider }));
    return true;
  });
})();
