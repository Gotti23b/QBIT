
const TOOL_NAMES = new Set(["open_anything", "system_info", "volume", "web_search", "time_date", "automation"]);
const QUICK_REPLIES = [
  { test: /^(?:que sos|quien sos|que eres|quien eres|como te llamas|cual es tu nombre)$/, reply: "Soy Agent, el asistente local de QBIT. Puedo responder preguntas y usar Artifacts para realizar algunas acciones en Windows." },
  { test: /^(?:que podes hacer|que puedes hacer|que sabes hacer|para que servis|para que sirves)$/, reply: "Puedo conversar y, cuando corresponde, usar Artifacts para abrir aplicaciones o archivos, consultar información del equipo, cambiar el volumen, buscar en la web y consultar la fecha y hora." },
  { test: /^(?:hola|buenas|buen dia|buenas tardes|buenas noches)$/, reply: "¡Hola! Soy Agent, el asistente local de QBIT. ¿En qué te ayudo?" },
  { test: /^(?:como estas|que tal|como andas|todo bien)$/, reply: "¡Todo bien por acá! Soy Agent, listo para ayudarte. ¿Qué necesitás?" }
];
function quickReply(message) {
  const n = normalize(message);
  const mathMatch = n.match(/^(?:cuanto(?: me)? (?:da|es)|calcula|resuelve)\\s+(.+)$/);
  if (mathMatch) {
    const answer = evaluateArithmetic(mathMatch[1]);
    if (answer !== null) return "Da " + answer + ".";
  }
  if (/^(?:gracias|muchas gracias|te agradezco)$/.test(n)) return "¡De nada! ¿En qué más te ayudo?";
  return QUICK_REPLIES.find(item => item.test.test(n))?.reply || null;
}

function evaluateArithmetic(expression) {
  const source = String(expression || "").replace(/\\s+/g, "");
  if (!source || source.length > 80) return null;
  const tokens = source.match(/(?:\\d+(?:\\.\\d+)?|\\.\\d+|[()+*/-])/g) || [];
  if (tokens.join("") !== source) return null;
  let position = 0;
  const primary = () => {
    const token = tokens[position++];
    if (token === "+") return primary();
    if (token === "-") return -primary();
    if (token === "(") {
      const value = sum();
      if (tokens[position++] !== ")") throw new Error("paréntesis");
      return value;
    }
    const value = Number(token);
    if (!token || !Number.isFinite(value)) throw new Error("número");
    return value;
  };
  const product = () => {
    let value = primary();
    while (tokens[position] === "*" || tokens[position] === "/") {
      const operator = tokens[position++];
      const right = primary();
      value = operator === "*" ? value * right : value / right;
    }
    return value;
  };
  const sum = () => {
    let value = product();
    while (tokens[position] === "+" || tokens[position] === "-") {
      const operator = tokens[position++];
      const right = product();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  };
  try {
    const value = sum();
    if (position !== tokens.length || !Number.isFinite(value)) return null;
    return String(Number(value.toPrecision(12)));
  } catch { return null; }
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
      return { name: "open_anything", args: { query: target }};
    }
    return { name: "open_anything", args: { query: target }};
  }

  if (/(?:bateria|batería|nivel de carga|estado del sistema|informacion de mi pc|información de mi pc|datos de mi pc|informacion del sistema|información del sistema|estado de mi pc|como esta mi pc|cómo está mi pc|cuanta ram|cuánta ram|memoria ram)/i.test(raw) || ["estado","sistema"].includes(n)) {
    return { name: "system_info", args: {}};
  }

  if (/(?:subi|subí|sube|aumenta|subir|baja|bajá|disminui|disminuí|disminuye|bajar).{0,12}volumen/.test(n)) {
    const action = /(?:baja|bajá|disminui|disminuí|disminuye|bajar)/.test(n) ? "down" : "up";
    return { name: "volume", args: { action }};
  }
  if (/(?:silencia|silenciar|mutea|mute|quita el sonido)/.test(n)) {
    return { name: "volume", args: { action: "mute" }};
  }

  if (/(?:prepara|preparar|inicia|iniciar).{0,25}(?:entorno de estudio|modo estudio)/.test(n)) {
    return { name: "automation", args: {}};
  }

  if (/^(?:que hora es|hora actual|que fecha es|fecha de hoy|que dia es hoy|que dia estamos|decime la hora|dime la hora)$/.test(n)) {
    return { name: "time_date", args: {}};
  }

  match = raw.match(/^(?:(?:busca|buscar|buscame|buscame|buscá|investiga|investigá)(?:\s+en)?(?:\s+la)?\s+(?:web|internet)|busca(?:r)?(?:me)?(?:\s+en)?\s+(?:google|la web|internet))\s*[:,-]?\s+(.+)$/i);
  if (match) {
    return { name: "web_search", args: { query: match[1].trim() }};
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
        { name: "open_anything", args: { query: target }},
        { name: "system_info", args: {}}
      ];
    }
  }
  const single = detectArtifact(message);
  return single ? [single] : [];
}

export async function createDesktopAgent({ onStatus = () => {} } = {}) {
  let generator = null;
  let loadingPromise = null;
  const history = [];

  async function loadModel() {
    if (generator) return generator;
    if (loadingPromise) return loadingPromise;
    let modelDiagnostics = "Diagnóstico del modelo no disponible.";
    loadingPromise = (async () => {
      const bridge = window.qbitPC;
      if (!bridge || typeof bridge.ensureModelFiles !== "function" || typeof bridge.getAgentModelSettings !== "function") {
        throw new Error("No está disponible el selector y administrador de modelos de QBIT. Instalá la compilación más reciente.");
      }
      const settings = await bridge.getAgentModelSettings();
      const profile = settings.models?.find(item => item.id === settings.selectedModelId);
      if (!profile) throw new Error("QBIT no pudo leer el modelo seleccionado.");
      onStatus("Agent está comprobando los archivos de " + profile.name + "…");
      const stopListening = typeof bridge.onModelProgress === "function"
        ? bridge.onModelProgress(progress => {
            if (progress.stage === "file-start") {
              onStatus("Agent está preparando " + progress.file + "…");
            } else if (progress.stage === "download") {
              const percent = Number.isFinite(progress.percent) ? " (" + progress.percent + "%)" : "";
              onStatus("Descargando " + progress.file + percent + " en la PC…");
            } else if (progress.stage === "file-done") {
              onStatus("Archivo guardado: " + progress.file + ".");
            }
          })
        : () => {};
      let localFiles;
      try {
        localFiles = await bridge.ensureModelFiles(profile.id);
      } finally {
        stopListening();
      }
      const bytes = Number(localFiles?.modelBytes);
      const gib = Number.isFinite(bytes) && bytes > 0 ? (bytes / (1024 ** 3)).toFixed(2) + " GiB" : "tamaño no informado";
      const memory = typeof navigator.deviceMemory === "number" ? navigator.deviceMemory + " GiB aproximados" : "RAM del dispositivo no expuesta por el navegador";
      modelDiagnostics = [
        "Modelo: " + String(localFiles?.model || profile.repo),
        "Archivo ONNX local: " + gib + (Number.isFinite(bytes) && bytes > 0 ? " (" + bytes + " bytes)" : ""),
        "Transformers.js: 3.7.2",
        "Backend: ONNX Runtime nativo/CPU",
        "Hilos lógicos: " + String(navigator.hardwareConcurrency || "no informado"),
        "Memoria del dispositivo: " + memory,
        "Modelo cargado desde el disco por el proceso principal de Electron"
      ].join("; ");
      console.info("[QBIT Agent] " + modelDiagnostics);
      if (!Number.isFinite(bytes) || bytes < profile.minimumModelBytes) {
        throw new Error("El archivo local de " + profile.name + " parece incompleto (" + gib + "). QBIT lo conservó sin borrarlo ni volverlo a descargar.");
      }
      onStatus(localFiles.downloaded
        ? "Modelo guardado. Preparando " + profile.name + "…"
        : "Modelo encontrado en el disco. Preparando " + profile.name + "…");
      onStatus("Agent está inicializando " + profile.name + " con ONNX Runtime nativo…");
      try {
        if (typeof bridge.loadAgentModel !== "function" || typeof bridge.generateAgentReply !== "function") {
          throw new Error("Esta compilación no incluye el backend nativo. Instalá la compilación más reciente.");
        }
        await bridge.loadAgentModel(profile.id);
        generator = (messages, options) => bridge.generateAgentReply(messages, options);
      } catch (error) {
        console.error("[QBIT Agent] Falló la inicialización de Transformers.js/ONNX Runtime:", error);
        let detail;
        if (error instanceof Error) {
          detail = error.name + ": " + error.message + (error.stack ? "\n" + error.stack : "");
        } else {
          detail = "El runtime devolvió un valor no estándar (" + typeof error + "): " + String(error);
          if (typeof error === "number" && Number.isFinite(error)) detail += " (0x" + (error >>> 0).toString(16).toUpperCase() + ")";
        }
        console.error("[QBIT Agent] Diagnóstico del fallo:", modelDiagnostics);
        throw new Error("Falló la inicialización del modelo local. " + detail + "\n" + modelDiagnostics);
      }
      onStatus("Agent está listo con " + profile.name + ".");
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

  async function generateReply(message, toolResults = null) {
    const model = await loadModel();
    const conversation = [
      {
        role: "system",
        content: "Sos Agent, el asistente local de QBIT. Respondé en español rioplatense, natural, claro y breve. Entendé la intención aunque haya errores de escritura, palabras incompletas, sinónimos o artículos. Para abrir algo, pensá qué es y usá el nombre base más reconocible: por ejemplo, si piden “la calculadora”, “la cosa para hacer cuentas”, “calculator” o escriben mal “claculator”, la búsqueda debe apuntar a “calculadora”, sin palabras de relleno como “la” o “abrí”. Para archivos, priorizá el nombre útil del archivo y no inventes rutas. Si incluís código, escribilo correctamente, con sintaxis válida, espacios e indentación; nunca unas el nombre del lenguaje con la primera línea. Usá siempre bloques Markdown completos: escribí tres acentos graves y el lenguaje (por ejemplo, python) en una línea propia; empezá el código en la línea siguiente, respetá los espacios y la indentación, y cerrá el bloque con otros tres acentos graves en una línea aparte. No escribas etiquetas de lenguaje inventadas ni errores como “pytonrint”. Usá Artifacts cuando el código te permita ejecutarlos; no afirmes que elegiste o ejecutaste una herramienta si no ocurrió. Basate en los resultados reales de las herramientas y diferenciá entre intentar una acción y confirmar su resultado. No inventes datos ni acciones; si no sabés algo, decilo."
      },
      ...history.slice(-4),
      {
        role: "user",
        content: toolResults
          ? message + "\n\nResultados reales de los Artifacts ejecutados (datos de ejecución; no inventes información):\n" + JSON.stringify(toolResults)
          : message
      }
    ];
    const answer = String(await model(conversation, {
      max_new_tokens: 128,
      do_sample: true,
      temperature: 0.7,
      top_p: 0.9,
      repetition_penalty: 1.18,
      no_repeat_ngram_size: 3
    }) || "").trim() || "No pude generar una respuesta esta vez. Probá de nuevo.";
    history.push({ role: "user", content: message }, { role: "assistant", content: answer });
    if (history.length > 20) history.splice(0, history.length - 20);
    return answer;
  }

  async function handle(message, { selectedArtifacts = [], onResult = () => {}, executeArtifact, onStatus: updateStatus = onStatus } = {}) {
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
        if (only === "system_info" && /bateria|ram|sistema|equipo|pc|computadora/.test(n)) artifacts = [{ name: only, args: {}}];
        if (only === "time_date" && /hora|fecha|dia/.test(n)) artifacts = [{ name: only, args: {}}];
        if (only === "web_search") artifacts = [{ name: only, args: { query: message }}];
        if (only === "open_anything") artifacts = [{ name: only, args: { query: message.replace(/^(?:busca|abre|abrí|abrir|open)\s+/i, "").trim() }}];
      }
    }

    if (artifacts.length) {
      if (typeof executeArtifact !== "function") throw new Error("No está disponible el ejecutor de Artifacts.");
      const results = [];
      for (const artifact of artifacts) {
        updateStatus("Agent está ejecutando " + artifact.name + "…");
        const result = await executeArtifact(artifact.name, artifact.args);
        results.push({
          artifact: artifact.name,
          arguments: artifact.args,
          success: result?.ok !== false,
          result
        });
      }
      updateStatus("Agent está interpretando los resultados reales…");
      const answer = await generateReply(message, results);
      onResult(answer);
      updateStatus("Agent terminó la tarea.");
      return;
    }

    if (selected.length) {
      updateStatus("No encontré una acción compatible con los Artifacts seleccionados. Voy a responder sin ejecutar herramientas.");
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
