(() => {
  const api = window.qbitPet;
  const button = document.getElementById("petButton");
  const panel = document.getElementById("petPanel");
  const close = document.getElementById("closePanel");
  const greeting = document.getElementById("petGreeting");
  const stateLabel = document.getElementById("petStateLabel");
  const form = document.getElementById("petForm");
  const input = document.getElementById("petInput");
  const sendButton = form.querySelector('button[type="submit"]');
  const voiceOutputButton = document.getElementById("petVoiceOutput");
  const voiceInputButton = document.getElementById("petVoiceInput");
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let speechRecognition = null;
  let voiceOutputEnabled = localStorage.getItem("qbit-voice-output") === "true";
  let availableSpeechVoices = [];
  const selectedVoiceKey = "qbit-speech-voice";
  let selectedVoiceId = localStorage.getItem(selectedVoiceKey) || "";
  function voiceRecognitionErrorMessage(code) {
    const messages = {
      "not-allowed": "El navegador bloqueó el micrófono. Permití el acceso al micrófono para QBIT desde los permisos del sitio.",
      "service-not-allowed": "El navegador no permite usar el servicio de reconocimiento de voz. Revisá los permisos del sitio o probá Chrome/Edge.",
      "audio-capture": "No pude acceder al micrófono. Comprobá que esté conectado y que ninguna otra aplicación lo esté usando.",
      "network": "El servicio de reconocimiento de voz no respondió. Revisá tu conexión a internet e intentá de nuevo.",
      "no-speech": "No detecté voz. Tocá Hablarle y empezá a hablar cuando aparezca «Escuchando…».",
      "language-not-supported": "Este navegador no admite español (Argentina) para el reconocimiento de voz."
    };
    return messages[code] || ("Falló el reconocimiento de voz (" + String(code || "error desconocido") + "). Probá de nuevo.");
  }
  let sending = false;
  const stateNames = { idle: "tranqui", working: "trabajando", resting: "descansando" };
  let expanded = false;
  let busyTimer = null;
  let dragStart = null;
  let dragging = false;
  function applySettings(settings) {
    if (!settings || typeof settings !== "object") return;
    const scale = settings.size === "small" ? 0.8 : settings.size === "large" ? 1.2 : 1;
    // El tamaño de la ventana ya se escala desde Electron. Aplicar zoom acá
    // duplicaba el escalado y hacía que el panel se cortara.
    document.documentElement.classList.toggle("no-animations", settings.animations === false);
  }

  async function setExpanded(next) {
    expanded = Boolean(next);
    panel.hidden = !expanded;
    button.setAttribute("aria-expanded", String(expanded));
    button.setAttribute("aria-label", expanded ? "Minimizar panel de QBIT" : "Abrir panel de QBIT");
    if (api?.resizePet) {
      try { await api.resizePet(expanded); } catch (error) { console.error("No se pudo ajustar la ventana de la mascota", error); }
    }
    if (expanded) input.focus({ preventScroll: true });
  }

  function speakReply(text) {
    if (!voiceOutputEnabled || !("speechSynthesis" in window)) return;
    const clean = String(text || "").replace(/\s+/g, " ").trim().slice(0, 3500);
    if (!clean) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.lang = "es-AR";
    const selectedVoice = availableSpeechVoices.find(voice => voice.voiceURI === selectedVoiceId || voice.name === selectedVoiceId);
    if (selectedVoice) utterance.voice = selectedVoice;
    utterance.rate = 1;
    window.speechSynthesis.speak(utterance);
  }
  const voiceSelector = document.getElementById("petVoiceSelector");
  function renderVoiceSelector() {
    if (!voiceSelector) return;
    const previous = selectedVoiceId;
    voiceSelector.replaceChildren();
    const automatic = document.createElement("option");
    automatic.value = "";
    automatic.textContent = "Voz automática";
    voiceSelector.append(automatic);
    availableSpeechVoices.forEach(voice => {
      const option = document.createElement("option");
      option.value = voice.voiceURI || voice.name;
      option.textContent = voice.name + " · " + (voice.lang || "idioma desconocido") + (voice.default ? " · predeterminada" : "");
      voiceSelector.append(option);
    });
    voiceSelector.value = availableSpeechVoices.some(voice => (voice.voiceURI || voice.name) === previous) ? previous : "";
    if (voiceSelector.value !== previous) { selectedVoiceId = ""; try { localStorage.removeItem(selectedVoiceKey); } catch {} }
    voiceSelector.disabled = availableSpeechVoices.length === 0;
    voiceSelector.title = availableSpeechVoices.length ? "Elegí la voz de la mascota" : "El sistema todavía no informó voces disponibles";
  }
  function loadSpeechVoices() {
    if (!("speechSynthesis" in window)) return;
    availableSpeechVoices = window.speechSynthesis.getVoices();
    renderVoiceSelector();
  }
  function renderVoiceButtons() {
    voiceOutputButton.textContent = voiceOutputEnabled ? "🔊 Voz ON" : "🔊 Voz OFF";
    voiceOutputButton.setAttribute("aria-pressed", String(voiceOutputEnabled));
    voiceInputButton.disabled = !SpeechRecognition;
    voiceInputButton.title = SpeechRecognition ? "Dictar un mensaje puntual a QBIT" : "Este sistema no admite dictado por voz";
    renderVoiceSelector();
  }
  voiceSelector?.addEventListener("change", event => {
    selectedVoiceId = event.target.value;
    try { if (selectedVoiceId) localStorage.setItem(selectedVoiceKey, selectedVoiceId); else localStorage.removeItem(selectedVoiceKey); } catch {}
  });
  if ("speechSynthesis" in window) {
    loadSpeechVoices();
    window.speechSynthesis.addEventListener?.("voiceschanged", loadSpeechVoices);
    setTimeout(loadSpeechVoices, 500);
  }
  voiceOutputButton.addEventListener("click", () => {
    voiceOutputEnabled = !voiceOutputEnabled;
    try { localStorage.setItem("qbit-voice-output", String(voiceOutputEnabled)); } catch {}
    if (!voiceOutputEnabled && "speechSynthesis" in window) window.speechSynthesis.cancel();
    renderVoiceButtons();
  });
  voiceInputButton.addEventListener("click", () => {
    if (!SpeechRecognition) { greeting.textContent = "Este sistema no admite dictado por voz. Probá con Windows actualizado."; return; }
    if (speechRecognition) { speechRecognition.abort(); speechRecognition = null; }
    const recognition = new SpeechRecognition();
    speechRecognition = recognition;
    recognition.lang = "es-AR";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    voiceInputButton.textContent = "🎙️ Escuchando…";
    voiceInputButton.disabled = true;
    greeting.textContent = "Te escucho. Decí tu mensaje y lo envío una sola vez. 🎤";
    recognition.onresult = event => {
      const transcript = String(event.results?.[0]?.[0]?.transcript || "").trim();
      if (transcript) { input.value = transcript; form.requestSubmit(); }
    };
    recognition.onerror = event => {
      if (event.error !== "aborted") greeting.textContent = voiceRecognitionErrorMessage(event.error);
    };
    recognition.onnomatch = () => { greeting.textContent = voiceRecognitionErrorMessage("no-speech"); };
    recognition.onend = () => {
      if (speechRecognition === recognition) speechRecognition = null;
      voiceInputButton.textContent = "🎤 Hablarle";
      voiceInputButton.disabled = !SpeechRecognition;
    };
    try { recognition.start(); } catch (error) {
      speechRecognition = null;
      voiceInputButton.textContent = "🎤 Hablarle";
      voiceInputButton.disabled = !SpeechRecognition;
      greeting.textContent = voiceRecognitionErrorMessage(error?.name || "start-failed");
    }
  });
  renderVoiceButtons();

  function setState(state) {
    if (!stateNames[state]) return;
    button.dataset.state = state;
    stateLabel.textContent = "En línea · " + stateNames[state];
    document.querySelectorAll("[data-state]").forEach(item => item.setAttribute("aria-pressed", String(item.dataset.state === state)));
    if (busyTimer) { window.clearTimeout(busyTimer); busyTimer = null; }
  }

  button.addEventListener("pointerdown", async event => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    window.__petWasDragged = false;
    dragging = false;
    button.setPointerCapture?.(event.pointerId);
    const position = await api?.getPosition?.();
    if (!position) return;
    dragStart = { pointerX: event.screenX, pointerY: event.screenY, x: position.x, y: position.y };
  });
  button.addEventListener("pointermove", event => {
    if (!dragStart || !(event.buttons || event.pointerType === "touch")) return;
    const dx = event.screenX - dragStart.pointerX;
    const dy = event.screenY - dragStart.pointerY;
    if (Math.abs(dx) + Math.abs(dy) > 6) dragging = true;
    if (!dragging) return;
    window.__petWasDragged = true;
    void api?.moveTo?.(dragStart.x + dx, dragStart.y + dy);
  });
  const stopDragging = () => { dragStart = null; dragging = false; };
  button.addEventListener("pointerup", stopDragging);
  button.addEventListener("pointercancel", stopDragging);
  button.addEventListener("click", () => {
    if (window.__petWasDragged) { window.__petWasDragged = false; return; }
    void setExpanded(!expanded);
  });
  close.addEventListener("click", () => void setExpanded(false));

  document.querySelectorAll("[data-state]").forEach(item => item.addEventListener("click", () => {
    const state = item.dataset.state;
    setState(state);
    const messages = {
      idle: "Estoy acá, listo para darte una mano. 💠",
      working: "¡Modo trabajo activado! ⚙️",
      resting: "Bajé un cambio. Avisame cuando quieras seguir. 🌙"
    };
    greeting.textContent = messages[state];
  }));

  document.querySelectorAll("[data-action]").forEach(item => item.addEventListener("click", async () => {
    if (item.dataset.action === "open-main") {
      try { await api?.showMainWindow?.(); } catch (error) { greeting.textContent = "No pude abrir la ventana principal."; }
    } else {
      greeting.textContent = "¡Holaaa! 💙 ¿Qué hacemos hoy?";
      setState("idle");
    }
  }));

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || sending) return;
    sending = true;
    input.value = "";
    input.disabled = true;
    sendButton.disabled = true;
    greeting.textContent = "Te escucho… 💠";
    setState("working");
    try {
      const ok = await api?.sendMessage?.(text);
      if (!ok) throw new Error("No pude enviar el mensaje al chat oculto de QBIT.");
    } catch (error) {
      greeting.textContent = error?.message || "No pude conectar con QBIT. Intentá de nuevo.";
      sending = false;
      input.disabled = false;
      sendButton.disabled = false;
      setState("idle");
      input.focus({ preventScroll: true });
    }
  });

  if (api?.onPetSettings) api.onPetSettings(applySettings);
  if (api?.getSettings) api.getSettings().then(applySettings).catch(() => {});
  if (api?.onPetReply) api.onPetReply(reply => {
    greeting.textContent = String(reply);
    speakReply(reply);
    sending = false;
    input.disabled = false;
    sendButton.disabled = false;
    setState("idle");
    input.focus({ preventScroll: true });
  });
  if (api?.onPetToggle) api.onPetToggle(() => { void setExpanded(!expanded); });
  if (api?.onPetState) api.onPetState(state => setState(state));
  setState("idle");
})();