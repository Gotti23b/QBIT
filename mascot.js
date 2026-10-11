/* Prototipo independiente de la mascota QBIT; todavía no es el chat real. */
(() => {
  const root = document.createElement("div");
  root.id = "qbit-pet";
  root.innerHTML = `
    <section class="pet-panel" id="qbitPetPanel" aria-label="Panel de la mascota QBIT" hidden>
      <div class="pet-panel-head">
        <div><div class="pet-title">QBIT <span aria-hidden="true">✦</span></div><div class="pet-state-label" id="qbitPetState">Estado: tranqui</div></div>
        <button type="button" class="pet-close" id="qbitPetClose" aria-label="Cerrar panel">✕</button>
      </div>
      <p class="pet-message" id="qbitPetMessage">¡Buenas! Soy tu mascotita. Por ahora estoy en modo prototipo. 💠</p>
      <div class="pet-modes" aria-label="Probar animaciones">
        <button type="button" data-pet-state="idle" aria-pressed="true">Tranqui</button>
        <button type="button" data-pet-state="working" aria-pressed="false">Trabajando</button>
        <button type="button" data-pet-state="resting" aria-pressed="false">Descansando</button>
      </div>
      <form class="pet-form" id="qbitPetForm">
        <input class="pet-input" id="qbitPetInput" maxlength="160" placeholder="Decile algo a QBIT…" aria-label="Mensaje para la mascota">
        <button class="pet-send" type="submit">Enviar</button>
      </form>
      <p class="pet-note">Prototipo visual: todavía no está conectado al asistente.</p>
    </section>
    <button type="button" class="pet-toggle" id="qbitPetToggle" data-state="idle" aria-label="Abrir mascota QBIT" aria-expanded="false" title="Arrastrame o tocame">
      <span class="pet-face" aria-hidden="true"><span class="pet-eyes"><i></i><i></i></span><span class="pet-mouth"></span></span>
    </button>`;
  document.body.append(root);

  const toggle = root.querySelector("#qbitPetToggle");
  const panel = root.querySelector("#qbitPetPanel");
  const close = root.querySelector("#qbitPetClose");
  const stateLabel = root.querySelector("#qbitPetState");
  const message = root.querySelector("#qbitPetMessage");
  const input = root.querySelector("#qbitPetInput");
  const form = root.querySelector("#qbitPetForm");
  const stateNames = { idle: "tranqui", working: "trabajando", resting: "descansando" };
  let pointerStart = null;
  let dragged = false;

  function setState(state) {
    if (!stateNames[state]) return;
    toggle.dataset.state = state;
    stateLabel.textContent = "Estado: " + stateNames[state];
    root.querySelectorAll("[data-pet-state]").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.petState === state));
    });
  }
  function setOpen(open) {
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Cerrar panel de QBIT" : "Abrir mascota QBIT");
    if (open) input.focus({ preventScroll: true });
  }
  toggle.addEventListener("pointerdown", event => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    dragged = false;
    const rect = root.getBoundingClientRect();
    pointerStart = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
    toggle.setPointerCapture?.(event.pointerId);
  });
  toggle.addEventListener("pointermove", event => {
    if (!pointerStart || !(event.buttons || event.pointerType === "touch")) return;
    const dx = event.clientX - pointerStart.x;
    const dy = event.clientY - pointerStart.y;
    if (Math.abs(dx) + Math.abs(dy) > 7) dragged = true;
    if (!dragged) return;
    const left = Math.max(0, Math.min(window.innerWidth - root.offsetWidth, pointerStart.left + dx));
    const top = Math.max(0, Math.min(window.innerHeight - toggle.offsetHeight, pointerStart.top + dy));
    root.style.left = left + "px";
    root.style.top = top + "px";
    root.style.right = "auto";
    root.style.bottom = "auto";
  });
  toggle.addEventListener("pointerup", () => { pointerStart = null; });
  toggle.addEventListener("pointercancel", () => { pointerStart = null; });
  toggle.addEventListener("click", () => {
    if (dragged) { dragged = false; return; }
    setOpen(panel.hidden);
  });
  close.addEventListener("click", () => setOpen(false));
  root.querySelectorAll("[data-pet-state]").forEach(button => {
    button.addEventListener("click", () => {
      setState(button.dataset.petState);
      const messages = {
        idle: "¡Listo! Estoy tranqui, esperando que me necesites. 💠",
        working: "¡Modo trabajo activado! La animación es de prueba por ahora. ⚙️",
        resting: "Shhh… modo descanso. Avisame cuando quieras seguir. 🌙"
      };
      message.textContent = messages[button.dataset.petState];
    });
  });
  form.addEventListener("submit", event => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    message.textContent = "¡Te leí! 😄 Todavía soy un prototipo y no puedo responder de verdad: más adelante me conectamos al chat de QBIT.";
    input.value = "";
    setState("working");
    window.setTimeout(() => setState("idle"), 1400);
  });
})();