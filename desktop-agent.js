import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2";

env.allowLocalModels = true;
env.allowRemoteModels = false;
env.localModelPath = "qbit-model://local/";
env.useBrowserCache = false;

// Qwen Q4 ocupa casi 1.8 GB. En equipos con RAM limitada, usar un solo
// hilo WASM y desactivar el proxy evita workers adicionales durante el inicio.
// Esto conserva el modelo local existente y no cambia la variante descargada.
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;

// Transformers.js v3 usa niveles numéricos: DEBUG = 10.
env.logLevel = 10;

const TOOL_NAMES = new Set(["open_anything", "system_info", "volume", "web_search", "time_date", "automation"]);
const QUICK_REPLIES = [
  { test: /^(?:que sos|quien sos|que eres|quien eres|como te llamas|cual es tu nombre)$/, reply: "Soy Agent, el asistente local de QBIT. Puedo responder preguntas y usar Artifacts para realizar algunas acciones en Windows." },
  { test: /^(?:que podes hacer|que puedes hacer|que sabes hacer|para que servis|para que sirves)$/, reply: "Puedo conversar y, cuando corresponde, usar Artifacts para abrir aplicaciones o archivos, consultar información del equipo, cambiar el volumen, buscar en la web y consultar la fecha y hora." },
  { test: /^(?:hola|buenas|buen dia|buenas tardes|buenas noches)$/, reply: "¡Hola! Soy Agent, el asistente local de QBIT. ¿En qué te ayudo?" },
  { test: /^(?:como estas|que tal|como andas|todo bien)$/, reply: "¡Todo bien por acá! Soy Agent, listo para ayudarte. ¿Qué necesitás?" }
];
function quickReply(message) {
  const n = normalize(message);
  return QUICK_REPLIES.find(item => item.test.test(n))?.reply || null;
}
const normalize = (value) => String(value || "").toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[¿?¡!.,;:]/g, " ").replace(/\s+/g, " ").trim();

function detectArtifact(message) {
  const raw = String(message || "").trim();
  const n = normalize(raw);
  let match;

  match = raw.match(/^(?:qbit[, :]+)?(?:abre|abri|abrí|abrir|abrime|ejecuta|ejecutá|inicia|iniciá|open)\s+(.+)$/i);
  if (match) {
    const target = match[1].trim().replace(/^(?:la pagina de|la web de|el sitio de|la carpeta|el archivo|la aplicacion|la aplicación)\s+/i, "");
    if (/^(?:documentos|descargas|escritorio|imagenes|imágenes|musica|música|videos|inicio)$/i.test(target)) {
      return { name: "open_anything", args: { query: target }, plan: "Me pediste abrir " + target + ". Voy a buscarlo entre las aplicaciones y archivos disponibles." };
    }
    return { name: "open_anything", args: { query: target }, plan: "Me pediste abrir " + target + ". Voy a usar el Artifact para localizarlo y abrirlo." };
  }

  if (/(?:bateria|batería|nivel de carga|estado del sistema|informacion de mi pc|información de mi pc|datos de mi pc|informacion del sistema|información del sistema|estado de mi pc|como esta mi pc|cómo está mi pc|cuanta ram|cuánta ram|memoria ram)/i.test(raw) || ["estado","sistema"].includes(n)) {
    return { name: "system_info", args: {}, plan: "Me pediste información del equipo. Voy a consultar el estado real de Windows, incluida la batería si está disponible." };
  }

  if (/(?:subi|subí|sube|aumenta|subir|baja|bajá|disminui|disminuí|disminuye|bajar).{0,12}volumen/.test(n)) {
    const action = /(?:baja|bajá|disminui|disminuí|disminuye|bajar)/.test(n) ? "down" : "up";
    return { name: "volume", args: { action }, plan: "Me pediste cambiar el volumen. Voy a usar el Artifact de control de audio." };
  }
  if (/(?:silencia|silenciar|mutea|mute|quita el sonido)/.test(n)) {
    return { name: "volume", args: { action: "mute" }, plan: "Me pediste silenciar el equipo. Voy a usar el Artifact de control de audio." };
  }

  if (/(?:prepara|preparar|inicia|iniciar).{0,25}(?:entorno de estudio|modo estudio)/.test(n)) {
    return { name: "automation", args: {}, plan: "Me pediste preparar el entorno de estudio. Voy a solicitar confirmación antes de abrir las aplicaciones." };
  }

  if (/^(?:que hora es|hora actual|que fecha es|fecha de hoy|que dia es hoy|que dia estamos|decime la hora|dime la hora)$/.test(n)) {
    return { name: "time_date", args: {}, plan: "Me pediste la fecha o la hora. Voy a consultar el reloj local del equipo." };
  }

  match = raw.match(/^(?:(?:busca|buscar|buscame|buscame|buscá|investiga|investigá)(?:\s+en)?(?:\s+la)?\s+(?:web|internet)|busca(?:r)?(?:me)?(?:\s+en)?\s+(?:google|la web|internet))\s*[:,-]?\s+(.+)$/i);
  if (match) {
    return { name: "web_search", args: { query: match[1].trim() }, plan: "Me pediste buscar información en Internet. Voy a abrir una búsqueda con tu consulta." };
  }
  return null;
}

function detectArtifactChain(message) {
  const raw = String(message || "").trim();
  const open = raw.match(/^(?:qbit[, :]+)?(?:abre|abri|abrí|abrir|abrime|ejecuta|ejecutá|inicia|iniciá|open)\s+(.+)$/i);
  if (open) {
    const combined = open[1].match(/^(.+?)\s+y\s+(?:decime|dime|consulta|consultá|consultar|mostrame|muestra|revisa|revisá|fijate|averigua|averiguá)\b(.+)$/i);
    if (combined && /bateria|batería|ram|sistema|equipo|pc|computadora|estado/i.test(combined[2])) {
      const target = combined[1].trim();
      return [
        { name: "open_anything", args: { query: target }, plan: "Me pediste abrir " + target + ". Voy a localizarlo y abrirlo." },
        { name: "system_info", args: {}, plan: "Después voy a consultar la información real del equipo, incluida la batería si está disponible." }
      ];
    }
  }
  const single = detectArtifact(message);
  return single ? [single] : [];
}

function resultText(result) {
  if (typeof result === "string") return result;
  return result?.message || JSON.stringify(result);
}

export async function createDesktopAgent({ onStatus = () => {} } = {}) {
  let generator = null;
  let loadingPromise = null;
  const history = [];

  async function loadModel() {
    if (generator) return generator;
    if (loadingPromise) return loadingPromise;
    loadingPromise = (async () => {
      const bridge = window.qbitPC;
      if (!bridge || typeof bridge.ensureModelFiles !== "function") {
        throw new Error("No está disponible el administrador de modelos locales de QBIT.");
      }
      onStatus("Agent está comprobando los archivos locales del modelo…");
      const stopListening = typeof bridge.onModelProgress === "function"
        ? bridge.onModelProgress(progress => {
            if (progress.stage === "file-start") {
              onStatus("Agent está descargando " + progress.file + "…");
            } else if (progress.stage === "download") {
              const percent = Number.isFinite(progress.percent) ? " (" + progress.percent + "%)" : "";
              onStatus("Guardando " + progress.file + percent + " en la PC…");
            } else if (progress.stage === "file-done") {
              onStatus("Archivo guardado: " + progress.file + ".");
            }
          })
        : () => {};
      try {
        const localFiles = await bridge.ensureModelFiles();
        onStatus(localFiles.downloaded
          ? "Archivos guardados. Preparando el modelo local…"
          : "Modelo encontrado en el disco. Preparándolo sin descargarlo…");
      } finally {
        stopListening();
      }
      onStatus("Agent está inicializando Qwen y ONNX Runtime desde los archivos locales…");
      try {
        generator = await pipeline("text-generation", "onnx-community/Qwen2.5-1.5B-Instruct", {
          dtype: "q4",
          device: "wasm"
        });
      } catch (error) {
        console.error("[QBIT Agent] Falló la inicialización de Transformers.js/ONNX Runtime:", error);
        let detail;
        if (error instanceof Error) {
          detail = error.name + ": " + error.message + (error.stack ? "\\n" + error.stack : "");
        } else {
          detail = "El runtime devolvió un valor no estándar (" + typeof error + "): " + String(error);
          if (typeof error === "number" && Number.isFinite(error)) detail += " (0x" + (error >>> 0).toString(16).toUpperCase() + ")";
        }
        throw new Error("Falló la inicialización del modelo local (Transformers.js/ONNX Runtime). " + detail.slice(0, 1200));
      }
      onStatus("Agent está listo. El modelo se carga desde los archivos de esta PC.");
      return generator;
    })();
    try {
      return await loadingPromise;
    } catch (error) {
      loadingPromise = null;
      generator = null;
      throw error;
    }
  }

  async function generateReply(message) {
    const model = await loadModel();
    const conversation = [
      {
        role: "system",
        content: "Sos Agent, el asistente local de QBIT. Respondé en español rioplatense, de forma clara y breve. No afirmes que hiciste acciones en Windows: las acciones se ejecutan únicamente mediante Artifacts controlados. Si no sabés algo, decilo."
      },
      ...history.slice(-4),
      { role: "user", content: message }
    ];
    const output = await model(conversation, {
      max_new_tokens: 128,
      do_sample: true,
      temperature: 0.7,
      top_p: 0.9,
      repetition_penalty: 1.18,
      no_repeat_ngram_size: 3
    });
    const generated = output?.[0]?.generated_text;
    let answer = "";
    if (Array.isArray(generated)) {
      const lastAssistant = [...generated].reverse().find((entry) => entry.role === "assistant");
      answer = lastAssistant?.content || "";
    } else if (typeof generated === "string") {
      answer = generated.slice(generated.lastIndexOf(message) + message.length).trim();
    }
    answer = String(answer).trim() || "No pude generar una respuesta esta vez. Probá de nuevo.";
    history.push({ role: "user", content: message }, { role: "assistant", content: answer });
    if (history.length > 20) history.splice(0, history.length - 20);
    return answer;
  }

  async function handle(message, { selectedArtifacts = [], onPlan = () => {}, onResult = () => {}, executeArtifact, onStatus: updateStatus = onStatus } = {}) {
    const selected = Array.isArray(selectedArtifacts) ? selectedArtifacts.filter((name) => TOOL_NAMES.has(name)) : [];
    const canned = quickReply(message);
    if (canned && !selected.length) {
      onResult(canned);
      updateStatus("Agent está listo.");
      return;
    }
    let artifacts = detectArtifactChain(message);

    if (selected.length) {
      artifacts = artifacts.filter((artifact) => selected.includes(artifact.name));
      if (!artifacts.length && selected.length === 1) {
        const only = selected[0];
        const n = normalize(message);
        if (only === "system_info" && /bateria|ram|sistema|equipo|pc|computadora/.test(n)) artifacts = [{ name: only, args: {}, plan: "Elegiste el Artifact de información del sistema. Voy a consultar el dato que pediste." }];
        if (only === "time_date" && /hora|fecha|dia/.test(n)) artifacts = [{ name: only, args: {}, plan: "Elegiste el Artifact de fecha y hora. Voy a consultar el reloj local." }];
        if (only === "web_search") artifacts = [{ name: only, args: { query: message }, plan: "Elegiste el Artifact de búsqueda web. Voy a abrir una búsqueda para tu consulta." }];
        if (only === "open_anything") artifacts = [{ name: only, args: { query: message.replace(/^(?:busca|abre|abrí|abrir|open)\s+/i, "").trim() }, plan: "Elegiste el Artifact para abrir aplicaciones y archivos. Voy a buscar lo que pediste." }];
      }
    }

    if (artifacts.length) {
      if (typeof executeArtifact !== "function") throw new Error("No está disponible el ejecutor de Artifacts.");
      onPlan(artifacts.map((artifact) => artifact.plan).join("\n"));
      const results = [];
      for (const artifact of artifacts) {
        updateStatus("Agent está ejecutando el Artifact: " + artifact.name + "…");
        const result = await executeArtifact(artifact.name, artifact.args);
        results.push(resultText(result));
      }
      onResult(results.join("\n\n"));
      updateStatus("Agent terminó la tarea.");
      return;
    }

    if (selected.length) {
      onPlan("Me pediste usar Artifacts específicos, pero no encontré una acción compatible con esa selección. Voy a responder sin ejecutar herramientas.");
    } else {
      updateStatus("Agent está pensando…");
    }
    const answer = await generateReply(message);
    onResult(answer);
    updateStatus("Agent está listo.");
  }

  return { handle, loadModel };
}

window.qbitDesktopAgentFactory = createDesktopAgent;
window.dispatchEvent(new Event("qbit-agent-ready"));
