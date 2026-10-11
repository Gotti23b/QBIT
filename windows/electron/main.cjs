const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, screen } = require("electron");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");

let mainWindow;
let petWindow;
let tray;
let isQuitting = false;
let petExpanded = false;

function getAppRoot() {
  const candidates = [path.join(__dirname, ".."), path.join(__dirname, "..", "..")];
  return candidates.find(candidate => fs.existsSync(path.join(candidate, "index.html"))) || candidates[0];
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
  const next = expanded ? PET_LARGE : PET_SMALL;
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
  petWindow = new BrowserWindow({
    ...PET_SMALL,
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
  petWindow.once("ready-to-show", () => petWindow?.show());
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
