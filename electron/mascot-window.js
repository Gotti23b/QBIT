(() => {
  const api = window.qbitPet;
  const button = document.getElementById("petButton");
  const panel = document.getElementById("petPanel");
  const close = document.getElementById("closePanel");
  const greeting = document.getElementById("petGreeting");
  const stateLabel = document.getElementById("petStateLabel");
  const form = document.getElementById("petForm");
  const input = document.getElementById("petInput");
  const stateNames = { idle: "tranqui", working: "trabajando", resting: "descansando" };
  let expanded = false;
  let busyTimer = null;
  let dragStart = null;
  let dragging = false;

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

  form.addEventListener("submit", event => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    greeting.textContent = "Te leí: “" + text + "”\n\nTodavía estoy conectando mi chat real, pero ya estoy instalada en el escritorio. 💠";
    setState("working");
    busyTimer = window.setTimeout(() => setState("idle"), 1600);
  });

  if (api?.onPetToggle) api.onPetToggle(() => { void setExpanded(!expanded); });
  if (api?.onPetState) api.onPetState(state => setState(state));
  setState("idle");
})();