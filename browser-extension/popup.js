// Popup de QBIT Extension: conectar/desconectar y elegir proveedor.
const statusEl = document.getElementById("status");
const providerEl = document.getElementById("provider");

// Texto del <option> -> clave que entiende background.js (PROVIDERS)
const KEYS = { "ChatGPT": "chatgpt", "Gemini": "gemini", "Claude": "claude", "DeepSeek": "deepseek", "Qwen": "qwen", "Arena": "arena", "Meta AI": "meta" };

function showStatus(connected) {
  statusEl.textContent = connected ? "Conectada a QBIT" : "Desconectada (abrí QBIT y tocá Conectar)";
  statusEl.classList.toggle("ok", !!connected);
}

async function refresh() {
  try {
    const res = await chrome.runtime.sendMessage({ type: "QBIT_CONNECTOR_CONTROL", action: "status" });
    showStatus(res?.connected);
  } catch { showStatus(false); }
}

document.getElementById("connect").addEventListener("click", async () => {
  statusEl.textContent = "Conectando…";
  await chrome.runtime.sendMessage({ type: "QBIT_CONNECTOR_CONTROL", action: "connect" }).catch(() => {});
  setTimeout(refresh, 1200);
});

document.getElementById("disconnect").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "QBIT_CONNECTOR_CONTROL", action: "disconnect" }).catch(() => {});
  refresh();
});

chrome.storage.local.get({ provider: "auto" }, ({ provider }) => {
  const option = [...providerEl.options].find(o => (KEYS[o.value] || o.value) === provider);
  if (option) providerEl.value = option.value;
});

providerEl.addEventListener("change", () => {
  const value = providerEl.value;
  chrome.storage.local.set({ provider: KEYS[value] || "auto" });
});

refresh();
