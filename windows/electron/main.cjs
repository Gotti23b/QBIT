const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, screen, dialog, clipboard, Notification } = require("electron");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const WebSocket = require("ws");
let autoUpdater = null;
try { ({ autoUpdater } = require("electron-updater")); } catch { autoUpdater = null; }

let mainWindow;
let petWindow;
let tray;
let isQuitting = false;
let connectorServer=null,connectorSocket=null;
const connectorPending=new Map();
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


function connectorConnected(){return !!connectorSocket&&connectorSocket.readyState===WebSocket.OPEN;}
function startConnectorServer(){if(connectorServer)return Promise.resolve({ok:true,message:"El conector ya está iniciado."});return new Promise((resolve,reject)=>{const server=new WebSocket.Server({host:"127.0.0.1",port:17614,path:"/qbit-console"});connectorServer=server;server.once("listening",()=>resolve({ok:true,message:"Conector iniciado. Ahora conectá QBIT Extension desde Chrome."}));server.once("error",err=>{connectorServer=null;reject(new Error(err.code==="EADDRINUSE"?"El puerto 17614 ya está ocupado.":err.message));});server.on("connection",(socket,request)=>{if(!/^chrome-extension:\/\/[a-p]{32}$/.test(String(request.headers.origin||""))){socket.close(1008,"Origen no permitido");return;}if(connectorSocket&&connectorSocket.readyState===WebSocket.OPEN)connectorSocket.close();connectorSocket=socket;socket.on("message",raw=>{let msg;try{msg=JSON.parse(String(raw));}catch{return;}if(msg.type==="hello"){socket.send(JSON.stringify({type:"hello_ack"}));const bundled=bundledExtensionVersion();if(bundled&&msg.version&&isNewerVersion(bundled,String(msg.version)))socket.send(JSON.stringify({type:"reload_extension",version:bundled}));return;}if(msg.type==="ai_result"&&typeof msg.id==="string"){const p=connectorPending.get(msg.id);if(!p)return;clearTimeout(p.timer);connectorPending.delete(msg.id);msg.ok&&typeof msg.answer==="string"?p.resolve({answer:msg.answer,provider:String(msg.provider||"IA del navegador")}):p.reject(new Error(String(msg.error||"La IA no pudo responder.")));}});socket.on("close",()=>{if(connectorSocket===socket)connectorSocket=null;for(const [id,p] of connectorPending){clearTimeout(p.timer);p.reject(new Error("La extensión se desconectó."));connectorPending.delete(id);}if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send("qbit:connector-state",{running:!!connectorServer,connected:false});});socket.on("error",()=>{});if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send("qbit:connector-state",{running:true,connected:true});});});}
function stopConnectorServer(){for(const [id,p] of connectorPending){clearTimeout(p.timer);p.reject(new Error("El conector se desconectó."));connectorPending.delete(id);}if(connectorSocket){try{connectorSocket.close(1000,"Desconectado desde QBIT");}catch{}connectorSocket=null;}if(connectorServer){try{connectorServer.close();}catch{}connectorServer=null;}return {ok:true};}
function askBrowserAI(message){if(typeof message!=="string"||!message.trim()||message.length>12000)return Promise.reject(new Error("Mensaje no válido."));if(!connectorConnected())return Promise.reject(new Error("La extensión no está conectada. Iniciá el conector y tocá Conectar en el icono de QBIT Extension."));const id=require("node:crypto").randomUUID();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{connectorPending.delete(id);reject(new Error("La consulta tardó más de cuatro minutos."));},250000);connectorPending.set(id,{resolve,reject,timer});try{connectorSocket.send(JSON.stringify({type:"dispatch_ai",id,provider:"auto",message:message.slice(0,12000)}));}catch(err){clearTimeout(timer);connectorPending.delete(id);reject(err);}});}

// ── Actualizaciones ─────────────────────────────────────────────────────────
// QBIT baja la versión nueva en segundo plano y pregunta: reiniciar ahora o seguir
// en esta versión. Nunca se instala sola: si elegís seguir, te vuelve a preguntar
// la próxima vez que abras QBIT.
function isNewerVersion(a, b) {
  const pa = String(a).split(".").map(n => parseInt(n, 10) || 0), pb = String(b).split(".").map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) > (pb[i] || 0)) return true; if ((pa[i] || 0) < (pb[i] || 0)) return false; }
  return false;
}
function bundledExtensionVersion() {
  const dir = app.isPackaged ? path.join(process.resourcesPath, "browser-extension") : path.join(getAppRoot(), "browser-extension");
  try { return JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")).version || null; } catch { return null; }
}
let updateState = { status: "idle", version: null, message: "" };
let updatePromptOpen = false;
function sendUpdateState(patch) {
  updateState = { ...updateState, ...patch, current: app.getVersion() };
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("qbit:update-state", updateState);
}
async function askToRestart(info) {
  if (updatePromptOpen) return;
  updatePromptOpen = true;
  try {
    const { response } = await dialog.showMessageBox(mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined, {
      type: "info",
      title: "Actualización de QBIT",
      message: "Hay una versión nueva de QBIT: " + info.version,
      detail: "Ya está descargada. Podés reiniciar ahora para actualizar o seguir usando esta versión (" + app.getVersion() + ") y actualizar más tarde.",
      buttons: ["Reiniciar y actualizar", "Seguir en la versión " + app.getVersion()],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    });
    if (response === 0) {
      isQuitting = true;
      stopConnectorServer();
      setImmediate(() => autoUpdater.quitAndInstall(false, true));
    }
  } finally { updatePromptOpen = false; }
}
function setupAutoUpdater() {
  if (!autoUpdater || !app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false; // solo se instala si vos elegís "Reiniciar y actualizar"
  autoUpdater.on("checking-for-update", () => sendUpdateState({ status: "checking", message: "Buscando actualizaciones…" }));
  autoUpdater.on("update-available", info => sendUpdateState({ status: "downloading", version: info.version, message: "Descargando la versión " + info.version + "…" }));
  autoUpdater.on("update-not-available", () => sendUpdateState({ status: "latest", version: null, message: "Tenés la última versión (" + app.getVersion() + ")." }));
  autoUpdater.on("download-progress", p => sendUpdateState({ status: "downloading", message: "Descargando actualización… " + Math.round(p.percent || 0) + "%" }));
  autoUpdater.on("update-downloaded", info => { sendUpdateState({ status: "ready", version: info.version, message: "La versión " + info.version + " está lista. Reiniciá cuando quieras." }); askToRestart(info); });
  autoUpdater.on("error", err => sendUpdateState({ status: "error", message: "No pude buscar actualizaciones: " + (err?.message || err) }));
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 5000);
}
ipcMain.handle("qbit:update-check", async e => {
  if (!mainWindow || e.sender !== mainWindow.webContents) throw new Error("No autorizado.");
  if (!autoUpdater || !app.isPackaged) return { status: "dev", current: app.getVersion(), message: "Estás usando QBIT en modo desarrollo (" + app.getVersion() + "). Las actualizaciones funcionan en la versión instalada." };
  if (updateState.status === "ready") { askToRestart({ version: updateState.version }); return { ...updateState, current: app.getVersion() }; }
  autoUpdater.checkForUpdates().catch(err => sendUpdateState({ status: "error", message: "No pude buscar actualizaciones: " + (err?.message || err) }));
  return { status: "checking", current: app.getVersion(), message: "Buscando actualizaciones…" };
});
ipcMain.handle("qbit:app-version", () => app.getVersion());

function getAppRoot() {
  const candidates = [path.join(__dirname, ".."), path.join(__dirname, "..", "..")];
  return candidates.find(candidate => fs.existsSync(path.join(candidate, "index.html"))) || candidates[0];
}

const PET_SMALL = { width: 116, height: 116 };
const PET_LARGE = { width: 380, height: 560 };

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

function createWindow(show = true) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (show) {
      mainWindow.show();
      mainWindow.focus();
    }
    return;
  }
  mainWindow = new BrowserWindow({
    width: 1180, height: 820, minWidth: 760, minHeight: 560,
    backgroundColor: "#07111f", title: "QBIT — Asistente personal",
    show: false,
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) shell.openExternal(url).catch(() => {});
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("file://")) event.preventDefault();
  });
  mainWindow.on("close", event => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on("closed", () => { mainWindow = null; });
  mainWindow.loadFile(path.join(getAppRoot(), "index.html"));
  if (show) mainWindow.once("ready-to-show", () => mainWindow?.show());
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
  const normalized = normalizeLocalName(query);
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
  // La mascota usa el renderer principal oculto; nunca mostrarlo ni enfocarlo.
  if (!mainWindow || mainWindow.isDestroyed()) createWindow(false);
  const target = mainWindow;
  if (!target || target.isDestroyed()) return false;
  const deliver = () => {
    if (mainWindow === target && !target.isDestroyed()) target.webContents.send("qbit:pet-message", message);
  };
  if (target.webContents.isLoading()) target.webContents.once("did-finish-load", deliver);
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

ipcMain.handle("qbit:connector-start",e=>{if(!mainWindow||e.sender!==mainWindow.webContents)throw new Error("No autorizado.");return startConnectorServer();});
ipcMain.handle("qbit:connector-stop",e=>{if(!mainWindow||e.sender!==mainWindow.webContents)throw new Error("No autorizado.");return stopConnectorServer();});
ipcMain.handle("qbit:connector-status",e=>{if(!mainWindow||e.sender!==mainWindow.webContents)throw new Error("No autorizado.");return {running:!!connectorServer,connected:connectorConnected()};});
ipcMain.handle("qbit:connector-open-folder",async e=>{if(!mainWindow||e.sender!==mainWindow.webContents)throw new Error("No autorizado.");const extensionPath=app.isPackaged?path.join(process.resourcesPath,"browser-extension"):path.join(getAppRoot(),"browser-extension");const err=await shell.openPath(extensionPath);if(err)throw new Error(err);return {ok:true,path:extensionPath};});
ipcMain.handle("qbit:connector-open-chrome",async e=>{if(!mainWindow||e.sender!==mainWindow.webContents)throw new Error("No autorizado.");const candidates=[process.env.PROGRAMFILES,process.env["PROGRAMFILES(X86)"],process.env.LOCALAPPDATA].filter(Boolean).map(root=>path.join(root,"Google","Chrome","Application","chrome.exe"));const chromeExe=candidates.find(candidate=>fs.existsSync(candidate));if(!chromeExe)throw new Error("No encontré Google Chrome. Abrilo y escribí chrome://extensions en la barra de direcciones.");const child=spawn(chromeExe,["chrome://extensions/"],{detached:true,stdio:"ignore",windowsHide:false});child.on("error",()=>{});child.unref();return {ok:true};});
ipcMain.handle("qbit:connector-ask",async(e,msg)=>{if(!mainWindow||e.sender!==mainWindow.webContents)throw new Error("No autorizado.");return askBrowserAI(msg);});

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

ipcMain.handle("qbit:volume", async (_event, action, level) => {
  if (action === "set") {
    const target = Math.round(Number(level));
    if (!Number.isInteger(target) || target < 0 || target > 100) throw new Error("El volumen tiene que estar entre 0 y 100.");
    // Windows sube/baja de a 2% por tecla: bajamos todo y subimos hasta el nivel pedido.
    const ups = Math.round(target / 2);
    const setScript = "$src = 'using System; using System.Runtime.InteropServices; public static class QbitNativeKeys { [DllImport(\"user32.dll\")] public static extern void keybd_event(byte bVk, byte bScan, int dwFlags, int dwExtraInfo); }'; Add-Type -TypeDefinition $src; " +
      "for ($i = 0; $i -lt 50; $i++) { [QbitNativeKeys]::keybd_event(0xAE,0,0,0); [QbitNativeKeys]::keybd_event(0xAE,0,2,0) }; " +
      "for ($i = 0; $i -lt " + ups + "; $i++) { [QbitNativeKeys]::keybd_event(0xAF,0,0,0); [QbitNativeKeys]::keybd_event(0xAF,0,2,0) }";
    await runWindowsCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", setScript], 15000);
    return { ok: true, message: "Volumen al " + (ups * 2) + "%." };
  }
  if (!["up", "down", "mute"].includes(action)) throw new Error("Acción de volumen no permitida.");
  const virtualKey = action === "up" ? 0xAF : action === "down" ? 0xAE : 0xAD;
  const script = "$src = 'using System; using System.Runtime.InteropServices; public static class QbitNativeKeys { [DllImport(\"user32.dll\")] public static extern void keybd_event(byte bVk, byte bScan, int dwFlags, int dwExtraInfo); }'; Add-Type -TypeDefinition $src; [QbitNativeKeys]::keybd_event(" + virtualKey + ",0,0,0); [QbitNativeKeys]::keybd_event(" + virtualKey + ",0,2,0)";
  await runWindowsCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script]);
  return { ok: true, message: action === "up" ? "Subiendo el volumen." : action === "down" ? "Bajando el volumen." : "Alternando silencio." };
});


const SETTINGS_PAGES = Object.freeze({
  system: "ms-settings:",
  display: "ms-settings:display",
  sound: "ms-settings:sound",
  network: "ms-settings:network",
  wifi: "ms-settings:network-wifi",
  bluetooth: "ms-settings:bluetooth",
  apps: "ms-settings:appsfeatures",
  personalization: "ms-settings:personalization",
  updates: "ms-settings:windowsupdate",
  storage: "ms-settings:storagesense",
  notifications: "ms-settings:notifications",
  privacy: "ms-settings:privacy"
});
ipcMain.handle("qbit:open-settings", async (_event, page) => {
  const uri = SETTINGS_PAGES[String(page || "system").toLowerCase()];
  if (!uri) throw new Error("Esa sección de Configuración no está habilitada.");
  await shell.openExternal(uri);
  return { ok: true, message: "Abriendo Configuración de Windows." };
});
ipcMain.handle("qbit:lock-pc", async () => {
  await runWindowsCommand("rundll32.exe", ["user32.dll,LockWorkStation"], 5000);
  return { ok: true, message: "Bloqueando la PC." };
});
ipcMain.handle("qbit:battery-info", async () => {
  const raw = await runWindowsCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    "$b=Get-CimInstance Win32_Battery | Select-Object -First 1; if($null -eq $b){'null'}else{$b | Select-Object Name,Status,EstimatedChargeRemaining,BatteryStatus,EstimatedRunTime | ConvertTo-Json -Compress}"], 7000);
  if (!raw || raw === "null") return { ok: true, message: "Windows no detecta una batería en este equipo." };
  let b; try { b = JSON.parse(raw); } catch { throw new Error("No pude interpretar los datos de batería de Windows."); }
  return { ok: true, message: "Batería: " + (b.EstimatedChargeRemaining ?? "desconocido") + "%\nEstado: " + (b.Status || "no disponible") + "\nTiempo estimado: " + (b.EstimatedRunTime && b.EstimatedRunTime < 71582788 ? b.EstimatedRunTime + " minutos" : "no disponible") };
});
ipcMain.handle("qbit:network-info", async () => {
  const raw = await runWindowsCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    "Get-NetIPConfiguration | Where-Object {$_.NetAdapter.Status -eq 'Up'} | Select-Object InterfaceAlias,@{N='IPv4';E={$_.IPv4Address.IPAddress -join ', '}},@{N='Gateway';E={$_.IPv4DefaultGateway.NextHop -join ', '}} | ConvertTo-Json -Compress"], 9000);
  if (!raw) return { ok: true, message: "Windows no informó conexiones de red activas." };
  let rows; try { rows = JSON.parse(raw); } catch { throw new Error("No pude interpretar la información de red."); }
  if (!Array.isArray(rows)) rows = [rows];
  return { ok: true, message: "Conexiones activas:\n" + rows.map(x => "• " + (x.InterfaceAlias || "Adaptador") + " · IP: " + (x.IPv4 || "sin IPv4") + " · Puerta de enlace: " + (x.Gateway || "no disponible")).join("\n") };
});
ipcMain.handle("qbit:media-control", async (_event, action) => {
  const keys = { play_pause: 0xB3, next: 0xB0, previous: 0xB1, stop: 0xB2 };
  const key = keys[String(action || "")];
  if (!key) throw new Error("Acción multimedia no permitida.");
  const script = "$src='using System; using System.Runtime.InteropServices; public static class QbitMediaKey { [DllImport(\"user32.dll\")] public static extern void keybd_event(byte bVk,byte bScan,int dwFlags,int dwExtraInfo); }'; Add-Type -TypeDefinition $src; [QbitMediaKey]::keybd_event(" + key + ",0,0,0); [QbitMediaKey]::keybd_event(" + key + ",0,2,0)";
  await runWindowsCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], 7000);
  const labels = { play_pause: "Reproducir o pausar", next: "Siguiente pista", previous: "Pista anterior", stop: "Detener reproducción" };
  return { ok: true, message: labels[action] + "." };
});
function resolveKnownUserPath(baseName, relativePath) {
  const baseKey = String(baseName || "").toLowerCase();
  const getBase = knownFolders[baseKey];
  if (!getBase || !["documentos", "descargas", "escritorio"].includes(baseKey)) throw new Error("Elegí una carpeta permitida: documentos, descargas o escritorio.");
  if (typeof relativePath !== "string" || !relativePath.trim() || relativePath.length > 220) throw new Error("La ruta relativa no es válida.");
  if (path.isAbsolute(relativePath) || /^[a-z]:/i.test(relativePath) || relativePath.split(/[\\/]+/).some(part => part === ".." || part === ".")) throw new Error("Solo se permiten rutas dentro de la carpeta elegida.");
  const base = path.resolve(getBase());
  const target = path.resolve(base, relativePath);
  if (!target.startsWith(base + path.sep)) throw new Error("La ruta sale de la carpeta permitida.");
  return target;
}
ipcMain.handle("qbit:create-folder", async (_event, base, relativePath) => {
  const target = resolveKnownUserPath(base, relativePath);
  await fs.promises.mkdir(target, { recursive: true });
  return { ok: true, message: "Carpeta creada: " + path.basename(target) + "." };
});
ipcMain.handle("qbit:create-file", async (_event, base, relativePath, content) => {
  const target = resolveKnownUserPath(base, relativePath);
  if (typeof content !== "string" || content.length > 20000) throw new Error("El contenido debe ser texto de hasta 20.000 caracteres.");
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  try { await fs.promises.writeFile(target, content, { encoding: "utf8", flag: "wx" }); }
  catch (error) { if (error.code === "EEXIST") throw new Error("Ya existe un archivo con ese nombre. No lo sobrescribí."); throw error; }
  return { ok: true, message: "Archivo creado: " + path.basename(target) + "." };
});
ipcMain.handle("qbit:search-files", async (_event, query) => {
  if (typeof query !== "string" || !query.trim() || query.length > 100) throw new Error("Escribí un nombre para buscar.");
  const matches = await findLocalMatches(query.trim());
  return { ok: true, matches: matches.filter(x => x.kind === "file").slice(0, 12).map(x => ({ name: x.name, folder: path.basename(path.dirname(x.path)) })) };
});
ipcMain.handle("qbit:display-info", async () => {
  const primary = screen.getPrimaryDisplay().id;
  const displays = screen.getAllDisplays().map((d, i) => ({ index: i + 1, width: d.size.width, height: d.size.height, scale: d.scaleFactor, primary: d.id === primary }));
  return { ok: true, message: "Pantallas detectadas:\n" + displays.map(d => "• Pantalla " + d.index + (d.primary ? " (principal)" : "") + ": " + d.width + " × " + d.height + " · escala " + d.scale + "×").join("\n") };
});
async function readPowerPlanBrightness() {
  const script = "$q=powercfg /query SCHEME_CURRENT SUB_VIDEO VIDEONORMALLEVEL 2>$null; $m=[regex]::Matches(($q -join \"\n\"),'0x([0-9a-fA-F]{8})'); if($m.Count -gt 0){[Convert]::ToInt32($m[$m.Count-1].Groups[1].Value,16)}else{'unsupported'}";
  const raw = await runWindowsCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], 8000).catch(() => "");
  const n = Number(raw.trim());
  return Number.isInteger(n) && n >= 0 && n <= 100 ? n : null;
}
async function setPowerPlanBrightness(target) {
  const script = "$ErrorActionPreference='SilentlyContinue'; powercfg /setacvalueindex SCHEME_CURRENT SUB_VIDEO VIDEONORMALLEVEL " + target + "; $ac=$LASTEXITCODE; powercfg /setdcvalueindex SCHEME_CURRENT SUB_VIDEO VIDEONORMALLEVEL " + target + "; powercfg /setactive SCHEME_CURRENT; if($ac -eq 0){'ok'}else{'unsupported'}";
  return (await runWindowsCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], 10000)).trim();
}
async function applyBrightness(target) {
  const script = "$m=Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction SilentlyContinue | Select-Object -First 1; if($null -eq $m){'unsupported';exit}; $r=Invoke-CimMethod -InputObject $m -MethodName WmiSetBrightness -Arguments @{Timeout=1;Brightness=" + target + "} -ErrorAction SilentlyContinue; if($null -eq $r){'unsupported'}elseif($r.ReturnValue -eq 0){'ok'}else{'failed:'+$r.ReturnValue}";
  const wmi = await runWindowsCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], 10000).catch(() => "unsupported");
  if (wmi.trim() === "ok") return "wmi";
  const fallback = await setPowerPlanBrightness(target).catch(() => "unsupported");
  if (fallback === "ok") return "powerplan";
  return wmi.trim().startsWith("failed:") ? wmi.trim() : "unsupported";
}
ipcMain.handle("qbit:brightness-info", async () => {
  const raw = await runWindowsCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    "$m=Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction SilentlyContinue | Select-Object -First 1; if($null -eq $m){'unsupported'}else{[string]$m.CurrentBrightness}"], 8000).catch(() => "");
  if (/^\d{1,3}$/.test(raw.trim())) return { ok: true, supported: true, level: Number(raw.trim()), message: "El brillo actual está al " + Number(raw.trim()) + "%." };
  const fallback = await readPowerPlanBrightness();
  if (fallback !== null) return { ok: true, supported: true, level: fallback, source: "powerplan", message: "El nivel configurado en el plan de energía es " + fallback + "%. Puede no coincidir con el brillo físico actual." };
  return { ok: false, supported: false, message: "Windows no ofrece un control de brillo compatible mediante WMI ni mediante el plan de energía. Puede ser una limitación del controlador o de la pantalla." };
});
ipcMain.handle("qbit:brightness-set", async (_event, level) => {
  const target = Number(level);
  if (!Number.isInteger(target) || target < 0 || target > 100) throw new Error("El brillo tiene que ser un número entero entre 0 y 100.");
  const method = await applyBrightness(target);
  if (method === "unsupported") return { ok: false, supported: false, message: "Windows no pudo modificar el brillo mediante WMI ni el plan de energía. Revisá el controlador de pantalla." };
  if (method.startsWith("failed:")) throw new Error("Windows no pudo aplicar el brillo. Código: " + method);
  return { ok: true, message: "Brillo establecido al " + target + "%." + (method === "powerplan" ? " Se aplicó mediante el plan de energía." : "") };
});
ipcMain.handle("qbit:brightness-adjust", async (_event, delta) => {
  const step = Number(delta);
  if (![10, -10].includes(step)) throw new Error("Ajuste de brillo no permitido.");
  let raw = await runWindowsCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    "$m=Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction SilentlyContinue | Select-Object -First 1; if($null -eq $m){'unsupported'}else{[string]$m.CurrentBrightness}"], 8000).catch(() => "");
  let current = /^\d{1,3}$/.test(raw.trim()) ? Number(raw.trim()) : await readPowerPlanBrightness();
  if (current === null) return { ok: false, supported: false, message: "No pude leer un nivel de brillo para ajustarlo. El controlador puede no ofrecer ese control." };
  const target = Math.max(0, Math.min(100, current + step));
  const method = await applyBrightness(target);
  if (method === "unsupported") return { ok: false, supported: false, message: "Windows no pudo modificar el brillo mediante WMI ni el plan de energía." };
  if (method.startsWith("failed:")) throw new Error("Windows no pudo modificar el brillo. Código: " + method);
  return { ok: true, message: "Brillo ajustado al " + target + "%." + (method === "powerplan" ? " Se aplicó mediante el plan de energía." : "") };
});

const qbitTimers=new Map();
function qbitPowerShellQuote(v){return "'"+String(v).replace(/'/g,"''")+"'";}
async function findArtifactFile(query){if(typeof query!=="string"||!query.trim()||query.length>100)throw new Error("Indicá el nombre del archivo.");const a=(await findLocalMatches(query.trim())).filter(x=>x.kind==="file");if(!a.length)throw new Error("No encontré ese archivo en tus carpetas habituales.");if(a.length>1&&a[0].score===a[1].score)throw new Error("Encontré varios archivos parecidos. Indicá un nombre más exacto.");return a[0];}
ipcMain.handle("qbit:empty-recycle-bin",async()=>{await runWindowsCommand("powershell.exe",["-NoProfile","-NonInteractive","-Command","Clear-RecycleBin -Force -ErrorAction Stop"],20000);return{ok:true,message:"La Papelera de reciclaje quedó vacía."};});
ipcMain.handle("qbit:get-processes",async()=>{const raw=await runWindowsCommand("powershell.exe",["-NoProfile","-NonInteractive","-Command","Get-Process | Sort-Object CPU -Descending | Select-Object -First 15 ProcessName,Id,@{N='RAM_MB';E={[math]::Round($_.WorkingSet64/1MB,1)}} | ConvertTo-Json -Compress"],10000);let a=JSON.parse(raw||"[]");if(!Array.isArray(a))a=[a];return{ok:true,message:"Procesos activos (hasta 15):\n"+a.map(x=>"• "+x.ProcessName+" · PID "+x.Id+" · RAM "+x.RAM_MB+" MB").join("\n")};});
ipcMain.handle("qbit:cpu-usage",async()=>{const raw=await runWindowsCommand("powershell.exe",["-NoProfile","-NonInteractive","-Command","(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average"],8000);const n=Number(raw);if(!Number.isFinite(n))throw new Error("No pude medir el uso del procesador.");return{ok:true,message:"Uso del procesador (muestra de Windows): "+n.toFixed(0)+"%."};});
ipcMain.handle("qbit:ram-usage",async()=>{const raw=await runWindowsCommand("powershell.exe",["-NoProfile","-NonInteractive","-Command","$o=Get-CimInstance Win32_OperatingSystem;$t=[math]::Round($o.TotalVisibleMemorySize/1MB,2);$f=[math]::Round($o.FreePhysicalMemory/1MB,2);@{total=$t;free=$f;used=[math]::Round($t-$f,2);percent=[math]::Round((($t-$f)/$t)*100,1)}|ConvertTo-Json -Compress"],8000);const x=JSON.parse(raw);return{ok:true,message:"RAM: "+x.used+" GB usados de "+x.total+" GB ("+x.percent+"%). Libres: "+x.free+" GB."};});
ipcMain.handle("qbit:disk-usage",async()=>{const raw=await runWindowsCommand("powershell.exe",["-NoProfile","-NonInteractive","-Command","Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Select-Object DeviceID,@{N='TotalGB';E={[math]::Round($_.Size/1GB,1)}},@{N='FreeGB';E={[math]::Round($_.FreeSpace/1GB,1)}} | ConvertTo-Json -Compress"],9000);let a=JSON.parse(raw||"[]");if(!Array.isArray(a))a=[a];return{ok:true,message:"Espacio en discos:\n"+a.map(x=>"• "+x.DeviceID+" · "+(x.TotalGB-x.FreeGB).toFixed(1)+" GB usados de "+x.TotalGB+" GB · "+x.FreeGB+" GB libres").join("\n")};});
ipcMain.handle("qbit:night-light-settings",async()=>{await shell.openExternal("ms-settings:nightlight");return{ok:true,message:"Abrí la configuración de Luz nocturna. Activala o desactivala desde ese panel; Windows no ofrece un interruptor universal compatible para automatizarlo desde QBIT."};});
ipcMain.handle("qbit:toggle-wifi",async(_e,action)=>{
  const value=String(action??"").trim().toLocaleLowerCase("es");
  const onValues=new Set(["on","activar","activá","activa","encender","encendé","prender","prendé","habilitar","habilitá","enable","enabled","true","1","sí","si"]);
  const offValues=new Set(["off","desactivar","desactivá","desactiva","apagar","apagá","disable","disabled","false","0","no"]);
  if(!onValues.has(value)&&!offValues.has(value))throw new Error("Indicá la acción: 'on' para activar o 'off' para desactivar el Wi-Fi.");
  const on=onValues.has(value);
  const script="$ErrorActionPreference='Stop';$a=Get-NetAdapter -Physical | Where-Object {$_.Name -match 'Wi-?Fi|WLAN|Wireless' -or $_.InterfaceDescription -match 'Wi-?Fi|WLAN|Wireless'} | Select-Object -First 1;if($null -eq $a){'missing';exit};if("+String(on).toLowerCase()+"){Enable-NetAdapter -Name $a.Name -Confirm:$false -ErrorAction Stop}else{Disable-NetAdapter -Name $a.Name -Confirm:$false -ErrorAction Stop};'ok'";
  let r;
  try{r=(await runWindowsCommand("powershell.exe",["-NoProfile","-NonInteractive","-Command",script],15000)).trim();}
  catch(e){throw new Error("Windows no pudo cambiar el Wi-Fi. Verificá que QBIT tenga permisos de administrador. "+e.message);}
  if(r==="missing")throw new Error("No encontré un adaptador Wi-Fi físico. Revisá el nombre del adaptador en Administrador de dispositivos.");
  if(r!=="ok")throw new Error("Windows no confirmó el cambio del Wi-Fi.");
  return{ok:true,message:on?"Wi-Fi activado.":"Wi-Fi desactivado."};
});
ipcMain.handle("qbit:minimize-all",async()=>{await runWindowsCommand("powershell.exe",["-NoProfile","-NonInteractive","-Command","(New-Object -ComObject Shell.Application).MinimizeAll()"],7000);return{ok:true,message:"Minimicé todas las ventanas."};});
ipcMain.handle("qbit:restore-all",async()=>{await runWindowsCommand("powershell.exe",["-NoProfile","-NonInteractive","-Command","(New-Object -ComObject Shell.Application).UndoMinimizeAll()"],7000);return{ok:true,message:"Restauré las ventanas minimizadas."};});
function validateProcessQuery(q){if(typeof q!=="string"||!q.trim()||q.length>80||!/^[\p{L}\p{N} ._-]+$/u.test(q.trim()))throw new Error("Indicá un nombre de aplicación válido.");return q.trim();}
ipcMain.handle("qbit:focus-app",async(_e,q)=>{const n=validateProcessQuery(q),s="$p=Get-Process | Where-Object {$_.MainWindowHandle -ne 0 -and ($_.ProcessName -like "+qbitPowerShellQuote("*"+n+"*")+")} | Select-Object -First 1;if($null -eq $p){'missing';exit};$w=New-Object -ComObject WScript.Shell;if($w.AppActivate([int]$p.Id)){'ok'}else{'failed'}";const r=(await runWindowsCommand("powershell.exe",["-NoProfile","-NonInteractive","-Command",s],8000)).trim();if(r==="missing")throw new Error("No encontré una ventana abierta que coincida con "+n+".");if(r!=="ok")throw new Error("Windows no pudo activar esa ventana.");return{ok:true,message:"Puse "+n+" en primer plano."};});
ipcMain.handle("qbit:close-window",async(_e,q)=>{const n=validateProcessQuery(q),s="$p=Get-Process | Where-Object {$_.MainWindowHandle -ne 0 -and ($_.ProcessName -like "+qbitPowerShellQuote("*"+n+"*")+")} | Select-Object -First 1;if($null -eq $p){'missing';exit};if($p.CloseMainWindow()){'sent'}else{'failed'}";const r=(await runWindowsCommand("powershell.exe",["-NoProfile","-NonInteractive","-Command",s],8000)).trim();if(r==="missing")throw new Error("No encontré una ventana abierta que coincida con "+n+".");if(r!=="sent")throw new Error("La aplicación no aceptó la solicitud de cierre.");return{ok:true,message:"Envié la solicitud de cierre a "+n+". Si tiene cambios sin guardar, la aplicación puede pedirte confirmación."};});
ipcMain.handle("qbit:open-file-location",async(_e,q)=>{const x=await findArtifactFile(q);shell.showItemInFolder(x.path);return{ok:true,message:"Mostrando "+x.name+" en su carpeta."};});
ipcMain.handle("qbit:file-info",async(_e,q)=>{const x=await findArtifactFile(q),s=await fs.promises.stat(x.path);return{ok:true,message:"Archivo: "+x.name+"\nUbicación: "+path.dirname(x.path)+"\nTamaño: "+(s.size/1024).toFixed(1)+" KB\nModificado: "+s.mtime.toLocaleString("es-AR")};});
ipcMain.handle("qbit:zip-file",async(_e,q)=>{const x=await findArtifactFile(q),dest=x.path+".zip";if(fs.existsSync(dest))throw new Error("Ya existe "+path.basename(dest)+". No lo sobrescribí.");await runWindowsCommand("powershell.exe",["-NoProfile","-NonInteractive","-Command","Compress-Archive -LiteralPath "+qbitPowerShellQuote(x.path)+" -DestinationPath "+qbitPowerShellQuote(dest)+" -ErrorAction Stop"],20000);return{ok:true,message:"Creé el archivo ZIP: "+dest};});
ipcMain.handle("qbit:unzip-file",async(_e,q)=>{const x=await findArtifactFile(q);if(path.extname(x.path).toLowerCase()!==".zip")throw new Error("El archivo elegido no tiene extensión .zip.");const dest=path.join(path.dirname(x.path),path.basename(x.path,path.extname(x.path)));if(fs.existsSync(dest))throw new Error("Ya existe la carpeta de destino. No mezclé ni sobrescribí archivos.");await fs.promises.mkdir(dest,{recursive:false});try{await runWindowsCommand("powershell.exe",["-NoProfile","-NonInteractive","-Command","Expand-Archive -LiteralPath "+qbitPowerShellQuote(x.path)+" -DestinationPath "+qbitPowerShellQuote(dest)+" -ErrorAction Stop"],30000);}catch(e){await fs.promises.rm(dest,{recursive:true,force:true}).catch(()=>{});throw e;}return{ok:true,message:"Extraje el ZIP en "+dest};});
ipcMain.handle("qbit:read-text-file",async(_e,q)=>{const x=await findArtifactFile(q),ext=path.extname(x.path).toLowerCase();if(![".txt",".md",".csv",".json",".log",".ini"].includes(ext))throw new Error("Por seguridad solo puedo leer TXT, MD, CSV, JSON, LOG e INI.");const st=await fs.promises.stat(x.path);if(st.size>30000)throw new Error("El archivo supera los 30 KB permitidos.");const content=await fs.promises.readFile(x.path,"utf8");return{ok:true,message:"Contenido de "+x.name+":\n"+content};});
ipcMain.handle("qbit:show-notification",async(_e,title,message)=>{const t=String(title||"QBIT").slice(0,80),b=String(message||"").slice(0,240);if(!b.trim())throw new Error("La notificación necesita un mensaje.");new Notification({title:t,body:b}).show();return{ok:true,message:"Notificación mostrada."};});
ipcMain.handle("qbit:set-timer",async(_e,seconds,label)=>{const d=Number(seconds);if(!Number.isInteger(d)||d<1||d>86400)throw new Error("El temporizador debe durar entre 1 y 86400 segundos.");const id="default",title=String(label||"Temporizador").slice(0,80),prev=qbitTimers.get(id);if(prev)clearTimeout(prev);const timer=setTimeout(()=>{qbitTimers.delete(id);new Notification({title:"QBIT · "+title,body:"¡Terminó el temporizador!"}).show();},d*1000);qbitTimers.set(id,timer);return{ok:true,message:"Temporizador iniciado: "+title+" ("+d+" segundos)."};});
ipcMain.handle("qbit:cancel-timer",async(_e,id)=>{const key=String(id||"default"),timer=qbitTimers.get(key);if(!timer)return{ok:true,message:"No había un temporizador activo con ese ID."};clearTimeout(timer);qbitTimers.delete(key);return{ok:true,message:"Temporizador cancelado."};});
ipcMain.handle("qbit:audio-devices",async()=>{const raw=await runWindowsCommand("powershell.exe",["-NoProfile","-NonInteractive","-Command","Get-CimInstance Win32_SoundDevice | Select-Object Name,Status | ConvertTo-Json -Compress"],8000);let a=JSON.parse(raw||"[]");if(!Array.isArray(a))a=[a];return{ok:true,message:a.length?"Dispositivos de audio detectados:\n"+a.map(x=>"• "+x.Name+" · "+(x.Status||"estado no disponible")).join("\n"):"Windows no informó dispositivos de audio."};});

ipcMain.handle("qbit:clipboard-write", async (_event, value) => {
  if (typeof value !== "string" || !value.length || value.length > 20000) throw new Error("El texto debe tener entre 1 y 20.000 caracteres.");
  clipboard.writeText(value);
  return { ok: true, message: "Texto copiado al portapapeles." };
});

ipcMain.handle("qbit:automation", async (_event, taskName) => {
  if (taskName !== "study") throw new Error("Automatización desconocida.");
  for (const file of ["calc.exe", "notepad.exe"]) { const child = spawn(file, [], { detached: true, stdio: "ignore", shell: false }); child.on("error", () => {}); child.unref(); }
  const error = await shell.openPath(app.getPath("documents"));
  if (error) throw new Error(error);
  return { ok: true, message: "Preparé el entorno de estudio: calculadora, Bloc de notas y Documentos." };
});

app.whenReady().then(() => {
  loadPetSettings();
  createTray();
  createWindow();
  createPetWindow();
  setupAutoUpdater();
});
app.on("before-quit", () => { isQuitting = true; stopConnectorServer(); });
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
