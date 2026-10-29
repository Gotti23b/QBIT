const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, screen, protocol, net } = require("electron");
const { pathToFileURL } = require("node:url");

// A secure, persistent origin is required for browser Cache Storage to reuse model files between launches.
protocol.registerSchemesAsPrivileged([
  { scheme: "qbit", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  { scheme: "qbit-model", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const { Readable, Transform } = require("node:stream");
const { pipeline: streamPipeline } = require("node:stream/promises");

let mainWindow;
let petWindow;
let tray;
let isQuitting = false;
let petExpanded = false;
const DEFAULT_PET_SETTINGS = Object.freeze({ visible: true, size: "normal", animations: true });
let petSettings = { ...DEFAULT_PET_SETTINGS };
function petSettingsPath() { return path.join(app.getPath("userData"), "pet-settings.json"); }
function loadPetSettings() {
  try {
    const s = JSON.parse(fs.readFileSync(petSettingsPath(), "utf8"));
    petSettings = { visible: s.visible !== false, size: ["small", "normal", "large"].includes(s.size) ? s.size : "normal", animations: s.animations !== false };
  } catch { petSettings = { ...DEFAULT_PET_SETTINGS }; }
}
function savePetSettings() {
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  fs.writeFileSync(petSettingsPath(), JSON.stringify(petSettings, null, 2), "utf8");
}
function petScale() { return petSettings.size === "small" ? 0.8 : petSettings.size === "large" ? 1.2 : 1; }
function sendPetSettings() {
  if (petWindow && !petWindow.isDestroyed() && !petWindow.webContents.isLoading()) petWindow.webContents.send("qbit:pet-settings", { ...petSettings });
}

function getAppRoot() {
  const candidates = [path.join(__dirname, ".."), path.join(__dirname, "..", "..")];
  return candidates.find(candidate => fs.existsSync(path.join(candidate, "index.html"))) || candidates[0];
}


const MODEL_REPO = "onnx-community/Qwen2.5-1.5B-Instruct";
const MODEL_FILES = [
  "added_tokens.json",
  "config.json",
  "generation_config.json",
  "merges.txt",
  "special_tokens_map.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "vocab.json",
  "onnx/model_q4.onnx"
];
let modelDownloadPromise = null;

let nativeTextGenerator = null;
let nativeTextGeneratorPromise = null;

async function loadNativeTextGenerator() {
  if (nativeTextGenerator) return nativeTextGenerator;
  if (nativeTextGeneratorPromise) return nativeTextGeneratorPromise;
  nativeTextGeneratorPromise = (async () => {
    const { pipeline, env } = await import("@huggingface/transformers");
    env.allowLocalModels = true;
    env.allowRemoteModels = false;
    env.localModelPath = localModelStorageRoot() + path.sep;
    env.useFS = true;
    env.useBrowserCache = false;
    const modelPath = path.join(localModelRepoPath(), "onnx", "model_q4.onnx");
    const stat = await fs.promises.stat(modelPath);
    if (!stat.isFile() || stat.size < 1_700_000_000) {
      throw new Error("El modelo ONNX local no está completo. No se borró ni se volvió a descargar.");
    }
    console.info("[QBIT Agent] Inicializando Transformers.js en Node.js con ONNX Runtime nativo; modelo local:", stat.size, "bytes");
    nativeTextGenerator = await pipeline("text-generation", MODEL_REPO, { dtype: "q4" });
    console.info("[QBIT Agent] Modelo local inicializado con el backend nativo.");
    return nativeTextGenerator;
  })().catch(error => {
    nativeTextGeneratorPromise = null;
    nativeTextGenerator = null;
    throw error;
  });
  return nativeTextGeneratorPromise;
}

function localModelStorageRoot() {
  return path.join(app.getPath("userData"), "models");
}

function localModelRepoPath() {
  return path.join(localModelStorageRoot(), ...MODEL_REPO.split("/"));
}

async function ensureLocalModelFiles(sender) {
  if (modelDownloadPromise) return modelDownloadPromise;
  modelDownloadPromise = (async () => {
    const repoRoot = localModelRepoPath();
    await fs.promises.mkdir(repoRoot, { recursive: true });
    const missing = [];
    for (const file of MODEL_FILES) {
      const target = path.join(repoRoot, ...file.split("/"));
      try {
        const stat = await fs.promises.stat(target);
        const minimumSize = file.endsWith(".onnx") ? 1_000_000 : 1;
        if (!stat.isFile() || stat.size < minimumSize) {
          await fs.promises.rm(target, { force: true });
          missing.push(file);
        }
      } catch {
        missing.push(file);
      }
    }

    if (missing.length === 0) {
      const modelStat = await fs.promises.stat(path.join(repoRoot, "onnx", "model_q4.onnx"));
      return { ready: true, downloaded: false, model: MODEL_REPO, modelBytes: modelStat.size };
    }

    for (const file of missing) {
      const target = path.join(repoRoot, ...file.split("/"));
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      const temporary = target + ".download";
      await fs.promises.rm(temporary, { force: true });
      sender.send("qbit:model-progress", { stage: "file-start", file, loaded: 0, total: 0, percent: null });
      const url = "https://huggingface.co/" + MODEL_REPO + "/resolve/main/" + file + "?download=true";
      const response = await fetch(url, { redirect: "follow" });
      if (!response.ok || !response.body) {
        throw new Error("No se pudo descargar " + file + " (HTTP " + response.status + ").");
      }
      const total = Number(response.headers.get("content-length")) || 0;
      let loaded = 0;
      let lastPercent = -1;
      const progress = new Transform({
        transform(chunk, encoding, callback) {
          loaded += chunk.length;
          const percent = total > 0 ? Math.min(100, Math.floor(loaded * 100 / total)) : null;
          if (percent === null || percent !== lastPercent) {
            lastPercent = percent;
            try { sender.send("qbit:model-progress", { stage: "download", file, loaded, total, percent }); } catch {}
          }
          callback(null, chunk);
        }
      });
      try {
        await streamPipeline(Readable.fromWeb(response.body), progress, fs.createWriteStream(temporary));
        const stat = await fs.promises.stat(temporary);
        if (!stat.isFile() || stat.size < (file.endsWith(".onnx") ? 1_000_000 : 1)) {
          throw new Error("El archivo descargado está incompleto: " + file);
        }
        if (total > 0 && stat.size !== total) {
          throw new Error("El tamaño descargado no coincide para " + file + ": se esperaban " + total + " bytes y llegaron " + stat.size + ".");
        }
        await fs.promises.rename(temporary, target);
      } catch (error) {
        await fs.promises.rm(temporary, { force: true }).catch(() => {});
        throw error;
      }
      sender.send("qbit:model-progress", { stage: "file-done", file, loaded, total, percent: 100 });
    }

    const modelStat = await fs.promises.stat(path.join(repoRoot, "onnx", "model_q4.onnx"));
    return { ready: true, downloaded: true, model: MODEL_REPO, modelBytes: modelStat.size };
  })().finally(() => { modelDownloadPromise = null; });
  return modelDownloadPromise;
}

const PET_SMALL = { width: 116, height: 116 };
const PET_LARGE = { width: 320, height: 430 };

function runWindowsCommand(file, args, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { windowsHide: true, shell: false });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("La operación tardó demasiado.")); }, timeout);
    child.stdout?.on("data", chunk => { stdout += chunk.toString(); });
    child.stderr?.on("data", chunk => { stderr += chunk.toString(); });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => { clearTimeout(timer); if (code === 0) resolve(stdout.trim()); else reject(new Error(stderr.trim() || "Windows devolvió un error.")); });
  });
}

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  mainWindow = new BrowserWindow({
    width: 1180, height: 820, minWidth: 760, minHeight: 560,
    backgroundColor: "#07111f", title: "QBIT — Asistente personal",
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) shell.openExternal(url).catch(() => {});
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("qbit://app/")) event.preventDefault();
  });
  mainWindow.on("close", event => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on("closed", () => { mainWindow = null; });
  mainWindow.loadURL("qbit://app/index.html");
}

function workAreaForPoint(x, y) {
  return screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) }).workArea;
}

function clampPetPosition(x, y, width, height) {
  const area = workAreaForPoint(x + width / 2, y + height / 2);
  return {
    x: Math.max(area.x, Math.min(Math.round(x), area.x + area.width - width)),
    y: Math.max(area.y, Math.min(Math.round(y), area.y + area.height - height))
  };
}

function resizePet(expanded) {
  if (!petWindow || petWindow.isDestroyed()) return;
  const scale = petScale();
  const base = expanded ? PET_LARGE : PET_SMALL;
  const next = { width: Math.round(base.width * scale), height: Math.round(base.height * scale) };
  const [oldWidth, oldHeight] = petWindow.getSize();
  const [oldX, oldY] = petWindow.getPosition();
  const nextX = oldX + oldWidth - next.width;
  const nextY = oldY + oldHeight - next.height;
  const pos = clampPetPosition(nextX, nextY, next.width, next.height);
  petExpanded = Boolean(expanded);
  petWindow.setBounds({ x: pos.x, y: pos.y, width: next.width, height: next.height }, false);
  petWindow.setAlwaysOnTop(true, "floating");
  if (petExpanded) petWindow.show();
}

function createPetWindow() {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.show();
    petWindow.setAlwaysOnTop(true, "floating");
    return;
  }
  const area = screen.getPrimaryDisplay().workArea;
  const initialScale = petScale();
  petWindow = new BrowserWindow({
    width: Math.round(PET_SMALL.width * initialScale), height: Math.round(PET_SMALL.height * initialScale),
    x: area.x + area.width - PET_SMALL.width - 20,
    y: area.y + area.height - PET_SMALL.height - 24,
    title: "Mascota QBIT",
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  petWindow.setAlwaysOnTop(true, "floating");
  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  petWindow.on("close", event => {
    if (!isQuitting) {
      event.preventDefault();
      petWindow.hide();
    }
  });
  petWindow.on("closed", () => { petWindow = null; });
  petWindow.loadFile(path.join(__dirname, "mascot.html"));
  petWindow.webContents.on("did-finish-load", () => sendPetSettings());
  petWindow.once("ready-to-show", () => { if (petSettings.visible) petWindow?.show(); });
}

function createTray() {
  if (tray) return;
  const iconPath = path.join(getAppRoot(), "qbit-icon.ico");
  let icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) {
    icon = nativeImage.createFromDataURL("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABIUlEQVR4nO2WSwqDMBCGx1LortC1YAuewAt4GO/RVe/hYbyAJxCK4AV6gXaVEsNkXobaSv+NYB7fn8kkmexwOj9hRe3WhP8NfIWBPdch7/rFkKmuom1kBFLAuXmy2DH0B1Er0MCxedAISOHtOMy+mPzxWCTILdDApSZCsUkYAwMANEU5++/a/P+cxMfQB2CQmBlOogi04wDX+wMA6HA6E65/3vVsAosMNEX5TiAqzNJV+zLfhCGM2h5K6iT0wxya0IDNBnyY25bb5WiCAyR6jKzwZAaWaJsGNK+oOgmpy8XygooNuAnzrkdXaH2+1VuATe7gU12pawdTRYSBKDCVE6gBrogI+0nhWL9oScbBtYqZNFdEKeAATAQ+oW3ehD9l4AUUK4lPDW2PuAAAAABJRU5ErkJggg==");
  }
  tray = new Tray(icon);
  tray.setToolTip("QBIT");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Abrir QBIT", click: () => createWindow() },
    { label: "Mostrar mascota", click: () => createPetWindow() },
    { label: "Ocultar mascota", click: () => petWindow?.hide() },
    { type: "separator" },
    { label: "Salir de QBIT", click: () => { isQuitting = true; app.quit(); } }
  ]));
  tray.on("double-click", () => createWindow());
}

const allowedApps = {
  "calculadora": { file: "calc.exe", args: [] },
  "bloc de notas": { file: "notepad.exe", args: [] },
  "paint": { file: "mspaint.exe", args: [] },
  "administrador de tareas": { file: "taskmgr.exe", args: [] },
  "explorador": { file: "explorer.exe", args: [] }
};
const knownFolders = {
  "inicio": () => app.getPath("home"),
  "documentos": () => app.getPath("documents"),
  "descargas": () => path.join(app.getPath("home"), "Downloads"),
  "escritorio": () => app.getPath("desktop"),
  "imagenes": () => app.getPath("pictures"),
  "musica": () => app.getPath("music"),
  "videos": () => app.getPath("videos")
};

function normalizeLocalName(value) {
  return String(value || "").toLocaleLowerCase("es")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

// Convierte pedidos coloquiales en el nombre más útil para buscar.
// No cambia los permisos: solo normaliza la consulta antes de buscar coincidencias.
function normalizeOpenQuery(value) {
  let query = normalizeLocalName(value)
    .replace(/^(?:(?:por favor|porfa) )+/, "")
    .replace(/^(?:(?:abrime|abrir|abre|abri|ejecuta|ejecutar|inicia|iniciar|open) )+/, "")
    .replace(/^(?:(?:la|el|los|las|un|una|mi|mis) )+/, "")
    .replace(/^(?:(?:aplicacion|programa|app|herramienta|cosa) )+/, "")
    .trim();

  const calculatorWords = /\b(?:calculadora|calculador|calculator|calculater|claculator|calclator|calc|matematica|matematicas|hacer cuentas|hacer calculos|hacer calculas)\b/;
  const vagueCalculatorRequest = /\b(?:cosa|herramienta|programa|app)\b.*\b(?:matematica|matematicas|calcular|cuentas|calculos)\b/;
  if (calculatorWords.test(query) || vagueCalculatorRequest.test(query)) return "calculadora";

  const aliases = [
    [/\b(?:notepad|bloc de notas|notas)\b/, "bloc de notas"],
    [/\b(?:task manager|administrador de tareas)\b/, "administrador de tareas"],
    [/\b(?:file explorer|explorador de archivos|explorador)\b/, "explorador"],
    [/\b(?:paint|mspaint)\b/, "paint"]
  ];
  for (const [pattern, canonical] of aliases) {
    if (pattern.test(query)) return canonical;
  }

  return query;
}

function localMatchScore(query, candidate) {
  const q = normalizeLocalName(query);
  const c = normalizeLocalName(candidate);
  if (!q || !c) return 0;
  if (q === c) return 1000;
  if (c.startsWith(q)) return 850;
  if (c.includes(q)) return 700;
  const tokens = q.split(" ").filter(Boolean);
  if (tokens.length && tokens.every(token => c.split(" ").some(part => part.startsWith(token)))) return 550;
  return 0;
}

async function collectFiles(root, onFile, state, depth = 0) {
  if (depth > 4 || state.count >= 4000) return;
  let entries;
  try { entries = await fs.promises.readdir(root, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (state.count >= 4000) return;
    if (entry.name.startsWith("$") || entry.name.startsWith(".")) continue;
    const fullPath = path.join(root, entry.name);
    if (entry.isFile()) {
      state.count++;
      await onFile(fullPath, entry.name);
    } else if (entry.isDirectory() && !["AppData", "Windows", "Program Files", "Program Files (x86)", "ProgramData", "node_modules", ".git", "$Recycle.Bin", "System Volume Information"].includes(entry.name)) {
      await collectFiles(fullPath, onFile, state, depth + 1);
    }
  }
}

async function findLocalMatches(query) {
  const normalized = normalizeOpenQuery(query);
  if (normalized.length < 2) throw new Error("Decime al menos dos letras del nombre del archivo o la aplicación.");
  const matches = [];
  const seen = new Set();
  const add = (item) => {
    if (seen.has(item.path)) return;
    seen.add(item.path);
    matches.push(item);
  };

  for (const [name, spec] of Object.entries(allowedApps)) {
    const score = localMatchScore(normalized, name);
    if (score) add({ kind: "builtin", name, path: spec.file, score });
  }

  const home = app.getPath("home");
  const roots = [
    ...Object.values(knownFolders).filter((getPath) => getPath !== knownFolders.inicio).map(getPath => getPath()),
    process.env.OneDrive,
    process.env.OneDriveConsumer,
    process.env.OneDriveCommercial
  ].filter(Boolean);
  const uniqueRoots = [...new Set(roots.map(p => path.resolve(p)))];
  const startMenuRoots = [
    path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "Microsoft", "Windows", "Start Menu", "Programs"),
    path.join(process.env.ProgramData || "C:\\ProgramData", "Microsoft", "Windows", "Start Menu", "Programs")
  ];

  for (const root of startMenuRoots) {
    await collectFiles(root, async (fullPath, name) => {
      if (path.extname(name).toLowerCase() !== ".lnk") return;
      const label = path.basename(name, path.extname(name));
      if (Object.keys(allowedApps).some(appName => normalizeLocalName(appName) === normalizeLocalName(label))) return;
      const score = localMatchScore(normalized, label);
      if (score) add({ kind: "shortcut", name: label, path: fullPath, score });
    }, { count: 0 });
  }

  const state = { count: 0 };
  const excludedExtensions = new Set([".exe", ".msi", ".msp", ".bat", ".cmd", ".ps1", ".vbs", ".js", ".jse", ".scr", ".com", ".lnk", ".url"]);
  for (const root of uniqueRoots) {
    await collectFiles(root, async (fullPath, name) => {
      if (excludedExtensions.has(path.extname(name).toLowerCase())) return;
      const label = path.basename(name, path.extname(name));
      const score = Math.max(localMatchScore(normalized, label), localMatchScore(normalized, name));
      if (score) add({ kind: "file", name, path: fullPath, score });
    }, state);
    if (state.count >= 4000) break;
  }

  matches.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "es"));
  return matches.slice(0, 20);
}

async function openAnything(query) {
  const matches = await findLocalMatches(query);
  if (!matches.length) {
    throw new Error('No encontré archivos ni aplicaciones que coincidan con "' + String(query).trim() + '". Probá con más letras o con el nombre completo.');
  }
  const bestScore = matches[0].score;
  const best = matches.filter(item => item.score === bestScore);
  if (best.length > 1) {
    const options = best.slice(0, 5).map(item => item.name + (item.kind === "file" ? " · " + path.basename(path.dirname(item.path)) : "")).join(", ");
    throw new Error("Encontré varias coincidencias: " + options + ". Escribí un nombre más específico para elegir una.");
  }
  const item = best[0];
  if (item.kind === "builtin") {
    const spec = allowedApps[item.name];
    const child = spawn(spec.file, spec.args, { detached: true, stdio: "ignore", shell: false, windowsHide: false });
    child.on("error", () => {});
    child.unref();
  } else {
    const error = await shell.openPath(item.path);
    if (error) throw new Error(error);
  }
  return { ok: true, message: (item.kind === "file" ? "Abriendo el archivo " : "Abriendo la aplicación ") + item.name + "." };
}


ipcMain.handle("qbit:pet-settings-get", event => {
  if ((!mainWindow || event.sender !== mainWindow.webContents) && (!petWindow || event.sender !== petWindow.webContents)) throw new Error("Solicitud no autorizada.");
  return { ...petSettings };
});
ipcMain.handle("qbit:pet-settings-set", (event, settings) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error("Solicitud no autorizada.");
  if (!settings || typeof settings !== "object") throw new Error("Configuración inválida.");
  petSettings = {
    visible: settings.visible === true,
    size: ["small", "normal", "large"].includes(settings.size) ? settings.size : "normal",
    animations: settings.animations === true
  };
  savePetSettings();
  if (petWindow && !petWindow.isDestroyed()) {
    const [x, y] = petWindow.getPosition();
    const base = petExpanded ? PET_LARGE : PET_SMALL;
    const scale = petScale();
    const width = Math.round(base.width * scale);
    const height = Math.round(base.height * scale);
    const pos = clampPetPosition(x, y, width, height);
    petWindow.setBounds({ x: pos.x, y: pos.y, width, height }, false);
    if (petSettings.visible) petWindow.show(); else petWindow.hide();
    sendPetSettings();
  } else if (petSettings.visible) createPetWindow();
  return { ...petSettings };
});
ipcMain.handle("qbit:pet-position-reset", event => {
  if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error("Solicitud no autorizada.");
  if (!petWindow || petWindow.isDestroyed()) createPetWindow();
  if (petWindow && !petWindow.isDestroyed()) {
    const area = screen.getPrimaryDisplay().workArea;
    const [width, height] = petWindow.getSize();
    const pos = clampPetPosition(area.x + area.width - width - 20, area.y + area.height - height - 24, width, height);
    petWindow.setPosition(pos.x, pos.y, false);
    petWindow.show();
    petSettings.visible = true;
    savePetSettings();
    sendPetSettings();
  }
  return true;
});

ipcMain.handle("qbit:pet-position", event => {
  if (!petWindow || petWindow.isDestroyed() || event.sender !== petWindow.webContents) return null;
  const [x, y] = petWindow.getPosition();
  return { x, y };
});
ipcMain.handle("qbit:pet-resize", (event, expanded) => {
  if (!petWindow || petWindow.isDestroyed() || event.sender !== petWindow.webContents) return false;
  resizePet(Boolean(expanded));
  return true;
});
ipcMain.handle("qbit:pet-move", (event, x, y) => {
  if (!petWindow || petWindow.isDestroyed() || event.sender !== petWindow.webContents) return false;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const [width, height] = petWindow.getSize();
  const pos = clampPetPosition(x, y, width, height);
  petWindow.setPosition(pos.x, pos.y, false);
  return true;
});
ipcMain.handle("qbit:pet-send-message", (event, rawText) => {
  if (!petWindow || event.sender !== petWindow.webContents) return false;
  if (typeof rawText !== "string" || !rawText.trim() || rawText.length > 500) throw new Error("El mensaje no es válido.");
  const message = rawText.trim();
  // La mascota usa el renderer principal en segundo plano; no mostrar ni enfocar la ventana.
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  const deliver = () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("qbit:pet-message", message);
  };
  if (mainWindow.webContents.isLoading()) mainWindow.webContents.once("did-finish-load", deliver);
  else deliver();
  return true;
});
ipcMain.on("qbit:pet-reply", (event, rawText) => {
  if (!mainWindow || event.sender !== mainWindow.webContents || !petWindow || petWindow.isDestroyed()) return;
  if (typeof rawText === "string") petWindow.webContents.send("qbit:pet-reply", rawText.slice(0, 2000));
});
ipcMain.handle("qbit:pet-show-main", event => {
  if (!petWindow || event.sender !== petWindow.webContents) return false;
  createWindow();
  return true;
});
ipcMain.handle("qbit:pet-hide", event => {
  if (!petWindow || event.sender !== petWindow.webContents) return false;
  petWindow.hide();
  return true;
});


ipcMain.handle("qbit:agent-load", async event => {
  if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error("Solicitud no autorizada.");
  const localFiles = await ensureLocalModelFiles(event.sender);
  await loadNativeTextGenerator();
  return { ready: true, model: MODEL_REPO, modelBytes: localFiles.modelBytes, backend: "onnxruntime-node" };
});

ipcMain.handle("qbit:agent-generate", async (event, messages, options = {}) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error("Solicitud no autorizada.");
  if (!Array.isArray(messages) || messages.length > 12) throw new Error("Conversación inválida.");
  const generator = await loadNativeTextGenerator();
  const safeMessages = messages.map(item => ({
    role: ["system", "user", "assistant"].includes(item?.role) ? item.role : "user",
    content: String(item?.content || "").slice(0, 8000)
  }));
  const maxNewTokens = Math.max(16, Math.min(256, Number(options.max_new_tokens) || 128));
  const output = await generator(safeMessages, {
    max_new_tokens: maxNewTokens,
    do_sample: options.do_sample !== false,
    temperature: Math.max(0.1, Math.min(1.5, Number(options.temperature) || 0.7)),
    top_p: Math.max(0.1, Math.min(1, Number(options.top_p) || 0.9)),
    repetition_penalty: Math.max(1, Math.min(2, Number(options.repetition_penalty) || 1.18)),
    no_repeat_ngram_size: 3
  });
  const generated = output?.[0]?.generated_text;
  if (Array.isArray(generated)) {
    const lastAssistant = [...generated].reverse().find(item => item?.role === "assistant");
    return String(lastAssistant?.content || "").trim();
  }
  if (typeof generated === "string") {
    const lastUser = safeMessages.filter(item => item.role === "user").at(-1)?.content || "";
    return generated.slice(generated.lastIndexOf(lastUser) + lastUser.length).trim();
  }
  return "";
});

ipcMain.handle("qbit:model-ensure", async event => {
  if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error("Solicitud no autorizada.");
  return ensureLocalModelFiles(event.sender);
});

ipcMain.handle("qbit:open-url", async (_event, rawUrl) => {
  if (typeof rawUrl !== "string") throw new Error("Dirección web inválida.");
  let parsed;
  try { parsed = new URL(rawUrl); } catch { throw new Error("La dirección web no es válida."); }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Solo se pueden abrir direcciones HTTP o HTTPS.");
  await shell.openExternal(parsed.href);
  return { ok: true };
});

ipcMain.handle("qbit:status", async () => {
  const cpus = os.cpus();
  const batteryText = await runWindowsCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "(Get-CimInstance Win32_Battery | Select-Object -First 1 -ExpandProperty EstimatedChargeRemaining) -join ''"], 5000).catch(() => "");
  const batteryPercent = /^\d{1,3}$/.test(batteryText) ? Number(batteryText) : null;
  return { os: os.type() + " " + os.release(), computer: os.hostname(), cpu: cpus[0]?.model || "No disponible", logicalProcessors: cpus.length, ramTotalGB: Number((os.totalmem() / 1024 ** 3).toFixed(1)), ramFreeGB: Number((os.freemem() / 1024 ** 3).toFixed(1)), uptimeHours: Number((os.uptime() / 3600).toFixed(1)), batteryPercent };
});

ipcMain.handle("qbit:open-app", async (_event, appName) => {
  if (typeof appName !== "string") throw new Error("Nombre de aplicación inválido.");
  const key = appName.toLocaleLowerCase("es").trim();
  const appSpec = allowedApps[key];
  if (!appSpec) throw new Error("Esa aplicación no está en la lista permitida.");
  const child = spawn(appSpec.file, appSpec.args, { detached: true, stdio: "ignore", shell: false, windowsHide: false });
  child.on("error", () => {}); child.unref();
  return { ok: true, message: "Abriendo " + key + "." };
});

ipcMain.handle("qbit:open-anything", async (event, query) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error("Solicitud no autorizada.");
  if (typeof query !== "string" || !query.trim() || query.length > 180) throw new Error("Nombre de archivo o aplicación inválido.");
  return openAnything(query.trim());
});

ipcMain.handle("qbit:open-folder", async (_event, folderName) => {
  if (typeof folderName !== "string") throw new Error("Carpeta inválida.");
  const key = folderName.toLocaleLowerCase("es").trim();
  const getPath = knownFolders[key];
  if (!getPath) throw new Error("Esa carpeta no está en la lista permitida.");
  const error = await shell.openPath(getPath());
  if (error) throw new Error(error);
  return { ok: true, message: "Abriendo " + key + "." };
});

ipcMain.handle("qbit:volume", async (_event, action) => {
  if (!["up", "down", "mute"].includes(action)) throw new Error("Acción de volumen no permitida.");
  const virtualKey = action === "up" ? 0xAF : action === "down" ? 0xAE : 0xAD;
  const script = "$src = 'using System; using System.Runtime.InteropServices; public static class QbitNativeKeys { [DllImport(\"user32.dll\")] public static extern void keybd_event(byte bVk, byte bScan, int dwFlags, int dwExtraInfo); }'; Add-Type -TypeDefinition $src; [QbitNativeKeys]::keybd_event(" + virtualKey + ",0,0,0); [QbitNativeKeys]::keybd_event(" + virtualKey + ",0,2,0)";
  await runWindowsCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script]);
  return { ok: true, message: action === "up" ? "Subiendo el volumen." : action === "down" ? "Bajando el volumen." : "Alternando silencio." };
});

ipcMain.handle("qbit:automation", async (_event, taskName) => {
  if (taskName !== "study") throw new Error("Automatización desconocida.");
  for (const file of ["calc.exe", "notepad.exe"]) { const child = spawn(file, [], { detached: true, stdio: "ignore", shell: false }); child.on("error", () => {}); child.unref(); }
  const error = await shell.openPath(app.getPath("documents"));
  if (error) throw new Error(error);
  return { ok: true, message: "Preparé el entorno de estudio: calculadora, Bloc de notas y Documentos." };
});

app.whenReady().then(() => {
  const appRoot = path.resolve(getAppRoot());
  protocol.handle("qbit-model", request => {
    const url = new URL(request.url);
    let relativePath;
    try { relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, ""); }
    catch { return new Response("Bad Request", { status: 400 }); }
    if (!relativePath) return new Response("Not Found", { status: 404 });
    const modelRoot = path.resolve(localModelStorageRoot());
    const filePath = path.resolve(modelRoot, relativePath);
    if (filePath !== modelRoot && !filePath.startsWith(modelRoot + path.sep)) {
      return new Response("Forbidden", { status: 403 });
    }
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return new Response("Not Found", { status: 404 });
    }
    return net.fetch(pathToFileURL(filePath).href);
  });
  protocol.handle("qbit", request => {
    const url = new URL(request.url);
    const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
    const filePath = path.resolve(appRoot, relativePath);
    if (filePath !== appRoot && !filePath.startsWith(appRoot + path.sep)) {
      return new Response("Forbidden", { status: 403 });
    }
    return net.fetch(pathToFileURL(filePath).href);
  });
  loadPetSettings();
  createTray();
  createWindow();
  createPetWindow();
});
app.on("before-quit", () => { isQuitting = true; });
app.on("window-all-closed", () => {
  if (isQuitting) app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
    createPetWindow();
  } else if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
  }
});
