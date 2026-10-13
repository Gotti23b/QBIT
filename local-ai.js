import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2";

// The model weights are fetched from Hugging Face, not stored in this GitHub repo.
env.allowLocalModels = false;
env.useBrowserCache = true;

const $ = (id) => document.getElementById(id);
const status = $("modelStatus");
const chat = $("localChat");
const form = $("localForm");
const input = $("localInput");
const send = $("sendLocal");
const loadButton = $("loadModel");
let generator = null;
let loading = false;
let busy = false;
const messages = [];

function addBubble(who, text, kind = "bot") {
  const bubble = document.createElement("div");
  bubble.className = "bubble " + kind;
  const label = document.createElement("small");
  label.textContent = who;
  bubble.append(label, document.createTextNode(text));
  chat.append(bubble);
  chat.scrollTop = chat.scrollHeight;
  return bubble;
}

function setStatus(text, error = false) {
  status.textContent = text;
  status.className = error ? "notice error" : "notice";
}

async function loadModel() {
  if (generator || loading) return;
  loading = true;
  loadButton.disabled = true;
  setStatus("Descargando y preparando SmolLM2-135M-Instruct. La primera vez puede tardar y descargar bastantes MB…");
  try {
    generator = await pipeline(
      "text-generation",
      "onnx-community/SmolLM2-135M-Instruct",
      {
        dtype: "q4",
        device: "wasm",
        progress_callback: (p) => {
          if (p.status === "progress" && p.file) {
            const pct = Number.isFinite(p.progress) ? " (" + Math.round(p.progress) + "%)" : "";
            setStatus("Descargando " + p.file + pct + "…");
          } else if (p.status === "initiate" && p.file) {
            setStatus("Preparando " + p.file + "…");
          }
        }
      }
    );
    setStatus("¡Modelo cargado! Ya podés conversar sin créditos de API. 🩵");
    send.disabled = false;
    input.focus();
  } catch (error) {
    console.error(error);
    setStatus("No se pudo cargar el modelo: " + (error?.message || String(error)) + ". Revisá la conexión y volvé a intentar.", true);
    loadButton.disabled = false;
  } finally {
    loading = false;
  }
}

loadButton.addEventListener("click", loadModel);
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const prompt = input.value.trim();
  if (!prompt || !generator || busy) return;
  busy = true;
  send.disabled = true;
  input.disabled = true;
  addBubble("Vos", prompt, "user");
  input.value = "";
  const thinking = addBubble("QBIT · IA local", "Pensando…");
  try {
    const conversation = [
      { role: "system", content: "Sos QBIT, un asistente útil. Respondé en español rioplatense, con claridad y brevedad. Sos un modelo pequeño y podés equivocarte." },
      ...messages.slice(-8),
      { role: "user", content: prompt }
    ];
    const result = await generator(conversation, {
      max_new_tokens: 160,
      do_sample: true,
      temperature: 0.7,
      top_p: 0.9,
      repetition_penalty: 1.1
    });
    const generated = result?.[0]?.generated_text;
    let answer = "";
    if (Array.isArray(generated)) {
      const lastAssistant = [...generated].reverse().find((m) => m.role === "assistant");
      answer = lastAssistant?.content || "";
    } else if (typeof generated === "string") {
      answer = generated.slice(generated.lastIndexOf(prompt) + prompt.length).trim();
    }
    answer = String(answer).trim() || "No pude generar una respuesta esta vez. Probá de nuevo.";
    thinking.lastChild.textContent = answer;
    messages.push({ role: "user", content: prompt }, { role: "assistant", content: answer });
    if (messages.length > 16) messages.splice(0, messages.length - 16);
  } catch (error) {
    console.error(error);
    thinking.lastChild.textContent = "Hubo un error al generar la respuesta: " + (error?.message || String(error));
  } finally {
    busy = false;
    input.disabled = false;
    send.disabled = !generator;
    input.focus();
  }
});

$("clearLocalChat").addEventListener("click", () => {
  messages.length = 0;
  chat.replaceChildren();
  addBubble("QBIT · IA local", "Conversación borrada. ¡Arrancamos de nuevo!");
});

setStatus("Listo para cargar el modelo. Tocá «Descargar y cargar modelo» cuando quieras.");
